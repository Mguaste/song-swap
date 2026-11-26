const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');
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
  friendshipId: r.friendship_id, rating: r.rating ?? null, imported: !!r.imported,
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
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_dashboard BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE');
  // 1–5 rating, set only by the friend who received the song
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5)');
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ');
  // Backfilled from an admin CSV import: counts for duplicate checks but can't be rated
  await pool.query('ALTER TABLE song_history ADD COLUMN IF NOT EXISTS imported BOOLEAN NOT NULL DEFAULT FALSE');
  // One-time: the first test import (2026-11-25) ran before this column existed
  await pool.query(`UPDATE song_history SET imported = TRUE, rating = NULL, rated_at = NULL
    WHERE id IN (91, 92, 93) AND friendship_id = 17 AND NOT imported`);
  // Profile pictures (small JPEG/PNG/WebP, resized in the browser before upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_avatars (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      image BYTEA NOT NULL,
      mime TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name_changed_at TIMESTAMPTZ');
  // Web push: one row per device that turned notifications on
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Song share links (/s/<id>): one song sent to anyone, account or not
  await pool.query(`
    CREATE TABLE IF NOT EXISTS song_shares (
      id TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      artist TEXT,
      album TEXT,
      album_art TEXT,
      platform_links JSONB,
      source_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Where a friend request came from: 'code' (typed), 'invite' (/add link) or
  // 'share' (swap back from a /s song link; share_id says which). NULL = made
  // before this was tracked. accepted_at feeds the admin Growth numbers.
  await pool.query('ALTER TABLE friendships ADD COLUMN IF NOT EXISTS source TEXT');
  await pool.query('ALTER TABLE friendships ADD COLUMN IF NOT EXISTS share_id TEXT REFERENCES song_shares(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE friendships ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ');
  // Daily totals for the admin Growth numbers. Counts only: no user ids or IPs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_counts (
      day DATE NOT NULL,
      event TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, event)
    )
  `);
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
  // Memos from the admin, shown once to each user as a banner. Each user
  // keeps the id of the newest one they've closed; new accounts start at
  // the newest existing memo so they don't get old news.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      action TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_announcement_id INT NOT NULL DEFAULT 0');

  // Test accounts still work normally but are left out of every count:
  // admin Growth numbers, memo read counts, and friends' "Your numbers".
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(`UPDATE users SET is_test = TRUE WHERE LOWER(name) = 'testtest' AND NOT is_test`);

  // One-time: carry over the original hard-coded admin if no admin exists yet
  await pool.query(`UPDATE users SET is_admin = TRUE
    WHERE LOWER(name) = 'mguaste' AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`);

  // Moderation. A block removes any friendship/requests between the two people
  // and stops new ones; a report goes to the admin queue. A banned user is
  // signed out everywhere and can't log back in.
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_reports (
      id SERIAL PRIMARY KEY,
      reporter_id INT REFERENCES users(id) ON DELETE SET NULL,
      reported_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Song share links can optionally expire
  await pool.query('ALTER TABLE song_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');

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

// One canonical host for search engines: www.song-swap.app → song-swap.app
app.use((req, res, next) => {
  if (req.hostname === 'www.song-swap.app') {
    return res.redirect(301, `https://song-swap.app${req.originalUrl}`);
  }
  next();
});

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
    // 'lax' is enough because the frontend is served from the same origin as
    // the API; it also narrows CSRF exposure. (Switch back to 'none' only if
    // the frontend ever moves to a different origin from this server.)
    sameSite: 'lax',
    httpOnly: true,
  },
});
app.use(sessionMiddleware);
// Give sockets the same session as HTTP requests, so socket events can be
// tied to the logged-in user instead of trusting names the client sends
io.engine.use(sessionMiddleware);

// Lightweight health check for uptime monitoring (no DB, no auth)
app.get('/api/health', (req, res) => res.json({ ok: true }));

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

// send-song is a raw socket API — the song object comes straight from the
// client, so it's never trusted. Links from it are later handed to
// window.location/window.open on the recipient's device, so any field that
// isn't a plain https URL (or a known music-app-scheme URI) is dropped, which
// is what stops a javascript:/data: URL from running as the recipient.
const cleanStr = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : null);
const cleanHttpsUrl = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, 2000) : null);
const APP_URI_RE = /^(?:spotify:|music:|tidal:\/\/|deezer:\/\/|youtubemusic:\/\/)/i;
const cleanAppUri = (v) => (typeof v === 'string' && APP_URI_RE.test(v) ? v.slice(0, 2000) : null);
const cleanSourceUrl = (v) => cleanHttpsUrl(v) ?? cleanAppUri(v);
const SONG_PLATFORM_KEYS = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal', 'deezer'];
const cleanPlatformLinks = (links) => {
  if (!links || typeof links !== 'object') return null;
  const out = {};
  for (const key of SONG_PLATFORM_KEYS) {
    const v = links[key];
    if (!v || typeof v !== 'object') continue;
    if (v.notFound === true) { out[key] = { notFound: true }; continue; }
    const entry = {};
    const url = cleanHttpsUrl(v.url);
    if (url) entry.url = url;
    const native = cleanAppUri(v.nativeAppUriMobile);
    if (native) entry.nativeAppUriMobile = native;
    if (Object.keys(entry).length) out[key] = entry;
  }
  return Object.keys(out).length ? out : null;
};
const sanitizeSong = (song) => ({
  title: cleanStr(song.title),
  artist: cleanStr(song.artist),
  album: cleanStr(song.album),
  albumArt: cleanHttpsUrl(song.albumArt),
  spotifyUri: cleanAppUri(song.spotifyUri),
  spotifyUrl: cleanHttpsUrl(song.spotifyUrl),
  platformLinks: cleanPlatformLinks(song.platformLinks),
  sourceUrl: cleanSourceUrl(song.sourceUrl),
  odesliPageUrl: cleanHttpsUrl(song.odesliPageUrl),
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // Lets tabs running an older build notice a deploy and reload themselves
  if (BUILD_ID) socket.emit('build-id', BUILD_ID);

  // Whether this tab is on screen; push notifications are skipped while it is
  socket.data.visible = false;
  socket.on('visibility', (visible) => { socket.data.visible = !!visible; });

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
      if (!sendSongLimiter(user.name)) return socket.emit('send-error', { error: 'Slow down a moment — try again shortly' });
      if (!song?.title || !(await isFriendshipMember(user.name, rawId))) {
        return socket.emit('send-error', { error: 'You can only send songs to your friends' });
      }
      // Never trust the client's song object: scrub it before it's stored and
      // later opened on the recipient's device
      song = sanitizeSong(song);
      if (!song.title) return socket.emit('send-error', { error: 'Could not send that song — try again' });
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
        sendPush(name, {
          title: `${sentBy} sent you a song. Your turn!`,
          body: [entry.title, entry.artist].filter(Boolean).join(' — '),
          url: `/?swap=${friendshipId}`,
          tag: `swap-${friendshipId}`,
        });
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

// Bump today's total for an event (admin Growth numbers). Never blocks or
// fails the request it's counting.
const countEvent = (event) => {
  pool.query(
    `INSERT INTO daily_counts (day, event, count) VALUES ((NOW() AT TIME ZONE $2)::date, $1, 1)
     ON CONFLICT (day, event) DO UPDATE SET count = daily_counts.count + 1`,
    [event, RESET_TIMEZONE]
  ).catch(err => console.error('countEvent failed:', err.message));
};

// A friendship that started from a shared song begins with that song in its
// history, sent by the person who shared it (so the new friend can rate it)
const seedSharedSong = async (friendshipId) => {
  try {
    await pool.query(
      `INSERT INTO song_history
         (title, artist, album, album_art, spotify_uri, spotify_url, platform_links, source_url, sent_by, friendship_id, sent_at)
       SELECT s.title, s.artist, s.album, s.album_art,
              s.platform_links->'spotify'->>'nativeAppUriMobile', s.platform_links->'spotify'->>'url',
              s.platform_links, s.source_url, u.name, f.id, s.created_at
       FROM friendships f
       JOIN song_shares s ON s.id = f.share_id
       JOIN users u ON u.id = s.user_id
       WHERE f.id = $1 AND s.user_id IN (f.requester_id, f.receiver_id)
         AND NOT EXISTS (SELECT 1 FROM song_history h WHERE h.friendship_id = f.id)`,
      [friendshipId]
    );
  } catch (err) { console.error('seedSharedSong failed:', err.message); }
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

// Generic in-memory per-key limiter: returns true while under `max` events per
// `windowMs`. Used to cap per-user abuse of expensive or spammable endpoints.
const makeRateLimiter = (max, windowMs) => {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, e] of hits) if (e.start < cutoff) hits.delete(k);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    const e = hits.get(key) ?? { count: 0, start: now };
    if (now - e.start > windowMs) { e.count = 0; e.start = now; }
    e.count++;
    hits.set(key, e);
    return e.count <= max;
  };
};
// /api/verify fans out to several third-party music APIs; friends/add can be
// scripted to enumerate friend codes or spam requests. Ceilings sit well above
// normal human use.
const verifyLimiter = makeRateLimiter(60, 60 * 1000);       // 60/min per user
const friendAddLimiter = makeRateLimiter(20, 60 * 1000);    // 20/min per user
const sendSongLimiter = makeRateLimiter(30, 60 * 1000);     // 30/min per user
// Rejects when the current user is over `limiter`'s ceiling (use after requireAuth)
const perUserLimit = (limiter) => (req, res, next) =>
  limiter(req.session.user.name) ? next() : res.status(429).json({ error: 'Too many requests — slow down a moment' });

