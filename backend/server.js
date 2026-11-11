const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Railway's Postgres needs SSL; a local dev database usually doesn't have it
const isLocalDb = (() => {
  try {
    const host = new URL(process.env.DATABASE_URL || '').hostname;
    return ['', 'localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  } catch { return false; }
})();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

// song_history row → the shape the frontend uses
const rowToEntry = (r) => ({
  id: r.id,
  title: r.title, artist: r.artist, album: r.album,
  albumArt: r.album_art, spotifyUri: r.spotify_uri, spotifyUrl: r.spotify_url,
  platformLinks: r.platform_links ?? null, sourceUrl: r.source_url ?? null,
  odesliPageUrl: r.odesli_page_url ?? null, sentBy: r.sent_by, sentAt: r.sent_at,
  friendshipId: r.friendship_id, rating: r.rating ?? null,
});

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
  `);

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS friendship_id INT REFERENCES friendships(id)');
  await pool.query('ALTER TABLE song_history DROP CONSTRAINT IF EXISTS song_history_spotify_uri_key');

  // Leftovers from the retired Spotify playlist feature: stored users' Spotify
  // refresh tokens, which nothing uses anymore. Remove them (no-op once gone).
  await pool.query('DROP TABLE IF EXISTS user_spotify_tokens');
  await pool.query('DROP TABLE IF EXISTS spotify_tokens');
  await pool.query('ALTER TABLE friendships DROP COLUMN IF EXISTS spotify_playlist_id');
  await pool.query('ALTER TABLE friendships DROP COLUMN IF EXISTS playlist_creating');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS platform_links JSONB');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS source_url TEXT');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS odesli_page_url TEXT');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_platform TEXT DEFAULT 'spotify'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE');
  // 1–5 rating, set only by the friend who received the song
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5)');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ');
  // When each user last looked at each swap, so unread status follows the
  // account across devices instead of living in one browser's localStorage
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendship_reads (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friendship_id INT NOT NULL REFERENCES friendships(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, friendship_id)
    )
  `);
  // One-time: carry over the original hard-coded admin if no admin exists yet
  await pool.query(`UPDATE users SET is_admin = TRUE
    WHERE LOWER(name) = 'mguaste' AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`);

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

// The built frontend's entry bundle (e.g. "/assets/index-CKELVFdc.js"). Its
// name changes on every deploy, so it doubles as a version id.
const BUILD_ID = (() => {
  try {
    const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
    return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
  } catch { return null; }
})();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
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

// Current songs clear at midnight in RESET_TIMEZONE (the server itself runs
// on UTC). Checking the local date once a minute handles DST without math.
const RESET_TIMEZONE = process.env.RESET_TIMEZONE || 'America/Los_Angeles';
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: RESET_TIMEZONE });
const scheduleMidnightClear = () => {
  let today = localDate();
  setInterval(() => {
    const now = localDate();
    if (now === today) return;
    today = now;
    clearLastSent();
    io.emit('song-cleared');
    console.log(`Songs cleared at midnight (${RESET_TIMEZONE})`);
  }, 60 * 1000).unref();
};

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(bodyParser.json());
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set — session cookies are not properly signed. Set it in .env (local) or Railway variables.');
}
const sessionMiddleware = session({
  // Sessions live in Postgres so deploys/restarts don't log everyone out
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
  },
});
app.use(sessionMiddleware);
// Give sockets the same session as HTTP requests, so socket events can be
// tied to the logged-in user instead of trusting names the client sends
io.engine.use(sessionMiddleware);

// Re-read the session from the store on every event, so a logout or expiry
// after the socket connected is respected. Resolves to { name } or null.
const socketUser = (socket) => new Promise((resolve) => {
  const s = socket.request.session;
  if (!s?.user) return resolve(null);
  s.reload((err) => resolve(err ? null : s.user ?? null));
});

