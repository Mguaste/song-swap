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

const generateFriendCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      friend_code TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id SERIAL PRIMARY KEY,
      requester_id INT REFERENCES users(id),
      receiver_id INT REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(requester_id, receiver_id)
    );
    CREATE TABLE IF NOT EXISTS song_history (
      id SERIAL PRIMARY KEY,
      title TEXT,
      artist TEXT,
      album TEXT,
      album_art TEXT,
      spotify_uri TEXT,
      spotify_url TEXT,
      sent_by TEXT,
      friendship_id INT REFERENCES friendships(id),
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS spotify_tokens (
      id INT PRIMARY KEY DEFAULT 1,
      refresh_token TEXT
    );
  `);

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS friendship_id INT REFERENCES friendships(id)');
  await pool.query('ALTER TABLE song_history DROP CONSTRAINT IF EXISTS song_history_spotify_uri_key');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_spotify_tokens (
      user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      refresh_token TEXT NOT NULL,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE friendships ADD COLUMN IF NOT EXISTS spotify_playlist_id TEXT');
  await pool.query('ALTER TABLE friendships ADD COLUMN IF NOT EXISTS playlist_creating BOOLEAN DEFAULT FALSE');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS platform_links JSONB');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS source_url TEXT');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS odesli_page_url TEXT');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_platform TEXT DEFAULT 'spotify'");

  // Generate friend codes for existing users that don't have one
  const { rows: needsCodes } = await pool.query('SELECT id FROM users WHERE friend_code IS NULL');
  for (const user of needsCodes) {
    let code, unique = false;
    while (!unique) {
      code = generateFriendCode();
      const { rows } = await pool.query('SELECT id FROM users WHERE friend_code = $1', [code]);
      unique = rows.length === 0;
    }
    await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [code, user.id]);
  }

  // Migrate singleton Spotify token → per-user table (one-time, idempotent)
  const { rows: adminUser } = await pool.query(`SELECT id FROM users WHERE LOWER(name) = 'mguaste'`);
  const { rows: oldToken } = await pool.query('SELECT refresh_token FROM spotify_tokens WHERE id = 1');
  if (adminUser[0] && oldToken[0]?.refresh_token) {
    await pool.query(
      `INSERT INTO user_spotify_tokens (user_id, refresh_token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
      [adminUser[0].id, oldToken[0].refresh_token]
    );
    console.log('Migrated singleton Spotify token to Mguaste user record.');
  }

  // Seed env-var users if table is empty
  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count) === 0) {
    const envUsers = [
      { name: process.env.USER1_NAME, password: process.env.USER1_PASSWORD },
      { name: process.env.USER2_NAME, password: process.env.USER2_PASSWORD },
    ].filter(u => u.name && u.password);
    for (const u of envUsers) {
      const hash = await bcrypt.hash(u.password, 10);
      const code = generateFriendCode();
      await pool.query(
        'INSERT INTO users (name, password_hash, friend_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [u.name, hash, code]
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

const getUserAccessToken = async (userId) => {
  const { rows } = await pool.query('SELECT refresh_token FROM user_spotify_tokens WHERE user_id = $1', [userId]);
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
    await pool.query('UPDATE user_spotify_tokens SET refresh_token = $1, updated_at = NOW() WHERE user_id = $2', [data.refresh_token, userId]);
  }
  return data.access_token ?? null;
};

const createCollaborativePlaylist = async (ownerUserId, friendshipId) => {
  const { rows: claim } = await pool.query(
    `UPDATE friendships SET playlist_creating = TRUE
     WHERE id = $1 AND spotify_playlist_id IS NULL AND playlist_creating = FALSE
     RETURNING id`,
    [friendshipId]
  );
  if (claim.length === 0) return;

  try {
    const accessToken = await getUserAccessToken(ownerUserId);
    if (!accessToken) throw new Error('No access token for user ' + ownerUserId);

    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();

    const { rows: fship } = await pool.query(
      `SELECT u1.name AS name1, u2.name AS name2
       FROM friendships f
       JOIN users u1 ON u1.id = f.requester_id
       JOIN users u2 ON u2.id = f.receiver_id
       WHERE f.id = $1`,
      [friendshipId]
    );
    const playlistName = `Song Swap: ${fship[0].name1} & ${fship[0].name2}`;

    const createRes = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playlistName, public: false, collaborative: true, description: 'Auto-created by Song Swap' }),
    });
    const playlist = await createRes.json();
    if (!playlist.id) throw new Error('Spotify did not return a playlist id: ' + JSON.stringify(playlist));

    await pool.query(
      'UPDATE friendships SET spotify_playlist_id = $1, playlist_creating = FALSE WHERE id = $2',
      [playlist.id, friendshipId]
    );

    const { rows: songs } = await pool.query(
      'SELECT spotify_uri FROM song_history WHERE friendship_id = $1 AND spotify_uri IS NOT NULL ORDER BY sent_at ASC',
      [friendshipId]
    );
    const uris = songs.map(s => s.spotify_uri);
    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }

    console.log(`Created playlist ${playlist.id} for friendship ${friendshipId}, backfilled ${uris.length} tracks.`);
  } catch (err) {
    await pool.query('UPDATE friendships SET playlist_creating = FALSE WHERE id = $1', [friendshipId]);
    console.error('createCollaborativePlaylist failed:', err);
  }
};