// A valid bcrypt hash no password matches, compared against on a login miss so
// a nonexistent username takes the same time as a wrong password (no timing
// oracle for whether an account exists)
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('login-miss-placeholder', 10);

// Rotate the session id when a user authenticates, so a session fixed before
// login can't be reused afterward
const MAX_PASSWORD = 200;
const regenerateSession = (req) => new Promise((resolve, reject) => {
  req.session.regenerate((err) => (err ? reject(err) : resolve()));
});

app.post('/api/register', authLimiter, async (req, res) => {
  const { name, password, preferredPlatform, ref } = req.body;
  const trimmed = name?.trim();
  if (!trimmed || !password) return res.status(400).json({ error: 'Name and password required' });
  if (trimmed.length > 30) return res.status(400).json({ error: 'Name too long (max 30 characters)' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (password.length > MAX_PASSWORD) return res.status(400).json({ error: `Password too long (max ${MAX_PASSWORD} characters)` });

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
    `INSERT INTO users (name, password_hash, friend_code, preferred_platform, last_announcement_id)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(id), 0) FROM announcements))`,
    [trimmed, passwordHash, code, platform]
  );
  await regenerateSession(req);
  req.session.user = { name: trimmed };
  if (ref === 'invite' || ref === 'share') countEvent(`signup_${ref}`);
  res.status(201).json({ name: trimmed });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { name, password } = req.body;
  if (typeof password !== 'string' || password.length > MAX_PASSWORD) return res.status(401).json({ error: 'Invalid username or password' });
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(name) = LOWER($1)', [name]);
  if (rows.length === 0) {
    // Compare anyway so a missing account can't be told apart by response time
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
  if (rows[0].is_banned) return res.status(403).json({ error: 'This account has been suspended.' });
  await regenerateSession(req);
  req.session.user = { name: rows[0].name };
  res.json(req.session.user);
});

app.get('/api/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.friend_code, COALESCE(u.preferred_platform, 'spotify') AS preferred_platform, u.is_admin,
       u.show_dashboard, u.name_changed_at, a.updated_at AS avatar_at
     FROM users u LEFT JOIN user_avatars a ON a.user_id = u.id WHERE u.name = $1`,
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

app.patch('/api/me/show-dashboard', requireAuth, async (req, res) => {
  const { show } = req.body;
  if (typeof show !== 'boolean') return res.status(400).json({ error: 'Invalid value' });
  await pool.query('UPDATE users SET show_dashboard = $1 WHERE name = $2', [show, req.session.user.name]);
  res.json({ show_dashboard: show });
});

app.patch('/api/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (typeof currentPassword !== 'string' || currentPassword.length > MAX_PASSWORD) return res.status(401).json({ error: 'Current password is incorrect' });
  if (typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  if (newPassword.length > MAX_PASSWORD) return res.status(400).json({ error: `New password too long (max ${MAX_PASSWORD} characters)` });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE name = $1', [req.session.user.name]);
  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE name = $2', [newHash, req.session.user.name]);
  res.json({ success: true });
});

// Sign a user out everywhere: drop their stored sessions and tell any open
// tabs to go back to the login screen
const signOutEverywhere = async (name, db = pool) => {
  await db.query("DELETE FROM user_sessions WHERE sess->'user'->>'name' = $1", [name]);
  // Signed-out devices shouldn't keep getting this account's notifications
  await db.query('DELETE FROM push_subscriptions WHERE user_id = (SELECT id FROM users WHERE name = $1)', [name]);
};
const kickSockets = (name) => {
  io.to(`user-${name}`).emit('force-logout');
  io.in(`user-${name}`).disconnectSockets(true);
};

// Delete your own account: friendships (incl. pending requests), their swap
// history, read markers and sessions. Needs the current password.
app.delete('/api/me', requireAuth, authLimiter, async (req, res) => {
  const name = req.session.user.name;
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: 'Enter your password to confirm' });
  if (typeof password !== 'string' || password.length > MAX_PASSWORD) return res.status(401).json({ error: 'Password is incorrect' });
  const { rows: me } = await pool.query('SELECT id, password_hash, is_admin FROM users WHERE name = $1', [name]);
  if (me.length === 0) return res.status(404).json({ error: 'Account not found' });
  if (!(await bcrypt.compare(password, me[0].password_hash))) return res.status(401).json({ error: 'Password is incorrect' });
  if (me[0].is_admin) {
    const { rows } = await pool.query('SELECT COUNT(*) FROM users WHERE is_admin AND id != $1', [me[0].id]);
    if (Number(rows[0].count) === 0) return res.status(400).json({ error: "You're the only admin — make someone else an admin first" });
  }
  const client = await pool.connect();
  let friendships;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT f.id, f.status, CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS other
       FROM friendships f
       JOIN users u1 ON u1.id = f.requester_id
       JOIN users u2 ON u2.id = f.receiver_id
       WHERE f.requester_id = $1 OR f.receiver_id = $1`,
      [me[0].id]
    );
    friendships = rows;
    const ids = rows.map(r => r.id);
    await client.query('DELETE FROM song_history WHERE friendship_id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM friendships WHERE id = ANY($1::int[])', [ids]);
    await signOutEverywhere(name, client);
    await client.query('DELETE FROM users WHERE id = $1', [me[0].id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  for (const f of friendships) {
    delete lastSentByFriendship[f.id];
    io.in(`friendship-${f.id}`).socketsLeave(`friendship-${f.id}`);
    if (f.status === 'accepted') io.to(`user-${f.other}`).emit('friendship-removed', { friendshipId: f.id });
    else io.to(`user-${f.other}`).emit('friend-request-declined');
  }
  kickSockets(name);
  req.session.destroy(() => res.json({ success: true }));
});

// Admin: give a user a temporary password (there's no email on file to send
// a reset link to). Signs them out everywhere.
// Admin Growth numbers: is anyone using invite and song links, and do they
// turn into friendships? Last 24 hours, 7 days, 30 days, all time.
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const tz = RESET_TIMEZONE;
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  // Friendships between other people: not involving the viewing admin or a test account
  const notMine = `f.requester_id <> $1 AND f.receiver_id <> $1
    AND NOT EXISTS (SELECT 1 FROM users t WHERE t.is_test AND t.id IN (f.requester_id, f.receiver_id))`;
  const period = (col, extra = '') => ['24 hours', '7 days', '30 days', null].map((iv, i) =>
    `COUNT(${extra || '*'}) FILTER (WHERE ${iv ? `${col} > NOW() - INTERVAL '${iv}'` : 'TRUE'})::int AS ${['day', 'week', 'month', 'total'][i]}`
  ).join(', ');
  const [counts, users, friends, others, otherRequests, otherAccepted, otherSongs, otherPairs] = await Promise.all([
    pool.query(
      `SELECT event,
         COALESCE(SUM(count) FILTER (WHERE day > (NOW() AT TIME ZONE $1)::date - 1), 0)::int AS day,
         COALESCE(SUM(count) FILTER (WHERE day > (NOW() AT TIME ZONE $1)::date - 7), 0)::int AS week,
         COALESCE(SUM(count) FILTER (WHERE day > (NOW() AT TIME ZONE $1)::date - 30), 0)::int AS month,
         SUM(count)::int AS total
       FROM daily_counts GROUP BY event`, [tz]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS day,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS month,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM friendships f
                JOIN users o ON o.id = CASE WHEN f.requester_id = users.id THEN f.receiver_id ELSE f.requester_id END
                WHERE f.status = 'accepted' AND users.id IN (f.requester_id, f.receiver_id) AND NOT o.is_test))::int AS with_friend
       FROM users WHERE NOT is_test`),
    pool.query(
      `SELECT COALESCE(source, 'untracked') AS source,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS requests_day,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS requests_week,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS requests_month,
              COUNT(*)::int AS requests_total,
              COUNT(*) FILTER (WHERE accepted_at > NOW() - INTERVAL '24 hours')::int AS accepted_day,
              COUNT(*) FILTER (WHERE accepted_at > NOW() - INTERVAL '7 days')::int AS accepted_week,
              COUNT(*) FILTER (WHERE accepted_at > NOW() - INTERVAL '30 days')::int AS accepted_month,
              COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_total
       FROM friendships f
       WHERE NOT EXISTS (SELECT 1 FROM users t WHERE t.is_test AND t.id IN (f.requester_id, f.receiver_id))
       GROUP BY 1`),
    // ── Without me ──
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                  AND u.id IN (f.requester_id, f.receiver_id) AND ${notMine}))::int AS with_friend
       FROM users u WHERE NOT u.is_test AND u.id <> $1`, [me[0].id]),
    pool.query(`SELECT ${period('f.created_at')} FROM friendships f WHERE ${notMine}`, [me[0].id]),
    pool.query(`SELECT ${period('f.accepted_at')} FROM friendships f WHERE f.status = 'accepted' AND ${notMine}`, [me[0].id]),
    pool.query(
      `SELECT ${period('sh.sent_at')} FROM song_history sh JOIN friendships f ON f.id = sh.friendship_id
       WHERE ${notMine}`, [me[0].id]),
    pool.query(
      `SELECT ${period('sh.sent_at', 'DISTINCT sh.friendship_id')} FROM song_history sh JOIN friendships f ON f.id = sh.friendship_id
       WHERE ${notMine}`, [me[0].id]),
  ]);
  res.json({
    events: Object.fromEntries(counts.rows.map(r => [r.event, r])),
    users: users.rows[0],
    friendships: Object.fromEntries(friends.rows.map(r => [r.source, r])),
    withoutMe: {
      people: others.rows[0],
      requests: otherRequests.rows[0],
      accepted: otherAccepted.rows[0],
      songs: otherSongs.rows[0],
      pairs: otherPairs.rows[0],
    },
  });
});