const isFriendshipMember = async (userName, friendshipId) => {
  const id = Number(friendshipId);
  if (!Number.isInteger(id)) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM friendships f
     JOIN users u ON u.id = f.requester_id OR u.id = f.receiver_id
     WHERE f.id = $1 AND u.name = $2 AND f.status = 'accepted'`,
    [id, userName]
  );
  return rows.length > 0;
};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // Lets tabs running an older build notice a deploy and reload themselves
  if (BUILD_ID) socket.emit('build-id', BUILD_ID);

  // Any client-supplied name is ignored; the room comes from the session
  socket.on('join-user', async () => {
    try {
      const user = await socketUser(socket);
      if (user) socket.join(`user-${user.name}`);
    } catch (err) { console.error('join-user failed:', err); }
  });

  socket.on('join-friendship', async (friendshipId) => {
    try {
      const user = await socketUser(socket);
      if (user && await isFriendshipMember(user.name, friendshipId)) {
        socket.join(`friendship-${Number(friendshipId)}`);
      }
    } catch (err) { console.error('join-friendship failed:', err); }
  });

  socket.on('send-song', async ({ song, friendshipId: rawId } = {}) => {
    try {
      const user = await socketUser(socket);
      if (!user) return socket.emit('send-error', { error: 'Your session expired — log in again' });
      if (!song?.title || !(await isFriendshipMember(user.name, rawId))) {
        return socket.emit('send-error', { error: 'You can only send songs to your friends' });
      }
      const sentBy = user.name;
      const friendshipId = Number(rawId);
      const { rows: dup } = await pool.query(
        `SELECT * FROM song_history WHERE friendship_id = $1
         AND (
           ($2::text IS NOT NULL AND odesli_page_url = $2)
           OR ($3::text IS NOT NULL AND spotify_uri = $3)
           OR (LOWER(title) = LOWER($4) AND LOWER(artist) = LOWER($5))
         )
         LIMIT 1`,
        [friendshipId, song.odesliPageUrl ?? null, song.spotifyUri ?? null, song.title ?? '', song.artist ?? '']
      );
      if (dup.length > 0) {
        socket.emit('duplicate-song', rowToEntry(dup[0]));
        return;
      }
      const { rows: inserted } = await pool.query(
        `INSERT INTO song_history
          (title, artist, album, album_art, spotify_uri, spotify_url,
           platform_links, source_url, odesli_page_url, sent_by, friendship_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [song.title, song.artist, song.album, song.albumArt, song.spotifyUri ?? null,
         song.spotifyUrl ?? null, song.platformLinks ? JSON.stringify(song.platformLinks) : null,
         song.sourceUrl ?? null, song.odesliPageUrl ?? null, sentBy, friendshipId]
      );
      const entry = rowToEntry(inserted[0]);
      if (!lastSentByFriendship[friendshipId]) lastSentByFriendship[friendshipId] = {};
      lastSentByFriendship[friendshipId][sentBy] = entry;
      socket.emit('send-success');
      socket.to(`friendship-${friendshipId}`).emit('song-received', entry);
      // Tell the recipient on every tab, even ones not viewing this friendship,
      // so unread badges and the tab title update live
      const { rows: other } = await pool.query(
        `SELECT u.name FROM friendships f
         JOIN users u ON u.id IN (f.requester_id, f.receiver_id)
         WHERE f.id = $1 AND u.name != $2`,
        [friendshipId, sentBy]
      );
      for (const { name } of other) {
        io.to(`user-${name}`).emit('swap-received', { friendshipId, sentAt: entry.sentAt });
      }
      io.to(`friendship-${friendshipId}`).emit('history-updated', entry);
    } catch (err) {
      // Without this, a DB error here is an unhandled rejection that kills the server
      console.error('send-song failed:', err);
      socket.emit('send-error', { error: 'Could not send that song — try again' });
    }
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});


const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
};

const requireAdmin = async (req, res, next) => {
  if (req.session.user) {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE name = $1', [req.session.user.name]);
    if (rows[0]?.is_admin) return next();
  }
  res.status(403).json({ error: 'Forbidden' });
};

// Per-IP throttle on auth endpoints: 15 attempts per 15 minutes
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authAttempts = new Map();
const authLimiter = (req, res, next) => {
  const now = Date.now();
  const entry = authAttempts.get(req.ip) ?? { count: 0, start: now };
  if (now - entry.start > AUTH_WINDOW_MS) { entry.count = 0; entry.start = now; }
  entry.count++;
  authAttempts.set(req.ip, entry);
  if (entry.count > 15) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  next();
};
setInterval(() => {
  const cutoff = Date.now() - AUTH_WINDOW_MS;
  for (const [ip, e] of authAttempts) if (e.start < cutoff) authAttempts.delete(ip);
}, AUTH_WINDOW_MS).unref();

