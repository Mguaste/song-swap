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

app.patch('/api/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE name = $1', [req.session.user.name]);
  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE name = $2', [newHash, req.session.user.name]);
  res.json({ success: true });
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

const searchItunes = async (title, artist) => {
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
    const data = await res.json();
    const url = data.results?.[0]?.trackViewUrl;
    return url ? { url } : null;
  } catch { return null; }
};

const searchYouTubeMusic = async (title, artist) => {
  if (!process.env.YOUTUBE_API_KEY) return null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=10&maxResults=1&key=${process.env.YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    const videoId = data.items?.[0]?.id?.videoId;
    return videoId ? { url: `https://music.youtube.com/watch?v=${videoId}` } : null;
  } catch { return null; }
};

app.post('/api/verify', requireAuth, async (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'Link required' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = {};
    if (process.env.ODESLI_API_KEY) headers['x-api-key'] = process.env.ODESLI_API_KEY;
    const oRes = await fetch(
      `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(link)}&userCountry=US`,
      { signal: controller.signal, headers }
    );
    clearTimeout(timeout);
    if (oRes.status === 404) return res.status(404).json({ error: 'Song not found on any platform' });
    if (oRes.status === 429) return res.status(429).json({ error: 'Rate limited — try again in a moment' });
    if (!oRes.ok) return res.status(502).json({ error: 'Music lookup service unavailable' });
    const data = await oRes.json();
    const entity = data.entitiesByUniqueId?.[data.entityUniqueId];
    if (!entity) return res.status(404).json({ error: 'Song not found' });

    const platformLinks = { ...(data.linksByPlatform ?? {}) };

    // Fill in Apple Music and YouTube Music if song.link didn't return them
    const [itunesResult, ytResult] = await Promise.all([
      platformLinks.appleMusic ? null : searchItunes(entity.title, entity.artistName),
      platformLinks.youtubeMusic ? null : searchYouTubeMusic(entity.title, entity.artistName),
    ]);
    if (itunesResult) platformLinks.appleMusic = itunesResult;
    if (ytResult) platformLinks.youtubeMusic = ytResult;

    const spotifyLinks = platformLinks.spotify ?? null;
    res.json({
      title: entity.title,
      artist: entity.artistName,
      album: entity.albumName ?? null,
      albumArt: entity.thumbnailUrl ?? null,
      spotifyUri: spotifyLinks?.nativeAppUriMobile ?? null,
      spotifyUrl: spotifyLinks?.url ?? null,
      platformLinks,
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