app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
  const target = String(req.body?.name ?? '').trim();
  if (!target) return res.status(400).json({ error: 'Enter a username' });
  const { rows } = await pool.query('SELECT name FROM users WHERE LOWER(name) = LOWER($1)', [target]);
  if (rows.length === 0) return res.status(404).json({ error: 'No user with that name' });
  const name = rows[0].name;
  if (name === req.session.user.name) return res.status(400).json({ error: 'Use Change Password above for your own account' });
  // Readable: no 0/O/1/l/I
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  const tempPassword = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  await pool.query('UPDATE users SET password_hash = $1 WHERE name = $2', [await bcrypt.hash(tempPassword, 10), name]);
  await signOutEverywhere(name);
  kickSockets(name);
  res.json({ name, tempPassword });
});

// ── Admin: reports, bans, and a shares overview ──
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.reason, r.status, r.created_at,
            rep.name AS reporter_name,
            u.id AS reported_id, u.name AS reported_name, u.is_banned, u.is_admin AS reported_is_admin
     FROM user_reports r
     LEFT JOIN users rep ON rep.id = r.reporter_id
     JOIN users u ON u.id = r.reported_id
     ORDER BY (r.status = 'open') DESC, r.created_at DESC
     LIMIT 100`
  );
  res.json(rows);
});

app.post('/api/admin/reports/:id/dismiss', requireAdmin, async (req, res) => {
  await pool.query("UPDATE user_reports SET status = 'dismissed' WHERE id = $1", [parseInt(req.params.id, 10) || 0]);
  res.json({ success: true });
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user' });
  const { rows } = await pool.query('SELECT name, is_admin FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  if (rows[0].is_admin) return res.status(400).json({ error: 'You cannot ban an admin' });
  await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [id]);
  await pool.query("UPDATE user_reports SET status = 'actioned' WHERE reported_id = $1 AND status = 'open'", [id]);
  await signOutEverywhere(rows[0].name);
  kickSockets(rows[0].name);
  res.json({ success: true });
});

app.post('/api/admin/users/:id/unban', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user' });
  await pool.query('UPDATE users SET is_banned = FALSE WHERE id = $1', [id]);
  res.json({ success: true });
});

app.get('/api/admin/shares', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.artist, s.created_at, s.expires_at, u.name AS owner
     FROM song_shares s JOIN users u ON u.id = s.user_id
     ORDER BY s.created_at DESC LIMIT 200`
  );
  res.json(rows.map(r => ({
    id: r.id, title: r.title, artist: r.artist, owner: r.owner,
    createdAt: r.created_at, expiresAt: r.expires_at,
    expired: !!r.expires_at && new Date(r.expires_at) <= new Date(),
  })));
});

app.delete('/api/admin/shares/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM song_shares WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Names of everyone with a friendship or pending request with this user
const connectedNames = async (userId) => {
  const { rows } = await pool.query(
    `SELECT CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS name
     FROM friendships f JOIN users u1 ON u1.id = f.requester_id JOIN users u2 ON u2.id = f.receiver_id
     WHERE f.requester_id = $1 OR f.receiver_id = $1`,
    [userId]
  );
  return rows.map(r => r.name);
};
// Tell friends to reload their friends list (new name or picture)
const notifyFriendsUpdated = async (userId) => {
  for (const n of await connectedNames(userId)) io.to(`user-${n}`).emit('friend-updated');
};

// ── Profile pictures ──
const AVATAR_MAX_BYTES = 300 * 1024;
const imageMime = (buf) => {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
};

app.put('/api/me/avatar', requireAuth, express.raw({ type: 'image/*', limit: AVATAR_MAX_BYTES }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'No image received' });
  const mime = imageMime(buf);
  if (!mime) return res.status(400).json({ error: 'Use a JPEG, PNG or WebP image' });
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `INSERT INTO user_avatars (user_id, image, mime, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET image = EXCLUDED.image, mime = EXCLUDED.mime, updated_at = NOW()
     RETURNING updated_at`,
    [me[0].id, buf, mime]
  );
  notifyFriendsUpdated(me[0].id).catch(() => {});
  res.json({ avatar_at: rows[0].updated_at });
});

app.delete('/api/me/avatar', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  await pool.query('DELETE FROM user_avatars WHERE user_id = $1', [me[0].id]);
  notifyFriendsUpdated(me[0].id).catch(() => {});
  res.json({ success: true });
});

// Only you and people you have a friendship or request with can see your picture
app.get('/api/avatars/:userId', requireAuth, async (req, res) => {
  const target = Number(req.params.userId);
  if (!Number.isInteger(target)) return res.status(400).end();
  const { rows } = await pool.query(
    `SELECT a.image, a.mime FROM user_avatars a
     JOIN users me ON me.name = $2
     WHERE a.user_id = $1 AND (me.id = $1 OR EXISTS (
       SELECT 1 FROM friendships f
       WHERE (f.requester_id = me.id AND f.receiver_id = $1) OR (f.receiver_id = me.id AND f.requester_id = $1)))`,
    [target, req.session.user.name]
  );
  if (rows.length === 0) return res.status(404).end();
  // URLs carry ?v=<updated_at>, so a new picture gets a new URL
  res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'private, max-age=604800' });
  res.send(rows[0].image);
});