app.post('/api/register', authLimiter, async (req, res) => {
  const { name, password, preferredPlatform } = req.body;
  const trimmed = name?.trim();
  if (!trimmed || !password) return res.status(400).json({ error: 'Name and password required' });
  if (trimmed.length > 30) return res.status(400).json({ error: 'Name too long (max 30 characters)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const VALID_PLATFORMS = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal', 'deezer'];
  const platform = VALID_PLATFORMS.includes(preferredPlatform) ? preferredPlatform : 'spotify';

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  let code, unique = false;
  while (!unique) {
    code = generateFriendCode();
    const { rows } = await pool.query('SELECT id FROM users WHERE friend_code = $1', [code]);
    unique = rows.length === 0;
  }

  await pool.query(
    'INSERT INTO users (name, password_hash, friend_code, preferred_platform) VALUES ($1, $2, $3, $4)',
    [trimmed, passwordHash, code, platform]
  );
  req.session.user = { name: trimmed };
  res.status(201).json({ name: trimmed });
});

app.post('/api/login', authLimiter, async (req, res) => {
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
    "SELECT name, friend_code, COALESCE(preferred_platform, 'spotify') AS preferred_platform, is_admin FROM users WHERE name = $1",
    [req.session.user.name]
  );
  res.json(rows[0]);
});

app.patch('/api/me/preferred-platform', requireAuth, async (req, res) => {
  const VALID = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal', 'deezer'];
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
  io.to(`user-${target[0].name}`).emit('friend-request-received');
  res.status(201).json({ message: `Friend request sent to ${target[0].name}` });
});

// Get incoming pending friend requests
// Outgoing friend requests that haven't been answered yet
app.get('/api/friends/sent', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, u.name AS to_name, f.created_at
     FROM friendships f
     JOIN users me ON me.id = f.requester_id
     JOIN users u ON u.id = f.receiver_id
     WHERE me.name = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [req.session.user.name]
  );
  res.json(rows);
});

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
  // Notify both users so their friend lists update in real time
  const { rows: requester } = await pool.query('SELECT name FROM users WHERE id = $1', [rows[0].requester_id]);
  const { rows: receiver } = await pool.query('SELECT name FROM users WHERE id = $1', [rows[0].receiver_id]);
  io.to(`user-${requester[0].name}`).emit('friendship-accepted');
  io.to(`user-${receiver[0].name}`).emit('friendship-accepted');
  res.json({ success: true });
});

// Decline or cancel a friend request
app.delete('/api/friends/requests/:id', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows: fs } = await pool.query(
    'SELECT requester_id, receiver_id FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2)',
    [req.params.id, me[0].id]
  );
  await pool.query(
    'DELETE FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2)',
    [req.params.id, me[0].id]
  );
  if (fs.length > 0) {
    const { rows: requester } = await pool.query('SELECT name FROM users WHERE id = $1', [fs[0].requester_id]);
    const { rows: receiver } = await pool.query('SELECT name FROM users WHERE id = $1', [fs[0].receiver_id]);
    io.to(`user-${requester[0].name}`).emit('friend-request-declined');
    io.to(`user-${receiver[0].name}`).emit('friend-request-declined');
  }
  res.json({ success: true });
});

// Remove a friend: deletes the friendship and its whole song history
app.delete('/api/friends/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid friend' });
  const client = await pool.connect();
  let names;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT u1.name AS a, u2.name AS b FROM friendships f
       JOIN users u1 ON u1.id = f.requester_id
       JOIN users u2 ON u2.id = f.receiver_id
       WHERE f.id = $1 AND f.status = 'accepted' AND (u1.name = $2 OR u2.name = $2)
       FOR UPDATE OF f`,
      [id, req.session.user.name]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Friend not found' });
    }
    names = [rows[0].a, rows[0].b];
    await client.query('DELETE FROM song_history WHERE friendship_id = $1', [id]);
    await client.query('DELETE FROM friendships WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  delete lastSentByFriendship[id];
  io.in(`friendship-${id}`).socketsLeave(`friendship-${id}`);
  for (const n of names) io.to(`user-${n}`).emit('friendship-removed', { friendshipId: id });
  res.json({ success: true });
});

// List accepted friends
app.get('/api/friends', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT f.id AS friendship_id,
       CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name,
       CASE WHEN f.requester_id = $1 THEN u2.friend_code ELSE u1.friend_code END AS friend_code
     FROM friendships f
     JOIN users u1 ON u1.id = f.requester_id
     JOIN users u2 ON u2.id = f.receiver_id
     WHERE (f.requester_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'`,
    [me[0].id]
  );
  res.json(rows);
});