const checkAndCreatePlaylistForFriendship = async (friendshipId) => {
  const { rows } = await pool.query(
    `SELECT f.requester_id, f.spotify_playlist_id,
            ust1.refresh_token AS requester_token,
            ust2.refresh_token AS receiver_token
     FROM friendships f
     LEFT JOIN user_spotify_tokens ust1 ON ust1.user_id = f.requester_id
     LEFT JOIN user_spotify_tokens ust2 ON ust2.user_id = f.receiver_id
     WHERE f.id = $1 AND f.status = 'accepted'`,
    [friendshipId]
  );
  if (rows.length === 0) return;
  const f = rows[0];
  if (f.spotify_playlist_id) return;
  if (!f.requester_token || !f.receiver_token) return;
  await createCollaborativePlaylist(f.requester_id, friendshipId);
};

const addTrackToFriendshipPlaylist = async (friendshipId, spotifyUri) => {
  const { rows } = await pool.query(
    'SELECT spotify_playlist_id, requester_id FROM friendships WHERE id = $1',
    [friendshipId]
  );
  const playlistId = rows[0]?.spotify_playlist_id;
  if (!playlistId) return;
  const accessToken = await getUserAccessToken(rows[0].requester_id);
  if (!accessToken) return;
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

// { friendshipId: { userName: songEntry } }
const lastSentByFriendship = {};

const clearLastSent = () => {
  for (const k of Object.keys(lastSentByFriendship)) delete lastSentByFriendship[k];
};

const scheduleMidnightClear = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    clearLastSent();
    io.emit('song-cleared');
    console.log('Song cleared at midnight');
    scheduleMidnightClear();
  }, midnight - now);
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

  socket.on('join-friendship', (friendshipId) => {
    socket.join(`friendship-${friendshipId}`);
  });

  socket.on('send-song', async ({ song, sentBy, friendshipId }) => {
    const { rows: dup } = await pool.query(
      `SELECT * FROM song_history WHERE friendship_id = $1
       AND (
         (odesli_page_url IS NOT NULL AND odesli_page_url = $2)
         OR (odesli_page_url IS NULL AND spotify_uri IS NOT NULL AND spotify_uri = $3)
       )`,
      [friendshipId, song.odesliPageUrl ?? null, song.spotifyUri ?? null]
    );
    if (dup.length > 0) {
      const d = dup[0];
      socket.emit('duplicate-song', {
        title: d.title, artist: d.artist, album: d.album,
        albumArt: d.album_art, spotifyUri: d.spotify_uri,
        spotifyUrl: d.spotify_url, platformLinks: d.platform_links ?? null,
        sourceUrl: d.source_url ?? null, odesliPageUrl: d.odesli_page_url ?? null,
        sentBy: d.sent_by, sentAt: d.sent_at,
      });
      return;
    }
    await pool.query(
      `INSERT INTO song_history
        (title, artist, album, album_art, spotify_uri, spotify_url,
         platform_links, source_url, odesli_page_url, sent_by, friendship_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [song.title, song.artist, song.album, song.albumArt, song.spotifyUri ?? null,
       song.spotifyUrl ?? null, song.platformLinks ? JSON.stringify(song.platformLinks) : null,
       song.sourceUrl ?? null, song.odesliPageUrl ?? null, sentBy, friendshipId]
    );
    const entry = { ...song, sentBy, sentAt: new Date().toISOString(), friendshipId };
    if (!lastSentByFriendship[friendshipId]) lastSentByFriendship[friendshipId] = {};
    lastSentByFriendship[friendshipId][sentBy] = entry;
    socket.emit('send-success');
    socket.to(`friendship-${friendshipId}`).emit('song-received', { ...song, friendshipId });
    io.to(`friendship-${friendshipId}`).emit('history-updated', entry);
    if (song.spotifyUri) {
      addTrackToFriendshipPlaylist(friendshipId, song.spotifyUri).catch(err => console.error('Playlist track add failed:', err));
    }
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});


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

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  let code, unique = false;
  while (!unique) {
    code = generateFriendCode();
    const { rows } = await pool.query('SELECT id FROM users WHERE friend_code = $1', [code]);
    unique = rows.length === 0;
  }

  await pool.query('INSERT INTO users (name, password_hash, friend_code) VALUES ($1, $2, $3)', [trimmed, passwordHash, code]);
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

app.get('/api/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT name, friend_code, COALESCE(preferred_platform, 'spotify') AS preferred_platform FROM users WHERE name = $1",
    [req.session.user.name]
  );
  res.json(rows[0]);
});

app.patch('/api/me/preferred-platform', requireAuth, async (req, res) => {
  const VALID = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal'];
  const { platform } = req.body;
  if (!VALID.includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
  await pool.query('UPDATE users SET preferred_platform = $1 WHERE name = $2', [platform, req.session.user.name]);
  res.json({ preferred_platform: platform });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Send a friend request by friend code
app.post('/api/friends/add', requireAuth, async (req, res) => {
  const { friendCode } = req.body;
  if (!friendCode) return res.status(400).json({ error: 'Friend code required' });

  const { rows: target } = await pool.query('SELECT id, name FROM users WHERE friend_code = $1', [friendCode.toUpperCase()]);
  if (target.length === 0) return res.status(404).json({ error: 'No user found with that friend code' });

  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const myId = me[0].id;
  const theirId = target[0].id;

  if (myId === theirId) return res.status(400).json({ error: 'You cannot add yourself' });

  const { rows: existing } = await pool.query(
    'SELECT id FROM friendships WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)',
    [myId, theirId]
  );
  if (existing.length > 0) return res.status(409).json({ error: 'Friend request already exists or already friends' });

  await pool.query('INSERT INTO friendships (requester_id, receiver_id) VALUES ($1, $2)', [myId, theirId]);
  res.status(201).json({ message: `Friend request sent to ${target[0].name}` });
});

// Get incoming pending friend requests
app.get('/api/friends/requests', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT f.id, u.name AS from_name, u.friend_code AS from_code, f.created_at
     FROM friendships f JOIN users u ON u.id = f.requester_id
     WHERE f.receiver_id = $1 AND f.status = 'pending'`,
    [me[0].id]
  );
  res.json(rows);
});