// ── Change username ──
// Names are used as keys in several places (song_history.sent_by, sessions,
// socket rooms, the current-song cache), so all of them move together.
const RENAME_COOLDOWN_DAYS = 7;
app.patch('/api/me/name', requireAuth, async (req, res) => {
  const oldName = req.session.user.name;
  const newName = String(req.body?.name ?? '').trim();
  if (!newName) return res.status(400).json({ error: 'Enter a new username' });
  if (newName.length > 30) return res.status(400).json({ error: 'Name too long (max 30 characters)' });
  if (newName === oldName) return res.status(400).json({ error: "That's already your username" });
  const { rows: me } = await pool.query('SELECT id, name_changed_at FROM users WHERE name = $1', [oldName]);
  const last = me[0].name_changed_at;
  if (last && Date.now() - new Date(last) < RENAME_COOLDOWN_DAYS * 864e5) {
    const next = new Date(new Date(last).getTime() + RENAME_COOLDOWN_DAYS * 864e5);
    return res.status(429).json({ error: `You can change your username again on ${next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the user rows so two renames can't grab the same name
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: taken } = await client.query('SELECT 1 FROM users WHERE LOWER(name) = LOWER($1) AND id != $2', [newName, me[0].id]);
    if (taken.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Username already taken' });
    }
    await client.query('UPDATE users SET name = $1, name_changed_at = NOW() WHERE id = $2', [newName, me[0].id]);
    await client.query('UPDATE song_history SET sent_by = $1 WHERE sent_by = $2', [newName, oldName]);
    await client.query(
      `UPDATE user_sessions SET sess = jsonb_set(sess::jsonb, '{user,name}', to_jsonb($1::text))::json
       WHERE sess->'user'->>'name' = $2`,
      [newName, oldName]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  req.session.user = { name: newName };
  for (const songs of Object.values(lastSentByFriendship)) {
    if (songs[oldName]) {
      songs[newName] = { ...songs[oldName], sentBy: newName };
      delete songs[oldName];
    }
  }
  io.in(`user-${oldName}`).socketsJoin(`user-${newName}`);
  io.in(`user-${oldName}`).socketsLeave(`user-${oldName}`);
  io.to(`user-${newName}`).emit('me-updated');
  notifyFriendsUpdated(me[0].id).catch(() => {});
  res.json({ name: newName });
});

// ── Push notifications ──
// Keys come from Railway variables (generate with: npx web-push generate-vapid-keys).
// Without them, push is simply off.
const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://song-swap.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

// Notify every device of a user, unless they have Song Swap open on screen
// right now (it updates live, so a notification would be a double alert)
const sendPush = async (name, payload) => {
  if (!PUSH_ENABLED) return;
  try {
    const sockets = await io.in(`user-${name}`).fetchSockets();
    if (sockets.some(s => s.data.visible)) return;
    const { rows } = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id WHERE u.name = $1`,
      [name]
    );
    await Promise.all(rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 }
        );
      } catch (err) {
        // Gone/expired subscription (app uninstalled, browser data cleared)
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        } else {
          console.error('push failed:', err.statusCode || err.message);
        }
      }
    }));
  } catch (err) {
    console.error('sendPush failed:', err);
  }
};

app.get('/api/push/key', (req, res) => {
  res.json({ publicKey: PUSH_ENABLED ? process.env.VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  const sub = req.body?.subscription;
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  // A device belongs to whoever subscribed last on it
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     SELECT id, $2, $3, $4 FROM users WHERE name = $1
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.session.user.name, endpoint, String(p256dh), String(auth)]
  );
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Missing endpoint' });
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = (SELECT id FROM users WHERE name = $2)',
    [endpoint, req.session.user.name]
  );
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Who an invite link is from, for the sign-up screen. The code was shared on
// purpose, so revealing the matching username is fine.
app.get('/api/invite/:code', authLimiter, async (req, res) => {
  const name = await inviterName(req.params.code);
  if (!name) return res.status(404).json({ error: 'Invite not found' });
  // ?src=share: the sign-up screen after "swap back" on a song (counted as a share open)
  if (req.query.src !== 'share' && req.session.user?.name !== name) countEvent('invite_opened');
  res.json({ name });
});

const inviterName = async (code) => {
  if (!/^[A-Za-z0-9]{6}$/.test(code ?? '')) return null;
  const { rows } = await pool.query('SELECT name FROM users WHERE friend_code = $1', [code.toUpperCase()]);
  return rows[0]?.name ?? null;
};

const loadShare = async (id) => {
  if (!/^[A-Za-z0-9]{10}$/.test(id ?? '')) return null;
  const { rows } = await pool.query(
    `SELECT s.title, s.artist, s.album, s.album_art, s.platform_links, s.created_at,
            u.id AS from_id, u.name AS from_name, u.friend_code AS from_code, a.updated_at AS from_avatar_at
     FROM song_shares s JOIN users u ON u.id = s.user_id
     LEFT JOIN user_avatars a ON a.user_id = u.id
     WHERE s.id = $1 AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
    [id]
  );
  return rows[0] ?? null;
};

// Your own share links, to review or revoke (must be before /api/shares/:id)
app.get('/api/shares/mine', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.artist, s.album_art, s.created_at, s.expires_at
     FROM song_shares s JOIN users u ON u.id = s.user_id
     WHERE u.name = $1 ORDER BY s.created_at DESC LIMIT 100`,
    [req.session.user.name]
  );
  res.json(rows.map(r => ({
    id: r.id, title: r.title, artist: r.artist, albumArt: r.album_art,
    createdAt: r.created_at, expiresAt: r.expires_at,
    url: `${req.protocol}://${req.get('host')}/s/${r.id}`,
    expired: !!r.expires_at && new Date(r.expires_at) <= new Date(),
  })));
});

app.delete('/api/shares/:id', requireAuth, async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM song_shares WHERE id = $1 AND user_id = (SELECT id FROM users WHERE name = $2)',
    [req.params.id, req.session.user.name]
  );
  if (!rowCount) return res.status(404).json({ error: 'Share not found' });
  res.json({ success: true });
});

// Public: the shared song and who sent it (their friend code, so the page
// can send them a friend request; sharing the link shares the code)
app.get('/api/shares/:id', async (req, res) => {
  const r = await loadShare(req.params.id);
  if (!r) return res.status(404).json({ error: 'This song link has expired or doesn\'t exist' });
  if (req.session.user?.name !== r.from_name) countEvent('share_opened');
  res.json({
    from: { id: r.from_id, name: r.from_name, code: r.from_code, avatarAt: r.from_avatar_at },
    song: { title: r.title, artist: r.artist, album: r.album, albumArt: r.album_art, platformLinks: r.platform_links },
    sentAt: r.created_at,
  });
});

// Add a friend by code (typed or from an invite link): sends a request the
// other person accepts. If they already asked you, this accepts theirs.
app.post('/api/friends/add', requireAuth, perUserLimit(friendAddLimiter), async (req, res) => {
  const { friendCode, via, shareId } = req.body;
  if (!friendCode) return res.status(400).json({ error: 'Friend code required' });

  const { rows: target } = await pool.query('SELECT id, name FROM users WHERE friend_code = $1', [String(friendCode).toUpperCase()]);
  if (target.length === 0) return res.status(404).json({ error: 'No user found with that friend code' });

  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const myId = me[0].id;
  const theirId = target[0].id;
  const myName = req.session.user.name;
  const theirName = target[0].name;

  if (myId === theirId) return res.status(400).json({ error: 'You cannot add yourself' });

  const { rows: blocked } = await pool.query(
    'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
    [myId, theirId]
  );
  if (blocked.length) return res.status(403).json({ error: "You can't add this person" });

  const { rows: existing } = await pool.query(
    'SELECT id, status, requester_id FROM friendships WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)',
    [myId, theirId]
  );
  const prior = existing[0];
  if (prior?.status === 'accepted') return res.status(409).json({ error: `You and ${theirName} are already friends` });
  // They already sent you a request: adding them back accepts it
  if (prior && prior.requester_id === theirId) {
    await pool.query("UPDATE friendships SET status = 'accepted', accepted_at = NOW() WHERE id = $1", [prior.id]);
    await seedSharedSong(prior.id);
    io.to(`user-${myName}`).emit('friendship-accepted');
    io.to(`user-${theirName}`).emit('friendship-accepted');
    return res.status(201).json({ message: `You and ${theirName} are now friends`, friendshipId: prior.id, accepted: true });
  }
  if (prior) return res.status(409).json({ error: `You already sent ${theirName} a friend request` });

  // Only keep a share id that really is a song the other person shared
  let fromShare = null;
  if (via === 'share' && typeof shareId === 'string') {
    const { rows } = await pool.query('SELECT id FROM song_shares WHERE id = $1 AND user_id = $2', [shareId, theirId]);
    fromShare = rows[0]?.id ?? null;
  }
  const source = fromShare ? 'share' : via === 'invite' ? 'invite' : 'code';
  await pool.query(
    'INSERT INTO friendships (requester_id, receiver_id, source, share_id) VALUES ($1, $2, $3, $4)',
    [myId, theirId, source, fromShare]
  );
  io.to(`user-${target[0].name}`).emit('friend-request-received');
  sendPush(target[0].name, {
    title: 'New friend request',
    body: `${req.session.user.name} wants to swap songs with you`,
    url: '/',
    tag: 'friend-request',
  });
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
    "UPDATE friendships SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND receiver_id = $2 AND status = 'pending' RETURNING *",
    [req.params.id, me[0].id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });
  await seedSharedSong(rows[0].id);
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

// ── Blocking & reporting ──
const MOD_WINDOW_MS = 60 * 60 * 1000;
const blockLimiter = makeRateLimiter(60, MOD_WINDOW_MS);  // 60/hour per user
const reportLimiter = makeRateLimiter(20, MOD_WINDOW_MS); // 20/hour per user
const REPORT_MAX = 500;

// Block a user: drop any friendship/requests between you two, then stop new ones
app.post('/api/blocks', requireAuth, perUserLimit(blockLimiter), async (req, res) => {
  const { userId, friendCode } = req.body ?? {};
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const myId = me[0].id;
  // Target by user id (from a swap) or friend code (from a pending request)
  let target;
  if (Number.isInteger(Number(userId))) {
    ({ rows: target } = await pool.query('SELECT id, name FROM users WHERE id = $1', [Number(userId)]));
  } else if (typeof friendCode === 'string' && friendCode) {
    ({ rows: target } = await pool.query('SELECT id, name FROM users WHERE friend_code = $1', [friendCode.toUpperCase()]));
  } else {
    return res.status(400).json({ error: 'Invalid user' });
  }
  if (!target || target.length === 0) return res.status(404).json({ error: 'User not found' });
  const targetId = target[0].id;
  if (targetId === myId) return res.status(400).json({ error: 'You cannot block yourself' });

  const client = await pool.connect();
  let affected;
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [myId, targetId]);
    const { rows: fs } = await client.query(
      `SELECT id, status FROM friendships
       WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
      [myId, targetId]
    );
    affected = fs;
    const ids = fs.map(f => f.id);
    if (ids.length) {
      await client.query('DELETE FROM song_history WHERE friendship_id = ANY($1::int[])', [ids]);
      await client.query('DELETE FROM friendships WHERE id = ANY($1::int[])', [ids]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const myName = req.session.user.name, theirName = target[0].name;
  for (const f of affected) {
    delete lastSentByFriendship[f.id];
    io.in(`friendship-${f.id}`).socketsLeave(`friendship-${f.id}`);
    if (f.status === 'accepted') {
      io.to(`user-${myName}`).emit('friendship-removed', { friendshipId: f.id });
      io.to(`user-${theirName}`).emit('friendship-removed', { friendshipId: f.id });
    } else {
      io.to(`user-${myName}`).emit('friend-request-declined');
      io.to(`user-${theirName}`).emit('friend-request-declined');
    }
  }
  res.json({ success: true });
});

app.delete('/api/blocks/:userId', requireAuth, async (req, res) => {
  const targetId = Number(req.params.userId);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user' });
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [me[0].id, targetId]);
  res.json({ success: true });
});

app.get('/api/blocks', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, b.created_at
     FROM user_blocks b
     JOIN users me ON me.name = $1 AND me.id = b.blocker_id
     JOIN users u ON u.id = b.blocked_id
     ORDER BY b.created_at DESC`,
    [req.session.user.name]
  );
  res.json(rows);
});