// Song history for a specific friendship
// Latest activity per friendship (most recent song NOT sent by current user),
// and whether it's unread. Both times come from the DB clock, so device clock
// skew can't affect it.
app.get('/api/friends/latest-activity', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id, name FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (sh.friendship_id) sh.friendship_id, sh.sent_at, sh.sent_by, r.last_read_at
     FROM song_history sh
     JOIN friendships f ON f.id = sh.friendship_id
     LEFT JOIN friendship_reads r ON r.friendship_id = sh.friendship_id AND r.user_id = $1
     WHERE (f.requester_id = $1 OR f.receiver_id = $1)
       AND f.status = 'accepted'
       AND sh.sent_by != $2
     ORDER BY sh.friendship_id, sh.sent_at DESC`,
    [me[0].id, me[0].name]
  );
  res.json(rows.map(r => ({
    friendshipId: r.friendship_id, sentAt: r.sent_at, sentBy: r.sent_by,
    unread: !r.last_read_at || new Date(r.sent_at) > new Date(r.last_read_at),
  })));
});

// Mark a swap as read for the current user, and tell their other tabs/devices
app.post('/api/friends/:id/read', requireAuth, async (req, res) => {
  const name = req.session.user.name;
  if (!(await isFriendshipMember(name, req.params.id))) return res.status(403).json({ error: 'Forbidden' });
  const friendshipId = Number(req.params.id);
  await pool.query(
    `INSERT INTO friendship_reads (user_id, friendship_id, last_read_at)
     SELECT id, $2, NOW() FROM users WHERE name = $1
     ON CONFLICT (user_id, friendship_id)
     DO UPDATE SET last_read_at = GREATEST(friendship_reads.last_read_at, EXCLUDED.last_read_at)`,
    [name, friendshipId]
  );
  io.to(`user-${name}`).emit('swap-read', { friendshipId });
  res.json({ success: true });
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
  res.json(rows.map(rowToEntry));
});

// Rate a received song 1–5. Only the friend it was sent to can rate it.
app.post('/api/songs/:id/rating', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid song' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be 1–5' });
  }
  const me = req.session.user.name;
  const { rows } = await pool.query(
    `UPDATE song_history sh SET rating = $1, rated_at = NOW()
     FROM friendships f
     JOIN users u ON u.id = f.requester_id OR u.id = f.receiver_id
     WHERE sh.id = $2 AND f.id = sh.friendship_id AND f.status = 'accepted'
       AND u.name = $3 AND sh.sent_by <> $3
     RETURNING sh.id, sh.friendship_id, sh.sent_by, sh.rating`,
    [rating, id, me]
  );
  if (rows.length === 0) return res.status(404).json({ error: "You can only rate songs sent to you" });
  const r = rows[0];
  const current = lastSentByFriendship[r.friendship_id]?.[r.sent_by];
  if (current?.id === r.id) current.rating = r.rating;
  const update = { id: r.id, friendshipId: r.friendship_id, rating: r.rating };
  io.to(`friendship-${r.friendship_id}`).emit('song-rated', update);
  io.to(`user-${r.sent_by}`).emit('song-rated', update);
  res.json(update);
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

// Every friendship's history — admin only (not used by the app UI)
app.get('/api/history', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM song_history ORDER BY sent_at ASC');
  res.json(rows.map(rowToEntry));
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
  // index.html must always be revalidated so a deploy is picked up on reload
  const noCacheHtml = (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  };
  app.use(express.static(DIST, { dotfiles: 'allow', setHeaders: noCacheHtml }));
  app.get('/{*path}', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// ── Song lookup ──────────────────────────────────────────────────────────────
// Odesli/song.link retired its public API (2026-07-31), so we resolve links
// ourselves:
//   1. Read the pasted link's own metadata (title, artist, art, and ISRC
//      when the source provides one).
//   2. Match on the other platforms — by ISRC when we have it (exact
//      recording), otherwise by a strict title + artist comparison.
// Optional credentials (each unlocks more exact matches; all degrade gracefully):
//   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET — Spotify API: ISRCs + Spotify links
//   TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET     — Tidal links (by ISRC) + Tidal input
//   YOUTUBE_API_KEY                           — YouTube Music links
// Amazon Music has no public API; the frontend falls back to a search URL.

const LOOKUP_TIMEOUT_MS = 8000;
const UA = { 'User-Agent': 'song-swap/1.0' };
const fetchWithTimeout = (url, opts = {}) =>
  fetch(url, { ...opts, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
const fetchJson = async (url, opts) => {
  const res = await fetchWithTimeout(url, opts);
  return res.ok ? res.json() : null;
};

const decodeHtml = (s) => s
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const getMeta = (html, key) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, 'i'));
  return m ? decodeHtml(m[1]) : null;
};

// ── Title/artist matching ────────────────────────────────────────────────────
// Search results are fuzzy (searching a song often returns its remixes first),
// so a candidate must have the same title and share the lead artist.
const fold = (s) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = (s) => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const coreTitle = (s) => norm(fold(s)
  .replace(/\s*[([][^)\]]*[)\]]/g, '')     // (feat. X), [Remastered], (Cake Mix)
  .replace(/\s+[-–—]\s+.*$/, '')           // " - Remastered 2009", " - Live"
  .replace(/\s+(feat|ft)\.?\s.*$/, ''));
// Words that mark a different recording of the same song
const ALT_VERSION = /\b(remix|mix|live|acoustic|instrumental|karaoke|cover|sped up|slowed|reverb|demo|piano|pianoforte|orchestral|a cappella|8 bit|tribute)\b/;
const leadArtist = (s) => norm(fold(s).split(/,|&|\s+(?:feat\.?|ft\.?|x|with|and)\s+/)[0]);

const matchScore = (src, title, artist) => {
  const a = leadArtist(src.artist), b = norm(artist);
  if (!a || !b || !(b.includes(a) || a.includes(leadArtist(artist)))) return 0;
  if (norm(title) === norm(src.title)) return 2;
  if (coreTitle(title) !== coreTitle(src.title)) return 0;
  const isAlt = (t) => ALT_VERSION.test(norm(t));
  return isAlt(title) && !isAlt(src.title) ? 0 : 1;
};

// Best-scoring candidate (ties keep the service's own ranking), or null
const pickBest = (src, items, getTitle, getArtist) => {
  let best = null, bestScore = 0;
  for (const item of items ?? []) {
    const s = matchScore(src, getTitle(item), getArtist(item));
    if (s > bestScore) { best = item; bestScore = s; }
  }
  return best;
};

// ── Client-credentials tokens (Spotify, Tidal) ───────────────────────────────
const tokenCache = {};
const getClientToken = async (name, tokenUrl, id, secret) => {
  if (!id || !secret) return null;
  const cached = tokenCache[name];
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  try {
    const data = await fetchJson(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!data?.access_token) return null;
    tokenCache[name] = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  } catch { return null; }
};
const getSpotifyToken = () => getClientToken('spotify', 'https://accounts.spotify.com/api/token',
  process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
const getTidalToken = () => getClientToken('tidal', 'https://auth.tidal.com/v1/oauth2/token',
  process.env.TIDAL_CLIENT_ID, process.env.TIDAL_CLIENT_SECRET);

const spotifyTrackLinks = (id) => ({
  url: `https://open.spotify.com/track/${id}`,
  nativeAppUriMobile: `spotify:track:${id}`,
});

