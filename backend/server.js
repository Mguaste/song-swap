const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS song_history (
      id SERIAL PRIMARY KEY,
      title TEXT,
      artist TEXT,
      album TEXT,
      album_art TEXT,
      spotify_uri TEXT UNIQUE,
      spotify_url TEXT,
      sent_by TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS spotify_tokens (
      id INT PRIMARY KEY DEFAULT 1,
      refresh_token TEXT
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count) === 0) {
    const envUsers = [
      { name: process.env.USER1_NAME, password: process.env.USER1_PASSWORD },
      { name: process.env.USER2_NAME, password: process.env.USER2_PASSWORD },
    ].filter(u => u.name && u.password);
    for (const u of envUsers) {
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        'INSERT INTO users (name, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [u.name, hash]
      );
    }
    if (envUsers.length) console.log(`Seeded ${envUsers.length} user(s) from environment variables.`);
  }

  console.log('Database tables ready.');
};

const getPlaylistAccessToken = async () => {
  const { rows } = await pool.query('SELECT refresh_token FROM spotify_tokens WHERE id = 1');
  const refreshToken = rows[0]?.refresh_token;
  if (!refreshToken) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (data.refresh_token) {
    await pool.query('UPDATE spotify_tokens SET refresh_token = $1 WHERE id = 1', [data.refresh_token]);
  }
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

const lastSentBy = {};

const clearLastSent = () => { for (const k of Object.keys(lastSentBy)) delete lastSentBy[k]; };

const scheduleMidnightClear = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    clearLastSent();
    io.emit('song-cleared');
    console.log('Song cleared at midnight');
    scheduleMidnightClear();
  }, msUntilMidnight);
};

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
  socket.on('send-song', async ({ song, sentBy }) => {
    const { rows } = await pool.query('SELECT * FROM song_history WHERE spotify_uri = $1', [song.spotifyUri]);
    if (rows.length > 0) {
      const dup = rows[0];
      socket.emit('duplicate-song', {
        title: dup.title, artist: dup.artist, album: dup.album,
        albumArt: dup.album_art, spotifyUri: dup.spotify_uri,
        spotifyUrl: dup.spotify_url, sentBy: dup.sent_by, sentAt: dup.sent_at,
      });
      return;
    }
    await pool.query(
      'INSERT INTO song_history (title, artist, album, album_art, spotify_uri, spotify_url, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [song.title, song.artist, song.album, song.albumArt, song.spotifyUri, song.spotifyUrl, sentBy]
    );
    const entry = { ...song, sentBy, sentAt: new Date().toISOString() };
    lastSentBy[sentBy] = entry;
    socket.emit('send-success');
    socket.broadcast.emit('song-received', song);
    io.emit('history-updated', entry);
    addToPlaylist(song.spotifyUri).catch(err => console.error('Playlist add failed:', err));
  });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const getSpotifyAccessToken = async () => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json();
  console.log("Token status:", response.status);
  console.log("Token response:", data);
  if (!response.ok) throw new Error(JSON.stringify(data));
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

app.post('/api/register', async (req, res) => {
  const { name, password } = req.body;
  const trimmed = name?.trim();
  if (!trimmed || !password) return res.status(400).json({ error: 'Name and password required' });
  if (trimmed.length > 30) return res.status(400).json({ error: 'Name too long (max 30 characters)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (rows.length > 0) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (name, password_hash) VALUES ($1, $2)', [trimmed, passwordHash]);

  req.session.user = { name: trimmed };
  res.status(201).json({ name: trimmed });
});

app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(name) = LOWER($1)', [name]);
  if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { name: rows[0].name };
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

app.get('/api/history', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM song_history ORDER BY sent_at ASC');
  res.json(rows.map(r => ({
    title: r.title, artist: r.artist, album: r.album,
    albumArt: r.album_art, spotifyUri: r.spotify_uri,
    spotifyUrl: r.spotify_url, sentBy: r.sent_by, sentAt: r.sent_at,
  })));
});

app.delete('/api/admin/history', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM song_history');
  clearLastSent();
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
    await pool.query(
      'INSERT INTO spotify_tokens (id, refresh_token) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET refresh_token = $1',
      [tokens.refresh_token]
    );
    res.redirect('/?spotify=connected');
  } else {
    res.status(500).send('Failed to get Spotify token');
  }
});

app.get('/api/spotify-status', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT refresh_token FROM spotify_tokens WHERE id = 1');
  res.json({ connected: !!rows[0]?.refresh_token });
});

app.delete('/api/current-songs', requireAuth, (req, res) => {
  clearLastSent();
  io.emit('all-songs-cleared');
  res.json({ success: true });
});

app.get('/api/current-song', requireAuth, (req, res) => {
  const myName = req.session.user.name;
  const other = Object.values(lastSentBy).find(e => e.sentBy !== myName);
  res.json(other || null);
});

app.delete('/api/admin/current-song', requireAdmin, (req, res) => {
  clearLastSent();
  io.emit('all-songs-cleared');
  res.json({ success: true });
});

const DIST = path.join(__dirname, '../dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.post('/api/verify', requireAuth, async (req, res) => {
  console.log('Request received at /api/verify');
  const { link } = req.body;
  console.log('Received link:', link);
  const songId = link.split('/track/')[1]?.split('?')[0];
  console.log('Extracted song ID:', songId);
  if (!songId) return res.status(400).json({ error: 'Invalid Spotify link' });

  try {
    const accessToken = await getSpotifyAccessToken();
    console.log('Access token received');
    const response = await fetch(`https://api.spotify.com/v1/tracks/${songId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    console.log('Spotify API response:', data);
    if (!response.ok) return res.status(response.status).json(data);
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
    res.status(500).json({ error: 'Failed to fetch song details', details: error.message });
  }
});

app.post('/api/send', (req, res) => {
  const song = req.body;
  io.emit('song-received', song);
  res.json({ success: true });
});

initDb().then(async () => {
  const { rows } = await pool.query(
    'SELECT DISTINCT ON (sent_by) * FROM song_history ORDER BY sent_by, sent_at DESC'
  );
  for (const r of rows) {
    lastSentBy[r.sent_by] = {
      title: r.title, artist: r.artist, album: r.album,
      albumArt: r.album_art, spotifyUri: r.spotify_uri,
      spotifyUrl: r.spotify_url, sentBy: r.sent_by, sentAt: r.sent_at,
    };
  }
  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    scheduleMidnightClear();
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