// Report a user; admins review these in the Admin page
app.post('/api/reports', requireAuth, perUserLimit(reportLimiter), async (req, res) => {
  const targetId = Number(req.body?.userId);
  const reason = String(req.body?.reason ?? '').trim().slice(0, REPORT_MAX);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user' });
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  if (targetId === me[0].id) return res.status(400).json({ error: 'You cannot report yourself' });
  const { rows: target } = await pool.query('SELECT id FROM users WHERE id = $1', [targetId]);
  if (target.length === 0) return res.status(404).json({ error: 'User not found' });
  await pool.query('INSERT INTO user_reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)', [me[0].id, targetId, reason || null]);
  res.status(201).json({ success: true });
});

// List accepted friends
app.get('/api/friends', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id FROM users WHERE name = $1', [req.session.user.name]);
  const { rows } = await pool.query(
    `SELECT f.id AS friendship_id,
       CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name,
       CASE WHEN f.requester_id = $1 THEN u2.friend_code ELSE u1.friend_code END AS friend_code,
       CASE WHEN f.requester_id = $1 THEN u2.id ELSE u1.id END AS friend_id,
       (SELECT a.updated_at FROM user_avatars a
        WHERE a.user_id = CASE WHEN f.requester_id = $1 THEN u2.id ELSE u1.id END) AS friend_avatar_at,
       -- Latest song either way, or when the friendship started; the list is sorted by it
       COALESCE((SELECT MAX(sh.sent_at) FROM song_history sh WHERE sh.friendship_id = f.id), f.created_at) AS last_activity,
       -- Whose turn, counting only songs since the midnight clear:
       -- null = nobody has sent today, true = waiting on them, false = your turn
       (SELECT sh.sent_by = $2 FROM song_history sh WHERE sh.friendship_id = f.id
          AND sh.sent_at >= (date_trunc('day', NOW() AT TIME ZONE $3) AT TIME ZONE $3)
        ORDER BY sh.sent_at DESC, sh.id DESC LIMIT 1) AS last_sent_by_me
     FROM friendships f
     JOIN users u1 ON u1.id = f.requester_id
     JOIN users u2 ON u2.id = f.receiver_id
     WHERE (f.requester_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'
     ORDER BY last_activity DESC, friend_name`,
    [me[0].id, req.session.user.name, RESET_TIMEZONE]
  );
  const { rows: songs } = await pool.query(
    'SELECT friendship_id, sent_by, artist, rating FROM song_history WHERE friendship_id = ANY($1::int[])',
    [rows.map(r => r.friendship_id)]
  );
  const byFriendship = {};
  for (const s of songs) (byFriendship[s.friendship_id] ??= []).push(s);
  res.json(rows.map(r => ({ ...r, match: compatibility(byFriendship[r.friendship_id] ?? [], req.session.user.name) })));
});

// ── Compatibility ──
// Only uses songs from this one swap. 80% from how you rate each other's
// songs (1★ = 0, 5★ = 100), 20% from overlap in the artists you each send.
const MATCH_MIN_SONGS = 5;
const MATCH_MIN_RATINGS = 2;
// "A feat. B", "A, B", "A & B", "A x B", "A with B" -> separate artists
const ARTIST_SEPARATORS = /\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*|\s+x\s+/i;
const splitArtists = (artist) => (artist || '')
  .toLowerCase()
  .split(ARTIST_SEPARATORS)
  .map(a => a.trim())
  .filter(Boolean);