// ── Parsing pasted links ─────────────────────────────────────────────────────
// Returns { platform, id, ... }, { error } for a link we can't use, or null
// for an unrecognized link.
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/(?:[\w-]+\/)?track\/([A-Za-z0-9]{22})/;
const DEEZER_TRACK_RE = /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/;
const NOT_A_TRACK = { error: "That link isn't a single song — paste a link to a track" };

const parseLink = (raw) => {
  const text = raw.trim();
  const uri = text.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return { platform: 'spotify', id: uri[1] };

  let u;
  try { u = new URL(text); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'open.spotify.com') {
    const m = u.href.match(SPOTIFY_TRACK_RE);
    return m ? { platform: 'spotify', id: m[1] } : NOT_A_TRACK;
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') {
    return { platform: 'spotify', shortUrl: u.href, pattern: SPOTIFY_TRACK_RE };
  }
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const id = u.searchParams.get('i') ?? u.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)/)?.[1];
    const country = u.pathname.match(/^\/([a-z]{2})\//)?.[1] ?? 'us';
    return id && /^\d+$/.test(id) ? { platform: 'appleMusic', id, country } : NOT_A_TRACK;
  }
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    const v = u.searchParams.get('v');
    return v && /^[\w-]{11}$/.test(v) ? { platform: 'youtube', id: v } : NOT_A_TRACK;
  }
  if (host === 'youtu.be') {
    const v = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(v) ? { platform: 'youtube', id: v } : NOT_A_TRACK;
  }
  if (host === 'deezer.com') {
    const m = u.href.match(DEEZER_TRACK_RE);
    return m ? { platform: 'deezer', id: m[1] } : NOT_A_TRACK;
  }
  if (host === 'link.deezer.com' || host === 'deezer.page.link') {
    return { platform: 'deezer', shortUrl: u.href, pattern: DEEZER_TRACK_RE };
  }
  if (host === 'tidal.com' || host === 'listen.tidal.com') {
    const m = u.pathname.match(/\/track\/(\d+)/);
    return m ? { platform: 'tidal', id: m[1] } : NOT_A_TRACK;
  }
  if (host.endsWith('music.amazon.com') || host === 'amazon.com') {
    return { error: "Amazon Music links can't be read yet — paste the song from another app" };
  }
  return null;
};