// Accept a friend request
app.post('/api/friends/accept/:id', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    "UPDATE friendships SET status = 'accepted' WHERE id = $1 AND receiver_id = $2 AND status = 'pending' RETURNING *",
    [req.params.id, me[0].id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
  checkAndCreatePlaylistForFriendship(rows[0].id).catch(err =>
    console.error('Post-accept playlist check failed:', err)
  );
  res.json({ success: true });
});

// Decline or cancel a friend request
app.delete('/api/friends/requests/:id', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  await pool.query(
    'DELETE FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2)',
    [req.params.id, me[0].id]
  );
  res.json({ success: true });
});

// List accepted friends
app.get('/api/friends', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT f.id AS friendship_id,
       CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name,
       CASE WHEN f.requester_id = $1 THEN u2.friend_code ELSE u1.friend_code END AS friend_code,
       f.spotify_playlist_id
     FROM friendships f
     JOIN users u1 ON u1.id = f.requester_id
     JOIN users u2 ON u2.id = f.receiver_id
     WHERE (f.requester_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'`,
    [me[0].id]
  );
  res.json(rows);
});

// Song history for a specific friendship
// Latest unread activity per friendship (most recent song NOT sent by current user)
app.get('/api/friends/latest-activity', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id, name FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (sh.friendship_id) sh.friendship_id, sh.sent_at, sh.sent_by
     FROM song_history sh
     JOIN friendships f ON f.id = sh.friendship_id
     WHERE (f.requester_id = $1 OR f.receiver_id = $1)
       AND f.status = 'accepted'
       AND sh.sent_by != $2
     ORDER BY sh.friendship_id, sh.sent_at DESC`,
    [me[0].id, me[0].name]
  );
  res.json(rows.map(r => ({ friendshipId: r.friendship_id, sentAt: r.sent_at, sentBy: r.sent_by })));
});

app.get('/api/friends/:id/history', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows: membership } = await pool.query(
    'SELECT id FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2) AND status = $3',
    [req.params.id, me[0].id, 'accepted']
  );
  if (membership.length === 0) return res.status(403).json({ error: 'Forbidden' });

  const { rows } = await pool.query(
    'SELECT * FROM song_history WHERE friendship_id = $1 ORDER BY sent_at DESC',
    [req.params.id]
  );
  res.json(rows.map(r => ({
    title: r.title, artist: r.artist, album: r.album,
    albumArt: r.album_art, spotifyUri: r.spotify_uri, spotifyUrl: r.spotify_url,
    platformLinks: r.platform_links ?? null, sourceUrl: r.source_url ?? null,
    odesliPageUrl: r.odesli_page_url ?? null, sentBy: r.sent_by, sentAt: r.sent_at,
  })));
});

// Current song from the other person in a friendship
app.get('/api/friends/:id/current-song', requireAuth, (req, res) => {
  const myName = req.session.user.name;
  const fid = parseInt(req.params.id);
  const songs = lastSentByFriendship[fid] || {};
  const other = Object.entries(songs).find(([name]) => name !== myName);
  res.json(other ? other[1] : null);
});

app.get('/api/friends/:id/my-song', requireAuth, (req, res) => {
  const myName = req.session.user.name;
  const fid = parseInt(req.params.id);
  const songs = lastSentByFriendship[fid] || {};
  res.json(songs[myName] || null);
});

app.get('/api/history', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM song_history ORDER BY sent_at ASC');
  res.json(rows.map(r => ({
    title: r.title, artist: r.artist, album: r.album,
    albumArt: r.album_art, spotifyUri: r.spotify_uri, spotifyUrl: r.spotify_url,
    platformLinks: r.platform_links ?? null, sourceUrl: r.source_url ?? null,
    odesliPageUrl: r.odesli_page_url ?? null, sentBy: r.sent_by, sentAt: r.sent_at,
  })));
});

app.delete('/api/admin/history', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM song_history');
  clearLastSent();
  io.emit('song-cleared');
  io.emit('history-cleared');
  res.json({ success: true });
});

app.get('/api/spotify-auth', requireAuth, (req, res) => {
  const state = Buffer.from(req.session.user.name).toString('base64');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: 'playlist-modify-public playlist-modify-private',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    state,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/api/spotify-callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code or state');

  let userName;
  try {
    userName = Buffer.from(state, 'base64').toString('utf8');
  } catch {
    return res.status(400).send('Invalid state');
  }

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
  if (!tokens.refresh_token) return res.status(500).send('Failed to get Spotify token');

  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE name = $1', [userName]);
  if (userRows.length === 0) return res.status(404).send('User not found');
  const userId = userRows[0].id;

  await pool.query(
    `INSERT INTO user_spotify_tokens (user_id, refresh_token)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET refresh_token = $2, updated_at = NOW()`,
    [userId, tokens.refresh_token]
  );

  // Trigger playlist creation for all accepted friendships where other user also has Spotify
  const { rows: friendships } = await pool.query(
    `SELECT id FROM friendships WHERE (requester_id = $1 OR receiver_id = $1) AND status = 'accepted'`,
    [userId]
  );
  for (const f of friendships) {
    checkAndCreatePlaylistForFriendship(f.id).catch(err =>
      console.error(`Post-connect playlist check failed for friendship ${f.id}:`, err)
    );
  }

  res.redirect('/?spotify=connected');
});

app.get('/api/spotify-status', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query('SELECT refresh_token FROM user_spotify_tokens WHERE user_id = $1', [me[0].id]);
  res.json({ connected: !!rows[0]?.refresh_token });
});

app.delete('/api/spotify-disconnect', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  await pool.query('DELETE FROM user_spotify_tokens WHERE user_id = $1', [me[0].id]);
  res.json({ success: true });
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
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'Link required' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = {};
    if (process.env.ODESLI_API_KEY) headers['x-api-key'] = process.env.ODESLI_API_KEY;
    const oRes = await fetch(
      `https://api.odesli.co/resolve?url=${encodeURIComponent(link)}&userCountry=US`,
      { signal: controller.signal, headers }
    );
    clearTimeout(timeout);
    if (oRes.status === 404) return res.status(404).json({ error: 'Song not found on any platform' });
    if (oRes.status === 429) return res.status(429).json({ error: 'Rate limited — try again in a moment' });
    if (!oRes.ok) return res.status(502).json({ error: 'Music lookup service unavailable' });
    const data = await oRes.json();
    const entity = data.entitiesByUniqueId?.[data.entityUniqueId];
    if (!entity) return res.status(404).json({ error: 'Song not found' });
    const spotifyLinks = data.linksByPlatform?.spotify ?? null;
    res.json({
      title: entity.title,
      artist: entity.artistName,
      album: entity.albumName ?? null,
      albumArt: entity.thumbnailUrl ?? null,
      spotifyUri: spotifyLinks?.nativeAppUriMobile ?? null,
      spotifyUrl: spotifyLinks?.url ?? null,
      platformLinks: data.linksByPlatform ?? {},
      sourceUrl: link,
      odesliPageUrl: data.pageUrl ?? null,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Music lookup timed out' });
    res.status(502).json({ error: 'Music lookup service unavailable' });
  }
});

initDb().then(async () => {
  const { rows } = await pool.query(
    'SELECT DISTINCT ON (sent_by, friendship_id) * FROM song_history ORDER BY sent_by, friendship_id, sent_at DESC'
  );
  for (const r of rows) {
    if (!r.friendship_id) continue;
    if (!lastSentByFriendship[r.friendship_id]) lastSentByFriendship[r.friendship_id] = {};
    lastSentByFriendship[r.friendship_id][r.sent_by] = {
      title: r.title, artist: r.artist, album: r.album,
      albumArt: r.album_art, spotifyUri: r.spotify_uri, spotifyUrl: r.spotify_url,
      platformLinks: r.platform_links ?? null, sourceUrl: r.source_url ?? null,
      odesliPageUrl: r.odesli_page_url ?? null, sentBy: r.sent_by, sentAt: r.sent_at,
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