const compatibility = (songs, me) => {
  const rated = songs.filter(s => s.rating);
  const need = Math.max(MATCH_MIN_SONGS - songs.length, 0);
  if (need > 0 || rated.length < MATCH_MIN_RATINGS) {
    return { ready: false, songsNeeded: need, ratingsNeeded: Math.max(MATCH_MIN_RATINGS - rated.length, 0) };
  }
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  // Ratings are given by the recipient: songs they sent carry your ratings
  const youGive = avg(rated.filter(s => s.sent_by !== me).map(s => s.rating));
  const theyGive = avg(rated.filter(s => s.sent_by === me).map(s => s.rating));
  const sides = [youGive, theyGive].filter(x => x !== null);
  const ratingScore = (avg(sides) - 1) / 4;

  const mineArtists = new Map(), theirArtists = new Map(); // lowercase -> display name
  for (const s of songs) {
    const target = s.sent_by === me ? mineArtists : theirArtists;
    const display = (s.artist || '').split(ARTIST_SEPARATORS).map(a => a.trim()).filter(Boolean);
    splitArtists(s.artist).forEach((a, i) => { if (!target.has(a)) target.set(a, display[i] ?? a); });
  }
  const shared = [...mineArtists.keys()].filter(a => theirArtists.has(a));
  const smaller = Math.min(mineArtists.size, theirArtists.size);
  const artistScore = smaller ? shared.length / smaller : 0;

  return {
    ready: true,
    percent: Math.round(100 * (0.8 * ratingScore + 0.2 * artistScore)),
    youGive: youGive && Math.round(youGive * 10) / 10,
    theyGive: theyGive && Math.round(theyGive * 10) / 10,
    sharedArtists: shared.slice(0, 3).map(a => mineArtists.get(a)),
  };
};

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
// Everything the home dashboard shows, in one request
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id, name FROM users WHERE name = $1', [req.session.user.name]);
  const [uid, name] = [me[0].id, me[0].name];
  const mine = `SELECT f.id, CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name
    FROM friendships f JOIN users u1 ON u1.id = f.requester_id JOIN users u2 ON u2.id = f.receiver_id
    WHERE (f.requester_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'`;
  // Same, minus test accounts: used for the "Your numbers" totals
  const mineReal = `${mine} AND NOT u1.is_test AND NOT u2.is_test`;
  // Start of today / tomorrow in the reset timezone, matching the midnight clear
  const TODAY = `(date_trunc('day', NOW() AT TIME ZONE $3) AT TIME ZONE $3)`;
  const [newForYou, today, unrated, recent, loved, stats, resetAt] = await Promise.all([
    // Latest song from each friend that you haven't looked at yet
    pool.query(
      `WITH mine AS (${mine})
       SELECT * FROM (
         SELECT DISTINCT ON (sh.friendship_id) sh.*, m.friend_name, r.last_read_at
         FROM song_history sh JOIN mine m ON m.id = sh.friendship_id
         LEFT JOIN friendship_reads r ON r.friendship_id = sh.friendship_id AND r.user_id = $1
         WHERE sh.sent_by != $2
         ORDER BY sh.friendship_id, sh.sent_at DESC
       ) latest
       WHERE last_read_at IS NULL OR sent_at > last_read_at
       ORDER BY sent_at DESC`,
      [uid, name]
    ),
    // Today's latest song each way, per friend
    pool.query(
      `WITH mine AS (${mine}),
       todays AS (
         SELECT DISTINCT ON (sh.friendship_id, sh.sent_by = $2) sh.*, (sh.sent_by = $2) AS from_me
         FROM song_history sh JOIN mine m ON m.id = sh.friendship_id
         WHERE sh.sent_at >= ${TODAY}
         ORDER BY sh.friendship_id, sh.sent_by = $2, sh.sent_at DESC
       )
       SELECT m.id AS friendship_id, m.friend_name,
         (SELECT row_to_json(t) FROM todays t WHERE t.friendship_id = m.id AND t.from_me) AS mine,
         (SELECT row_to_json(t) FROM todays t WHERE t.friendship_id = m.id AND NOT t.from_me) AS theirs
       FROM mine m ORDER BY m.friend_name`,
      [uid, name, RESET_TIMEZONE]
    ),
    // Songs sent to you that you haven't rated yet
    pool.query(
      `WITH mine AS (${mine})
       SELECT sh.*, m.friend_name FROM song_history sh JOIN mine m ON m.id = sh.friendship_id
       WHERE sh.sent_by != $2 AND sh.rating IS NULL AND NOT sh.imported
       ORDER BY sh.sent_at DESC LIMIT 5`,
      [uid, name]
    ),
    // Latest swaps both ways, across all friends
    pool.query(
      `WITH mine AS (${mine})
       SELECT sh.*, m.friend_name FROM song_history sh JOIN mine m ON m.id = sh.friendship_id
       ORDER BY sh.sent_at DESC LIMIT 8`,
      [uid]
    ),
    // Songs friends sent you that you rated 4 or 5 stars
    pool.query(
      `WITH mine AS (${mine})
       SELECT sh.*, m.friend_name FROM song_history sh JOIN mine m ON m.id = sh.friendship_id
       WHERE sh.sent_by != $2 AND sh.rating >= 4
       ORDER BY COALESCE(sh.rated_at, sh.sent_at) DESC LIMIT 24`,
      [uid, name]
    ),
    // Totals, average rating your songs got, most-swapped artist
    pool.query(
      `WITH mine AS (${mineReal}),
       songs AS (SELECT sh.* FROM song_history sh JOIN mine m ON m.id = sh.friendship_id)
       SELECT
         (SELECT COUNT(*) FROM songs WHERE sent_by = $2)::int AS sent,
         (SELECT COUNT(*) FROM songs WHERE sent_by != $2)::int AS received,
         (SELECT ROUND(AVG(rating)::numeric, 1) FROM songs WHERE sent_by = $2 AND rating IS NOT NULL)::float AS avg_rating_received,
         (SELECT COUNT(*) FROM songs WHERE sent_by = $2 AND rating IS NOT NULL)::int AS ratings_received,
         (SELECT artist FROM songs WHERE COALESCE(artist, '') != ''
            GROUP BY LOWER(artist), artist ORDER BY COUNT(*) DESC, MAX(sent_at) DESC LIMIT 1) AS top_artist`,
      [uid, name]
    ),
    pool.query(`SELECT ((date_trunc('day', NOW() AT TIME ZONE $1) + INTERVAL '1 day') AT TIME ZONE $1) AS at`, [RESET_TIMEZONE]),
  ]);
  const withFriend = r => ({ ...rowToEntry(r), friendName: r.friend_name });
  res.json({
    newForYou: newForYou.rows.map(withFriend),
    today: today.rows.map(r => ({
      friendshipId: r.friendship_id, friendName: r.friend_name,
      mine: r.mine ? rowToEntry(r.mine) : null, theirs: r.theirs ? rowToEntry(r.theirs) : null,
    })),
    unrated: unrated.rows.map(withFriend),
    recent: recent.rows.map(withFriend),
    loved: loved.rows.map(withFriend),
    stats: stats.rows[0],
    resetAt: resetAt.rows[0].at,
  });
});

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
       AND u.name = $3 AND sh.sent_by <> $3 AND NOT sh.imported
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
app.get('/api/friends/:id/current-song', requireAuth, async (req, res) => {
  const myName = req.session.user.name;
  if (!(await isFriendshipMember(myName, req.params.id))) return res.status(403).json({ error: 'Forbidden' });
  const fid = Number(req.params.id);
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

// ── Announcements (memos to all users) ──
const ANNOUNCEMENT_MAX = 280;
const ANNOUNCEMENT_ACTIONS = ['settings'];

// The oldest memo this user hasn't closed yet (one banner at a time)
app.get('/api/announcements', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.message, a.action FROM announcements a
     JOIN users u ON u.name = $1
     WHERE a.id > u.last_announcement_id
     ORDER BY a.id LIMIT 1`,
    [req.session.user.name]
  );
  res.json({ announcement: rows[0] ?? null });
});

app.post('/api/announcements/:id/dismiss', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Bad id' });
  await pool.query(
    'UPDATE users SET last_announcement_id = GREATEST(last_announcement_id, $1) WHERE name = $2',
    [id, req.session.user.name]
  );
  res.json({ success: true });
});

app.get('/api/admin/announcements', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.message, a.action, a.created_at,
       -- people who had an account when it was posted and have closed it
       (SELECT COUNT(*)::int FROM users u WHERE u.last_announcement_id >= a.id AND u.created_at < a.created_at AND NOT u.is_test) AS seen
     FROM announcements a ORDER BY a.id DESC LIMIT 20`
  );
  res.json(rows);
});

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  const action = ANNOUNCEMENT_ACTIONS.includes(req.body?.action) ? req.body.action : null;
  if (!message) return res.status(400).json({ error: 'Write a message first' });
  if (message.length > ANNOUNCEMENT_MAX) return res.status(400).json({ error: `Keep it under ${ANNOUNCEMENT_MAX} characters` });
  const { rows } = await pool.query(
    'INSERT INTO announcements (message, action) VALUES ($1, $2) RETURNING id',
    [message, action]
  );
  io.emit('announcements-updated'); // people online see it right away
  res.status(201).json({ id: rows[0].id });
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [parseInt(req.params.id, 10) || 0]);
  io.emit('announcements-updated');
  res.json({ success: true });
});

app.delete('/api/admin/history', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM song_history');
  clearLastSent();
  io.emit('song-cleared');
  io.emit('history-cleared');
  res.json({ success: true });
});

// ── History import (admin) ──
// Backfill song_history from a CSV of past swaps, one song per row:
//   date, sender, receiver, link
// A header row is optional; with one, columns can be in any order and are
// matched by name (e.g. to, from, links, dateTime). Each link is
// looked up like a normal send. Duplicates (same check as send-song) are
// resolved per friendship with the OLDEST copy winning: within the CSV the
// earliest row is kept; against the site, an older-or-equal site copy wins and
// the CSV row is skipped, otherwise the newer site copy is replaced. Re-running
// the same CSV is therefore a no-op. Lookups are slow, so the import runs as a
// background job the admin page polls.
const IMPORT_MAX_ROWS = 1000;
const IMPORT_CONCURRENCY = 3;
const importJobs = new Map(); // id → job (in memory; admin-only, short-lived)

const parseCsv = (text) => {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.trim()));
};

// Column positions: from a header row if there is one, else the default order
const IMPORT_HEADER_NAMES = {
  date: ['date', 'datetime', 'sentat', 'sent', 'time', 'timestamp'],
  sender: ['sender', 'from', 'sentby'],
  receiver: ['receiver', 'to', 'recipient'],
  link: ['link', 'links', 'url', 'song', 'songlink'],
};
const importColumns = (first) => {
  // "dateTime", "Date Time" and "date_time" all count as datetime
  const lower = first.map(f => f.toLowerCase().replace(/[^a-z]/g, ''));
  const found = {};
  for (const [col, names] of Object.entries(IMPORT_HEADER_NAMES)) {
    const i = lower.findIndex(f => names.includes(f));
    if (i !== -1) found[col] = i;
  }
  if (Object.keys(found).length === 4) return { header: true, cols: found };
  return { header: false, cols: { date: 0, sender: 1, receiver: 2, link: 3 } };
};