// Short links redirect (sometimes via an HTML page) to the full track URL
const resolveShortLink = async (shortUrl, pattern) => {
  const res = await fetchWithTimeout(shortUrl, { headers: UA });
  return res.url.match(pattern)?.[1] ?? (await res.text()).match(pattern)?.[1] ?? null;
};

// ── Reading the pasted song ──────────────────────────────────────────────────
// Each returns { title, artist, album, albumArt, isrc?, url? } or null if not found.

const lookupSpotify = async (id) => {
  const token = await getSpotifyToken();
  if (token) {
    try {
      const t = await fetchJson(`https://api.spotify.com/v1/tracks/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (t?.name) {
        return {
          title: t.name,
          artist: t.artists.map(a => a.name).join(', '),
          album: t.album?.name ?? null,
          albumArt: t.album?.images?.[0]?.url ?? null,
          isrc: t.external_ids?.isrc ?? null,
        };
      }
    } catch { /* fall through to page scrape */ }
  }
  // No API access: read the public track page's meta tags (no ISRC there).
  // A non-browser User-Agent gets the server-rendered page with og: tags.
  const res = await fetchWithTimeout(`https://open.spotify.com/track/${id}`, { headers: UA });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Spotify page returned ${res.status}`);
  const html = await res.text();
  const title = getMeta(html, 'og:title');
  const parts = getMeta(html, 'og:description')?.split(' · ') ?? []; // "Artist · Album · Song · 1987"
  const artist = parts[0] || getMeta(html, 'music:musician_description');
  if (!title || !artist) return null;
  return { title, artist, album: parts.length >= 3 ? parts[1] : null, albumArt: getMeta(html, 'og:image') };
};

const lookupApple = async (id, country) => {
  const res = await fetchWithTimeout(`https://itunes.apple.com/lookup?id=${id}&country=${country}&entity=song`);
  if (!res.ok) throw new Error(`iTunes lookup returned ${res.status}`);
  const t = (await res.json()).results?.find(r => r.kind === 'song');
  if (!t) return null;
  return {
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName ?? null,
    albumArt: t.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
    url: t.trackViewUrl,
  };
};

const lookupYouTube = async (videoId) => {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
  if ([400, 401, 403, 404].includes(res.status)) return null;
  if (!res.ok) throw new Error(`YouTube oEmbed returned ${res.status}`);
  const d = await res.json();
  let title = d.title;
  let artist = d.author_name ?? '';
  if (/ - Topic$/.test(artist)) {
    // Auto-generated YouTube Music channels: "Artist - Topic", title is the song
    artist = artist.replace(/ - Topic$/, '');
  } else {
    // Regular uploads usually look like "Artist - Song (Official Video)"
    const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) { artist = m[1]; title = m[2]; }
  }
  title = title
    .replace(/\s*[([][^)\]]*\b(official|lyrics?|audio|video|visuali[sz]er|hd|4k|mv)\b[^)\]]*[)\]]/gi, '')
    .trim();
  if (!title || !artist) return null;
  return { title, artist, album: null, albumArt: d.thumbnail_url ?? null };
};

