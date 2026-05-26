const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const HISTORY_FILE = process.env.HISTORY_PATH || path.join(__dirname, 'history.json');
const TOKEN_FILE = process.env.HISTORY_PATH
  ? path.join(path.dirname(process.env.HISTORY_PATH), 'spotify-tokens.json')
  : path.join(__dirname, 'spotify-tokens.json');

const loadHistory = () => {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; }
};

const saveHistory = (history) => {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
};

const loadTokens = () => {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
};

const saveTokens = (tokens) => {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
};

let songHistory = loadHistory();

const getPlaylistAccessToken = async () => {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  const data = await res.json();
  if (data.refresh_token) saveTokens({ ...tokens, refresh_token: data.refresh_token });
  return data.access_token;
};

const addToPlaylist = async (spotifyUri) => {
  const playlistId = process.env.SPOTIFY_PLAYLIST_ID;
  if (!playlistId) return;
  const accessToken = await getPlaylistAccessToken();
  if (!accessToken) return;
  const checkRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const checkData = await checkRes.json();
  const alreadyIn = checkData.items?.some(item => item.track?.uri === spotifyUri);
  if (alreadyIn) return;
  await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [spotifyUri] }),
  });
};

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  'https://song-swap.app',
  'https://www.song-swap.app',
];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
const PORT = process.env.PORT || 5050;

let currentSong = null;

const scheduleMidnightClear = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    currentSong = null;
    io.emit('song-cleared');
    console.log('Song cleared at midnight');
    scheduleMidnightClear();
  }, msUntilMidnight);
};

//middleware
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
  },
}));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  if (currentSong) socket.emit('song-received', currentSong);
  socket.on('send-song', ({ song, sentBy }) => {
    const duplicate = songHistory.find(e => e.spotifyUri === song.spotifyUri);
    if (duplicate) {
      socket.emit('duplicate-song', duplicate);
      return;
    }
    const entry = { ...song, sentBy, sentAt: new Date().toISOString() };
    songHistory.push(entry);
    saveHistory(songHistory);
    currentSong = song;
    socket.broadcast.emit('song-received', song);
    io.emit('history-updated', entry);
    addToPlaylist(song.spotifyUri).catch(err => console.error('Playlist add failed:', err));
  });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

//Spotify API Credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

//function to get Spotify Access Token
const getSpotifyAccessToken = async () => {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
  
    const data = await response.json();
  
    console.log("Token status:", response.status);
    console.log("Token response:", data);
  
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
  
    return data.access_token;
  };


const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
};

const requireAdmin = (req, res, next) => {
  if (req.session.user?.name === 'Mguaste') return next();
  res.status(403).json({ error: 'Forbidden' });
};

const USERS = [
  { name: process.env.USER1_NAME, password: process.env.USER1_PASSWORD },
  { name: process.env.USER2_NAME, password: process.env.USER2_PASSWORD },
];

app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  const match = USERS.find(u => u.name === name && u.password === password);
  if (!match) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { name: match.name };
  res.json(req.session.user);
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/history', requireAuth, (req, res) => {
  res.json(songHistory);
});

app.delete('/api/admin/history', requireAdmin, (req, res) => {
  songHistory = [];
  currentSong = null;
  saveHistory(songHistory);
  io.emit('song-cleared');
  io.emit('history-cleared');
  res.json({ success: true });
});

app.get('/api/spotify-auth', requireAdmin, (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: 'playlist-modify-public playlist-modify-private',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/api/spotify-callback', async (req, res) => {
  const code = req.query.code;
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.refresh_token) {
    saveTokens({ refresh_token: tokens.refresh_token });
    res.redirect('/?spotify=connected');
  } else {
    res.status(500).send('Failed to get Spotify token');
  }
});

app.get('/api/spotify-status', requireAdmin, (req, res) => {
  const tokens = loadTokens();
  res.json({ connected: !!tokens?.refresh_token });
});

app.delete('/api/admin/current-song', requireAdmin, (req, res) => {
  currentSong = null;
  io.emit('song-cleared');
  res.json({ success: true });
});

const DIST = path.join(__dirname, '../dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Example route to verify Spotify link
app.post('/api/verify', requireAuth, async (req, res) => {
  console.log('Request received at /api/verify');

  const { link } = req.body;

  console.log('Received link:', link);

  const songId = link.split('/track/')[1]?.split('?')[0];

  console.log('Extracted song ID:', songId);

  if (!songId) {
    return res.status(400).json({ error: 'Invalid Spotify link' });
  }

  try {
    // Get Spotify token
    const accessToken = await getSpotifyAccessToken();

    console.log('Access token received');

    // Fetch song details from Spotify
    const response = await fetch(
      `https://api.spotify.com/v1/tracks/${songId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();

    console.log('Spotify API response:', data);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Send useful data back to frontend
    res.json({
      title: data.name,
      artist: data.artists[0].name,
      album: data.album.name,
      albumArt: data.album.images[0].url,
      spotifyUri: data.uri,
      spotifyUrl: data.external_urls.spotify,
    });

  } catch (error) {
    console.error('Error fetching song details:', error);

    res.status(500).json({
      error: 'Failed to fetch song details',
      details: error.message,
    });
  }
});
  
app.post('/api/send', (req, res) => {
  const song = req.body;
  io.emit('song-received', song);
  res.json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  scheduleMidnightClear();
});