// Same identity rules as the send-song duplicate check
const songKeys = (s) => [
  s.odesliPageUrl && `o:${s.odesliPageUrl}`,
  s.spotifyUri && `u:${s.spotifyUri}`,
  `t:${(s.title ?? '').toLowerCase()}\u0000${(s.artist ?? '').toLowerCase()}`,
].filter(Boolean);

const runHistoryImport = async (job, entries) => {
  // 1. Look up each distinct link (a few at a time, one retry on server errors)
  const lookups = new Map();
  const links = [...new Set(entries.map(e => e.link))];
  let next = 0;
  const worker = async () => {
    while (next < links.length) {
      const link = links[next++];
      let result = await resolveSong(link);
      if (result.error && result.status >= 500) result = await resolveSong(link);
      lookups.set(link, result);
      job.processed += entries.filter(e => e.link === link).length;
    }
  };
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));

  // 2. Per friendship, oldest first
  const byFriendship = new Map();
  for (const e of entries) {
    const song = lookups.get(e.link);
    if (song.error) { e.report.status = 'failed'; e.report.message = song.error; continue; }
    e.song = song;
    e.report.title = song.title;
    e.report.artist = song.artist;
    if (!byFriendship.has(e.friendshipId)) byFriendship.set(e.friendshipId, []);
    byFriendship.get(e.friendshipId).push(e);
  }

  for (const [friendshipId, list] of byFriendship) {
    list.sort((a, b) => a.sentAt - b.sentAt || a.report.row - b.report.row);
    const seen = new Map(); // song key → row number of the kept CSV row
    const deletedHere = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of list) {
        const keys = songKeys(e.song);
        const earlier = keys.map(k => seen.get(k)).find(Boolean);
        if (earlier) {
          e.report.status = 'skipped';
          e.report.message = `Duplicate of an older CSV row (row ${earlier})`;
          continue;
        }
        keys.forEach(k => seen.set(k, e.report.row));

        const { rows: dups } = await client.query(
          `SELECT id, sent_at FROM song_history WHERE friendship_id = $1
           AND (
             ($2::text IS NOT NULL AND odesli_page_url = $2)
             OR ($3::text IS NOT NULL AND spotify_uri = $3)
             OR (LOWER(title) = LOWER($4) AND LOWER(artist) = LOWER($5))
           )`,
          [friendshipId, e.song.odesliPageUrl ?? null, e.song.spotifyUri ?? null, e.song.title ?? '', e.song.artist ?? '']
        );
        const older = dups.find(d => d.sent_at <= e.sentAt);
        if (older) {
          e.report.status = 'skipped';
          e.report.message = `Already in history from ${older.sent_at.toISOString().slice(0, 10)}`;
          continue;
        }
        if (dups.length > 0) {
          await client.query('DELETE FROM song_history WHERE id = ANY($1)', [dups.map(d => d.id)]);
          deletedHere.push(...dups.map(d => d.id));
        }
        const s = e.song;
        await client.query(
          `INSERT INTO song_history
            (title, artist, album, album_art, spotify_uri, spotify_url,
             platform_links, source_url, odesli_page_url, sent_by, friendship_id, sent_at, imported)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)`,
          [s.title, s.artist, s.album, s.albumArt, s.spotifyUri ?? null, s.spotifyUrl ?? null,
           s.platformLinks ? JSON.stringify(s.platformLinks) : null, s.sourceUrl ?? null,
           s.odesliPageUrl ?? null, e.senderName, friendshipId, e.sentAt]
        );
        e.report.status = dups.length > 0 ? 'replaced' : 'added';
        if (dups.length > 0) e.report.message = `Replaced a newer copy already in history`;
      }
      await client.query('COMMIT');
      job.deletedIds.push(...deletedHere);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('history import failed for friendship', friendshipId, err);
      for (const e of list) {
        if (['added', 'replaced'].includes(e.report.status) || !e.report.status) {
          e.report.status = 'failed';
          e.report.message = 'Database error — nothing from this friendship was imported';
        }
      }
    } finally {
      client.release();
    }
  }

  // Replaced rows may have been someone's current song for today
  const deleted = new Set(job.deletedIds);
  for (const songs of Object.values(lastSentByFriendship)) {
    for (const [name, entry] of Object.entries(songs)) if (deleted.has(entry.id)) delete songs[name];
  }
};

app.post('/api/admin/history/import', requireAdmin,
  express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), async (req, res) => {
  if ([...importJobs.values()].some(j => j.status === 'running')) {
    return res.status(409).json({ error: 'An import is already running — wait for it to finish' });
  }
  if (typeof req.body !== 'string' || !req.body.trim()) return res.status(400).json({ error: 'Upload a CSV file' });

  const csv = parseCsv(req.body);
  const numbered = csv.map((fields, i) => ({ fields, row: i + 1 })).filter(r => r.fields.some(Boolean));
  if (numbered.length === 0) return res.status(400).json({ error: 'That CSV is empty' });
  const { header, cols } = importColumns(numbered[0].fields);
  const dataRows = header ? numbered.slice(1) : numbered;
  if (dataRows.length === 0) return res.status(400).json({ error: 'That CSV has no rows after the header' });
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (${dataRows.length}) — split it into files of ${IMPORT_MAX_ROWS} or fewer` });
  }

  // Users and their accepted friendships, looked up once
  const names = [...new Set(dataRows.flatMap(r => [r.fields[cols.sender], r.fields[cols.receiver]])
    .filter(Boolean).map(n => n.toLowerCase()))];
  const { rows: users } = await pool.query('SELECT id, name FROM users WHERE LOWER(name) = ANY($1)', [names]);
  const userByName = new Map(users.map(u => [u.name.toLowerCase(), u]));
  const { rows: friendships } = await pool.query(
    `SELECT id, requester_id, receiver_id FROM friendships
     WHERE status = 'accepted' AND requester_id = ANY($1) AND receiver_id = ANY($1)`,
    [users.map(u => u.id)]
  );
  const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const friendshipByPair = new Map(friendships.map(f => [pairKey(f.requester_id, f.receiver_id), f.id]));

  const reports = [];
  const entries = [];
  for (const { fields, row } of dataRows) {
    const date = fields[cols.date] ?? '', sender = fields[cols.sender] ?? '';
    const receiver = fields[cols.receiver] ?? '', link = fields[cols.link] ?? '';
    const report = { row, date, sender, receiver, link };
    reports.push(report);
    const fail = (message) => { report.status = 'failed'; report.message = message; };

    if (!date || !sender || !receiver || !link) { fail('Missing a column (need date, sender, receiver, link)'); continue; }
    const from = userByName.get(sender.toLowerCase());
    const to = userByName.get(receiver.toLowerCase());
    if (!from) { fail(`No user named "${sender}"`); continue; }
    if (!to) { fail(`No user named "${receiver}"`); continue; }
    if (from.id === to.id) { fail('Sender and receiver are the same person'); continue; }
    const friendshipId = friendshipByPair.get(pairKey(from.id, to.id));
    if (!friendshipId) { fail(`${from.name} and ${to.name} aren't friends`); continue; }

    // Dates without a time zone are read in the app's time zone
    let sentAt;
    try {
      const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(date) && /\d[T ]\d/.test(date);
      const { rows } = await pool.query(
        hasZone ? 'SELECT $1::timestamptz AS t' : 'SELECT ($1::timestamp AT TIME ZONE $2) AS t',
        hasZone ? [date] : [date, RESET_TIMEZONE]
      );
      sentAt = rows[0].t;
    } catch { fail(`Can't read the date "${date}"`); continue; }
    if (!sentAt || sentAt > new Date()) { fail('Date is in the future'); continue; }

    entries.push({ report, link, sentAt, senderName: from.name, friendshipId });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id, status: 'running', total: entries.length, processed: 0, rows: reports,
    deletedIds: [], startedAt: new Date(),
  };
  importJobs.set(id, job);
  // Keep only the last few finished jobs
  for (const [jid, j] of importJobs) if (importJobs.size > 5 && j.status !== 'running') importJobs.delete(jid);

  runHistoryImport(job, entries)
    .then(() => { job.status = 'done'; })
    .catch(err => { console.error('history import crashed:', err); job.status = 'failed'; job.error = 'Import crashed — check the server logs'; })
    .finally(() => { job.finishedAt = new Date(); });

  res.status(202).json({ id });
});