const deezerTrackToSong = (t) => ({
  title: t.title,
  artist: t.contributors?.length ? t.contributors.map(c => c.name).join(', ') : t.artist?.name,
  album: t.album?.title ?? null,
  albumArt: t.album?.cover_xl ?? t.album?.cover_big ?? null,
  isrc: t.isrc ?? null,
  url: t.link ?? `https://www.deezer.com/track/${t.id}`,
});

const lookupDeezer = async (id) => {
  const res = await fetchWithTimeout(`https://api.deezer.com/track/${id}`);
  if (!res.ok) throw new Error(`Deezer returned ${res.status}`);
  const t = await res.json();
  return t.error || !t.title ? null : deezerTrackToSong(t);
};

const TIDAL_API = 'https://openapi.tidal.com/v2';
const tidalHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.api+json' });

const lookupTidal = async (id) => {
  const token = await getTidalToken();
  if (!token) return { unavailable: true };
  const res = await fetchWithTimeout(`${TIDAL_API}/tracks/${id}?countryCode=US&include=artists,albums`, {
    headers: tidalHeaders(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tidal returned ${res.status}`);
  const d = await res.json();
  const a = d.data?.attributes;
  if (!a?.title) return null;
  const included = d.included ?? [];
  const find = (type, ref) => included.find(i => i.type === type && i.id === ref.id);
  const artists = (d.data.relationships?.artists?.data ?? [])
    .map(ref => find('artists', ref)?.attributes?.name).filter(Boolean);
  const albumRef = d.data.relationships?.albums?.data?.[0];
  const album = albumRef ? find('albums', albumRef) : null;
  if (!artists.length) return null;
  return {
    title: a.version ? `${a.title} (${a.version})` : a.title,
    artist: artists.join(', '),
    album: album?.attributes?.title ?? null,
    albumArt: album?.attributes?.imageLinks?.[0]?.href ?? null,
    isrc: a.isrc ?? null,
    url: `https://tidal.com/browse/track/${id}`,
  };
};

// ── Finding the song on other platforms ──────────────────────────────────────
// Each returns a link object or null, and never throws (a failed platform just
// means no direct link; the frontend falls back to a search URL).

const searchSpotify = async (song) => {
  const token = await getSpotifyToken();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };
  const search = (q, limit) => fetchJson(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`, { headers });
  try {
    if (song.isrc) {
      const hit = (await search(`isrc:${song.isrc}`, 1))?.tracks?.items?.[0];
      if (hit) return { id: hit.id, isrc: song.isrc };
    }
    const items = (await search(`track:${coreTitle(song.title)} artist:${leadArtist(song.artist)}`, 10))?.tracks?.items;
    const hit = pickBest(song, items, t => t.name, t => t.artists.map(a => a.name).join(', '));
    return hit ? { id: hit.id, isrc: hit.external_ids?.isrc ?? null } : null;
  } catch { return null; }
};

const searchItunes = async (song) => {
  try {
    const q = encodeURIComponent(`${coreTitle(song.title)} ${leadArtist(song.artist)}`);
    const data = await fetchJson(`https://itunes.apple.com/search?term=${q}&entity=song&limit=15&country=us`);
    const hit = pickBest(song, data?.results, r => r.trackName, r => r.artistName);
    return hit?.trackViewUrl ? { url: hit.trackViewUrl } : null;
  } catch { return null; }
};

const searchDeezer = async (song) => {
  try {
    if (song.isrc) {
      const t = await fetchJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(song.isrc)}`);
      if (t?.link && !t.error) return { url: t.link };
    }
    const q = encodeURIComponent(`${coreTitle(song.title)} ${leadArtist(song.artist)}`);
    const data = await fetchJson(`https://api.deezer.com/search?q=${q}&limit=15`);
    const hit = pickBest(song, data?.data, t => t.title, t => t.artist?.name);
    return hit?.link ? { url: hit.link } : null;
  } catch { return null; }
};

// Tidal's catalogue search isn't reliable enough to match by name, so ISRC only
const searchTidal = async (song) => {
  if (!song.isrc) return null;
  const token = await getTidalToken();
  if (!token) return null;
  try {
    const data = await fetchJson(
      `${TIDAL_API}/tracks?countryCode=US&filter%5Bisrc%5D=${encodeURIComponent(song.isrc)}`,
      { headers: tidalHeaders(token) });
    const id = data?.data?.[0]?.id;
    return id ? { url: `https://tidal.com/browse/track/${id}` } : null;
  } catch { return null; }
};

const searchYouTubeMusic = async (song) => {
  if (!process.env.YOUTUBE_API_KEY) return null;
  try {
    const q = encodeURIComponent(`${song.title} ${song.artist}`);
    const data = await fetchJson(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=10&maxResults=1&key=${process.env.YOUTUBE_API_KEY}`
    );
    const videoId = data?.items?.[0]?.id?.videoId;
    return videoId ? { url: `https://music.youtube.com/watch?v=${videoId}` } : null;
  } catch { return null; }
};

app.post('/api/verify', requireAuth, async (req, res) => {
  const { link } = req.body;
  if (!link || typeof link !== 'string') return res.status(400).json({ error: 'Link required' });

  let parsed = parseLink(link);
  if (!parsed) return res.status(400).json({ error: 'Paste a Spotify, Apple Music, YouTube, Deezer, or Tidal song link' });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    if (parsed.shortUrl) {
      const id = await resolveShortLink(parsed.shortUrl, parsed.pattern);
      if (!id) return res.status(404).json({ error: 'Could not open that link — paste the full song link' });
      parsed = { platform: parsed.platform, id };
    }

    // 1. Read the pasted song
    const platformLinks = {};
    let song;
    switch (parsed.platform) {
      case 'spotify':
        song = await lookupSpotify(parsed.id);
        platformLinks.spotify = spotifyTrackLinks(parsed.id);
        break;
      case 'appleMusic':
        song = await lookupApple(parsed.id, parsed.country);
        if (song) platformLinks.appleMusic = { url: song.url };
        break;
      case 'youtube':
        song = await lookupYouTube(parsed.id);
        platformLinks.youtubeMusic = { url: `https://music.youtube.com/watch?v=${parsed.id}` };
        break;
      case 'deezer':
        song = await lookupDeezer(parsed.id);
        if (song) platformLinks.deezer = { url: song.url };
        break;
      case 'tidal':
        song = await lookupTidal(parsed.id);
        if (song?.unavailable) return res.status(400).json({ error: "Tidal links can't be read yet — paste the song from another app" });
        if (song) platformLinks.tidal = { url: song.url };
        break;
    }
    if (!song) return res.status(404).json({ error: 'Song not found' });

    // 2. Spotify first: its API can supply the ISRC that makes the rest exact
    let spotifyId = parsed.platform === 'spotify' ? parsed.id : null;
    if (!platformLinks.spotify) {
      const sp = await searchSpotify(song);
      if (sp) {
        spotifyId = sp.id;
        platformLinks.spotify = spotifyTrackLinks(sp.id);
        song.isrc ??= sp.isrc;
      }
    }

    // 3. Everything else in parallel
    const others = { appleMusic: searchItunes, deezer: searchDeezer, tidal: searchTidal, youtubeMusic: searchYouTubeMusic };
    const missing = Object.keys(others).filter(p => !platformLinks[p]);
    const results = await Promise.all(missing.map(p => others[p](song)));
    missing.forEach((p, i) => { if (results[i]) platformLinks[p] = results[i]; });

    res.json({
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArt: song.albumArt,
      spotifyUri: platformLinks.spotify?.nativeAppUriMobile ?? null,
      spotifyUrl: platformLinks.spotify?.url ?? null,
      platformLinks,
      sourceUrl: link,
      // song.link's web pages still work; this URL format matches what Odesli
      // returned for Spotify input, so duplicate checks line up with old history.
      odesliPageUrl: spotifyId ? `https://song.link/s/${spotifyId}` : null,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(504).json({ error: 'Music lookup timed out — try again' });
    }
    console.error('Song lookup failed:', err);
    res.status(502).json({ error: 'Music lookup failed — try again in a moment' });
  }
});

initDb().then(async () => {
  const { rows } = await pool.query(
    'SELECT DISTINCT ON (sent_by, friendship_id) * FROM song_history ORDER BY sent_by, friendship_id, sent_at DESC'
  );
  for (const r of rows) {
    if (!r.friendship_id) continue;
    if (!lastSentByFriendship[r.friendship_id]) lastSentByFriendship[r.friendship_id] = {};
    lastSentByFriendship[r.friendship_id][r.sent_by] = rowToEntry(r);
  }
  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    scheduleMidnightClear();
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