app.get('/api/admin/history/import/:id', requireAdmin, (req, res) => {
  const job = importJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Import not found (the server may have restarted)' });
  const summary = { added: 0, replaced: 0, skipped: 0, failed: 0 };
  for (const r of job.rows) if (summary[r.status] !== undefined) summary[r.status]++;
  res.json({
    status: job.status, error: job.error ?? null, total: job.total, processed: job.processed,
    summary, rows: job.status === 'running' ? [] : job.rows,
  });
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
    // sw.js too, so service worker updates are picked up promptly
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  };
  // extensions: /what-is-a-song-swap serves what-is-a-song-swap.html
  app.use(express.static(DIST, { dotfiles: 'allow', extensions: ['html'], setHeaders: noCacheHtml }));
  // Invite and song-share links get a personal link preview ("Marcus invited
  // you…", "Marcus sent you a song") and stay out of search results
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sendPreviewPage = (res, { title, desc, url, image }) => {
    const t = escapeHtml(title), d = escapeHtml(desc);
    let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
      .replace(/(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*/g, (_, tag) => tag + t)
      .replace(/(<meta (?:property|name)="(?:og|twitter):description" content=")[^"]*/g, (_, tag) => tag + d)
      .replace(/(<meta property="og:url" content=")[^"]*/, (_, tag) => tag + escapeHtml(url))
      .replace('<head>', '<head>\n    <meta name="robots" content="noindex" />');
    if (image) {
      html = html
        .replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")[^"]*/g, (_, tag) => tag + escapeHtml(image))
        .replace(/\s*<meta property="og:image:(?:width|height|alt)" content="[^"]*" \/>/g, '')
        .replace('content="summary_large_image"', 'content="summary"'); // album art is square
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  };
  app.get('/add/:code', async (req, res, next) => {
    try {
      const name = await inviterName(req.params.code);
      if (!name) return next();
      sendPreviewPage(res, {
        title: `${name} invited you to Song Swap`,
        desc: `Swap songs with ${name}, one track at a time. Works with Spotify, Apple Music, YouTube Music, and more.`,
        url: `https://song-swap.app/add/${req.params.code.toUpperCase()}`,
      });
    } catch (err) { next(err); }
  });
  app.get('/s/:id', async (req, res, next) => {
    try {
      const share = await loadShare(req.params.id);
      if (!share) return next();
      sendPreviewPage(res, {
        title: `${share.from_name} sent you a song: ${share.title} — ${share.artist}`,
        desc: `Listen on Spotify, Apple Music, YouTube Music, or whatever you use, then send ${share.from_name} a song back on Song Swap.`,
        url: `https://song-swap.app/s/${req.params.id}`,
        image: /^https:\/\//.test(share.album_art ?? '') ? share.album_art : null,
      });
    } catch (err) { next(err); }
  });
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

// A search that finished cleanly and found no match. Only these count as
// "not on this service"; errors, missing keys and services we can't check
// reliably return null (unknown), and the frontend falls back to a search.
const NOT_FOUND = Object.freeze({ notFound: true });

const searchSpotify = async (song) => {
  const token = await getSpotifyToken();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };
  const search = (q, limit) => fetchJson(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`, { headers });
  try {
    if (song.isrc) {
      const data = await search(`isrc:${song.isrc}`, 1);
      if (!data) return null;
      const hit = data.tracks?.items?.[0];
      if (hit) return { id: hit.id, isrc: song.isrc };
    }
    const data = await search(`track:${coreTitle(song.title)} artist:${leadArtist(song.artist)}`, 10);
    if (!data) return null;
    const hit = pickBest(song, data.tracks?.items, t => t.name, t => t.artists.map(a => a.name).join(', '));
    return hit ? { id: hit.id, isrc: hit.external_ids?.isrc ?? null } : NOT_FOUND;
  } catch { return null; }
};

const searchItunes = async (song) => {
  try {
    const q = encodeURIComponent(`${coreTitle(song.title)} ${leadArtist(song.artist)}`);
    const data = await fetchJson(`https://itunes.apple.com/search?term=${q}&entity=song&limit=15&country=us`);
    if (!data) return null;
    const hit = pickBest(song, data.results, r => r.trackName, r => r.artistName);
    return hit?.trackViewUrl ? { url: hit.trackViewUrl } : NOT_FOUND;
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
    // Deezer reports failures (e.g. quota) as 200 with an error object
    if (!data || data.error || !Array.isArray(data.data)) return null;
    const hit = pickBest(song, data.data, t => t.title, t => t.artist?.name);
    return hit?.link ? { url: hit.link } : NOT_FOUND;
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

// Look up a pasted song link and find it on every platform.
// Returns the song, or { status, error } when it can't.
const resolveSong = async (link) => {
  if (!link || typeof link !== 'string') return { status: 400, error: 'Link required' };

  let parsed = parseLink(link);
  if (!parsed) return { status: 400, error: 'Paste a Spotify, Apple Music, YouTube, Deezer, or Tidal song link' };
  if (parsed.error) return { status: 400, error: parsed.error };

  try {
    if (parsed.shortUrl) {
      const id = await resolveShortLink(parsed.shortUrl, parsed.pattern);
      if (!id) return { status: 404, error: 'Could not open that link — paste the full song link' };
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
        if (song?.unavailable) return { status: 400, error: "Tidal links can't be read yet — paste the song from another app" };
        if (song) platformLinks.tidal = { url: song.url };
        break;
    }
    if (!song) return { status: 404, error: 'Song not found' };

    // 2. Spotify first: its API can supply the ISRC that makes the rest exact
    let spotifyId = parsed.platform === 'spotify' ? parsed.id : null;
    if (!platformLinks.spotify) {
      const sp = await searchSpotify(song);
      if (sp?.notFound) platformLinks.spotify = NOT_FOUND;
      else if (sp) {
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

    return {
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
    };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { status: 504, error: 'Music lookup timed out — try again' };
    }
    console.error('Song lookup failed:', err);
    return { status: 502, error: 'Music lookup failed — try again in a moment' };
  }
};

app.post('/api/verify', requireAuth, perUserLimit(verifyLimiter), async (req, res) => {
  const result = await resolveSong(req.body?.link);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ── Song share links ─────────────────────────────────────────────────────────
// /s/<id>: send one song to anyone, even someone without an account. The page
// plays it in their music app and invites them to swap back (a normal friend
// request). The server looks the song up itself, so a share page only ever
// shows real song details.
const SHARE_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const newShareId = () => Array.from(crypto.randomBytes(10), b => SHARE_ID_CHARS[b % SHARE_ID_CHARS.length]).join('');
const SHARES_PER_HOUR = 30;
const shareCounts = new Map(); // userId → { count, start }

app.post('/api/shares', requireAuth, async (req, res) => {
  const { rows: me } = await pool.query('SELECT id, is_test FROM users WHERE name = $1', [req.session.user.name]);
  const now = Date.now();
  const entry = shareCounts.get(me[0].id) ?? { count: 0, start: now };
  if (now - entry.start > 60 * 60 * 1000) { entry.count = 0; entry.start = now; }
  if (entry.count >= SHARES_PER_HOUR) return res.status(429).json({ error: 'Too many share links — try again later' });

  const song = await resolveSong(req.body?.link);
  if (song.error) return res.status(song.status).json({ error: song.error });
  entry.count++;
  shareCounts.set(me[0].id, entry);
  if (!me[0].is_test) countEvent('share_created');

  const ALLOWED_EXPIRY_DAYS = [1, 7, 30];
  const days = Number(req.body?.expiresInDays);
  const expiresAt = ALLOWED_EXPIRY_DAYS.includes(days) ? new Date(Date.now() + days * 864e5) : null;

  const id = newShareId();
  await pool.query(
    `INSERT INTO song_shares (id, user_id, title, artist, album, album_art, platform_links, source_url, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, me[0].id, song.title, song.artist, song.album, song.albumArt, JSON.stringify(song.platformLinks), song.sourceUrl, expiresAt]
  );
  res.status(201).json({ id, url: `${req.protocol}://${req.get('host')}/s/${id}`, song });
});


initDb().then(async () => {
  // Restore today's current songs after a restart. Only songs sent since the
  // last midnight reset count; older ones were already cleared.
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (sent_by, friendship_id) * FROM song_history
     WHERE sent_at >= (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1) AND NOT imported
     ORDER BY sent_by, friendship_id, sent_at DESC`,
    [RESET_TIMEZONE]
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
