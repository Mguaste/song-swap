import './App.css'
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import icon from './assets/SSLogo.png'

const socket = io();

const BASE_TITLE = document.title;
const FAVICON_URL = '/swap-favicon.png';
let faviconWithPip = null; // data URL, drawn once on first use

// Swap the tab icon between the plain favicon and one with a red unread pip
function setFaviconPip(on) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (!on) { link.href = FAVICON_URL; return; }
  if (faviconWithPip) { link.href = faviconWithPip; return; }
  const img = new Image();
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size * 0.76, size * 0.24, size * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = '#121212';
    ctx.stroke();
    faviconWithPip = canvas.toDataURL('image/png');
    // Only apply if there's still something unread by the time it loaded
    if (document.title !== BASE_TITLE) link.href = faviconWithPip;
  };
  img.src = FAVICON_URL;
}

// 1–5 stars. Interactive when onRate is given, otherwise display-only.
function StarRating({ value, onRate, className = '' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  if (!onRate) {
    return (
      <span className={`star-rating readonly ${className}`} aria-label={value ? `Rated ${value} out of 5` : 'Not rated yet'}>
        {[1, 2, 3, 4, 5].map(n => <span key={n} className={`star${n <= shown ? ' on' : ''}`}>★</span>)}
      </span>
    );
  }
  return (
    <span
      className={`star-rating ${className}`}
      role="radiogroup"
      aria-label="Rate this song"
      onMouseLeave={() => setHover(0)}
      onClick={e => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={`star${n <= shown ? ' on' : ''}`}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onRate(n)}
        >★</button>
      ))}
    </span>
  );
}

function AlbumArtPlaceholder() {
  return (
    <div className="album-art album-art-placeholder">
      <svg viewBox="0 0 24 24" fill="#bbb" width="40%" height="40%">
        <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
      </svg>
    </div>
  );
}

function LoginForm({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password }),
    });
    if (res.ok) onLogin();
    else setError((await res.json()).error || 'Invalid username or password');
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Log In</button>
    </form>
  );
}

function RegisterForm({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [preferredPlatform, setPreferredPlatform] = useState('spotify');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password, preferredPlatform }),
    });
    if (res.ok) onLogin();
    else setError((await res.json()).error || 'Registration failed');
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <input type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      <label htmlFor="register-platform" className="register-platform-label">Preferred music app</label>
      <select id="register-platform" value={preferredPlatform} onChange={e => setPreferredPlatform(e.target.value)} className="register-platform-select">
        <option value="spotify">Spotify</option>
        <option value="appleMusic">Apple Music</option>
        <option value="youtubeMusic">YouTube Music</option>
        <option value="amazonMusic">Amazon Music</option>
        <option value="tidal">Tidal</option>
        <option value="deezer">Deezer</option>
      </select>
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Sign Up</button>
    </form>
  );
}

const FEATURES = [
  {
    title: 'One song at a time',
    body: 'Trade a single track at a time. No endless playlists, no algorithmic recommendations, just you and a friend sharing the music you love.',
    icon: (
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    ),
  },
  {
    title: 'Any platform',
    body: 'Spotify, Apple Music, YouTube Music, Deezer, Tidal, Amazon Music — paste a link and it opens in the app you prefer.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </>
    ),
  },
  {
    title: 'Instant delivery',
    body: 'Songs land the moment they are sent. Real-time updates mean no refreshing and no waiting.',
    icon: (
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    ),
  },
  {
    title: 'Add friends with a code',
    body: 'Share your six-character friend code and start swapping. No emails, no searching, no spam.',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 11h-6M19 8v6" />
      </>
    ),
  },
  {
    title: 'No repeats',
    body: 'Built-in duplicate detection makes sure you never send a friend the same song twice.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Full history',
    body: 'Every swap is saved. Look back through everything you and a friend have traded over time.',
    icon: (
      <>
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </>
    ),
  },
];

const STEPS = [
  { n: '1', title: 'Create an account', body: 'Sign up and pick the music app you listen on.' },
  { n: '2', title: 'Add a friend', body: 'Swap six-character codes to connect.' },
  { n: '3', title: 'Send a song', body: 'Paste a link, hit send, and discover what comes back.' },
];

function LandingPage({ onLogin, onSignup }) {
  return (
    <div id="landing">
      <header id="landing-nav">
        <div className="landing-brand">
          <img src={icon} alt="Song Swap" />
          <span>Song Swap</span>
        </div>
        <div className="landing-nav-actions">
          <button className="landing-btn-ghost" onClick={onLogin}>Log in</button>
          <button className="landing-btn-primary" onClick={onSignup}>Sign up</button>
        </div>
      </header>

      <section id="landing-hero">
        <img src={icon} id="landing-hero-logo" alt="Song Swap" />
        <h1>Share the songs you love <br/>with the people you love.</h1>
        <p className="landing-hero-sub">
          Song Swap is a simple way to trade music with friends — one track at a time,
          on whatever app you already use.
        </p>
        <div className="landing-hero-actions">
          <button className="landing-btn-primary landing-btn-lg" onClick={onSignup}>Get started — it's free</button>
          <button className="landing-btn-ghost landing-btn-lg" onClick={onLogin}>I have an account</button>
        </div>
        <p className="landing-hero-tagline">Community in Music</p>
      </section>

      <section id="landing-features">
        <h2 className="landing-section-title">Why Song Swap</h2>
        <div className="landing-feature-grid">
          {FEATURES.map(f => (
            <div className="landing-feature" key={f.title}>
              <div className="landing-feature-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                  {f.icon}
                </svg>
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="landing-steps">
        <h2 className="landing-section-title">How it works</h2>
        <div className="landing-steps-row">
          {STEPS.map(s => (
            <div className="landing-step" key={s.n}>
              <div className="landing-step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="landing-cta">
        <h2>Ready to swap?</h2>
        <p>Find out what your friends are listening to today.</p>
        <button className="landing-btn-primary landing-btn-lg" onClick={onSignup}>Create your account</button>
      </section>

      <footer id="landing-footer">
        <div className="landing-footer-row">
          <span>© 2026 Song Swap</span>
          <nav className="landing-footer-links">
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="https://github.com/Mguaste/song-swap" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://ko-fi.com/mguaste" target="_blank" rel="noreferrer">Support on Ko-fi</a>
          </nav>
        </div>
        <p className="landing-disclaimer">
          Song Swap is an independent project and is not affiliated with, endorsed by, or connected to
          Spotify, Apple, Google, Amazon, Tidal, or Deezer. Platform names are used only to describe which
          services' song links the app can open. We never ask for your credentials to any other service.
        </p>
      </footer>
    </div>
  );
}

// /add/ABC123 invite links: remember the code (survives sign-up/log-in), then
// clean the URL. The code is turned into a friend request once logged in.
const INVITE_KEY = 'ss_pending_invite';
const readPendingInvite = () => {
  const m = window.location.pathname.match(/^\/add\/([A-Za-z0-9]{6})\/?$/);
  try {
    if (m) {
      sessionStorage.setItem(INVITE_KEY, m[1].toUpperCase());
      window.history.replaceState(null, '', '/');
    }
    return sessionStorage.getItem(INVITE_KEY);
  } catch { return m ? m[1].toUpperCase() : null; }
};
const clearPendingInvite = () => { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ } };

function App() {
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState(() => (readPendingInvite() ? 'register' : 'login'));
  const [pendingInvite, setPendingInvite] = useState(readPendingInvite);
  // Arriving logged out from an invite link goes straight to sign-up
  const [showAuth, setShowAuth] = useState(() => !!pendingInvite);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Friends
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [activeFriendship, setActiveFriendship] = useState(null);
  const activeFriendshipRef = useRef(null);
  const [addCodeInput, setAddCodeInput] = useState('');
  const [addCodeError, setAddCodeError] = useState('');
  const [addCodeSuccess, setAddCodeSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Swap lane
  const [songLink, setSongLink] = useState('');
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyReqRef = useRef(0); // ignore responses for a link that's since been changed
  const [denied, setDenied] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [songDetails, setSongDetails] = useState(null);
  const [receivedSong, setReceivedSong] = useState(null);
  const [history, setHistory] = useState([]);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPwCurrent, setSettingsPwCurrent] = useState('');
  const [settingsPwNew, setSettingsPwNew] = useState('');
  const [settingsPwConfirm, setSettingsPwConfirm] = useState('');
  const [settingsPwError, setSettingsPwError] = useState('');
  const [settingsPwSuccess, setSettingsPwSuccess] = useState('');

  // Admin
  const [showAdmin, setShowAdmin] = useState(false);
  const [preferredPlatform, setPreferredPlatform] = useState('spotify');
  const [verifyError, setVerifyError] = useState('');

  // Unread tracking
  const [unreadFriendships, setUnreadFriendships] = useState(new Set());
  const userRef = useRef(null);

  const loadMe = async () => {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setUser(data);
      setPreferredPlatform(data.preferred_platform ?? 'spotify');
    } else {
      setUser(null);
    }
  };

  const loadFriends = async () => {
    const r = await fetch('/api/friends', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setFriends(data);
      return data;
    }
    return friends;
  };

  // Incoming and outgoing pending requests
  const loadRequests = async () => {
    const [r, s] = await Promise.all([
      fetch('/api/friends/requests', { credentials: 'include' }),
      fetch('/api/friends/sent', { credentials: 'include' }),
    ]);
    if (r.ok) setFriendRequests(await r.json());
    if (s.ok) setSentRequests(await s.json());
  };

  const removeUnread = (friendshipId) => setUnreadFriendships(prev => {
    if (!prev.has(friendshipId)) return prev;
    const next = new Set(prev); next.delete(friendshipId); return next;
  });

  // Record on the server that this swap has been seen. The server tells this
  // account's other tabs/devices so their badges clear too.
  const markRead = (friendshipId) => {
    removeUnread(friendshipId);
    fetch(`/api/friends/${friendshipId}/read`, { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  const loadUnreadStatus = async (currentUser) => {
    const r = await fetch('/api/friends/latest-activity', { credentials: 'include' });
    if (!r.ok) return;
    const activities = await r.json();
    // One-time carry-over from when read status lived in this browser
    const legacyKey = `ss_last_viewed_${currentUser.name}`;
    let legacy = {};
    try { legacy = JSON.parse(localStorage.getItem(legacyKey) || '{}'); } catch { /* ignore */ }
    const unread = new Set();
    for (const { friendshipId, sentAt, unread: isUnread } of activities) {
      if (!isUnread) continue;
      const active = friendshipId === activeFriendshipRef.current?.friendship_id;
      const seenHere = legacy[friendshipId] && new Date(legacy[friendshipId]) >= new Date(sentAt);
      // The swap that's open right now is being looked at, so it's read
      if (active || seenHere) markRead(friendshipId);
      else unread.add(friendshipId);
    }
    try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
    setUnreadFriendships(unread);
  };

  useEffect(() => { loadMe(); }, []);

  // Unread count in the tab title, plus a red pip on the favicon
  useEffect(() => {
    const count = unreadFriendships.size;
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
    setFaviconPip(count > 0);
  }, [unreadFriendships]);

  // Coming back to the tab: re-sync unread status from the server. Phones pause
  // background tabs and drop the socket, so live events (new swaps, reads on
  // other devices) can be missed. This also marks the open swap as read, if a
  // song arrived for it while the tab was hidden.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && userRef.current) loadUnreadStatus(userRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // loadUnreadStatus only uses state setters, refs and fetch, so a stale copy is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the Settings page
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowSettings(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings]);

  useEffect(() => {
    userRef.current = user;
    if (!user) return;
    loadFriends();
    loadRequests();
    loadUnreadStatus(user);
    if (pendingInvite) {
      clearPendingInvite();
      setPendingInvite(null);
      if (pendingInvite !== user.friend_code) {
        setSidebarOpen(true);
        addFriend(pendingInvite);
      }
    }
    // The socket connects at page load, possibly before login, so reconnect to
    // send the session cookie. Rooms are rejoined on every (re)connect.
    const joinRooms = () => {
      socket.emit('join-user');
      if (activeFriendshipRef.current) socket.emit('join-friendship', activeFriendshipRef.current.friendship_id);
      // Catch up on anything sent while disconnected (server restart, phone sleep)
      loadUnreadStatus(user);
    };
    socket.on('connect', joinRooms);
    socket.disconnect().connect();
    return () => socket.off('connect', joinRooms);
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => {
      if (song.friendshipId === activeFriendshipRef.current?.friendship_id) setReceivedSong(song);
    });
    socket.on('swap-received', ({ friendshipId }) => {
      const viewing = friendshipId === activeFriendshipRef.current?.friendship_id
        && document.visibilityState === 'visible';
      if (viewing) markRead(friendshipId);
      else setUnreadFriendships(prev => prev.has(friendshipId) ? prev : new Set(prev).add(friendshipId));
    });
    socket.on('swap-read', ({ friendshipId }) => removeUnread(friendshipId));
    socket.on('song-cleared', () => setReceivedSong(null));
    socket.on('song-rated', applyRating);
    socket.on('all-songs-cleared', () => { setReceivedSong(null); setSongDetails(null); });
    socket.on('send-success', () => { setSent(true); setTimeout(() => { setSent(false); setSongLink(''); }, 1500); });
    socket.on('duplicate-song', (entry) => { setDuplicate(entry); setDenied(true); setTimeout(() => setDenied(false), 1500); });
    socket.on('send-error', ({ error }) => setVerifyError(error || 'Could not send that song'));
    socket.on('history-updated', (entry) => {
      if (entry.friendshipId === activeFriendshipRef.current?.friendship_id) {
        setHistory(prev => [entry, ...prev]);
        if (entry.sentBy === userRef.current?.name) {
          setSongDetails(prev => (prev && !prev.id && prev.title === entry.title ? { ...prev, id: entry.id, rating: null } : prev));
        }
        // Unread handling for incoming songs is done by swap-received, which
        // knows whether the tab is hidden; only mark read if it's being looked at
        if (entry.sentBy !== userRef.current?.name && document.visibilityState === 'visible') {
          markRead(entry.friendshipId);
        }
      } else if (entry.sentBy !== userRef.current?.name) {
        setUnreadFriendships(prev => new Set([...prev, entry.friendshipId]));
      }
    });
    socket.on('history-cleared', () => setHistory([]));
    socket.on('friend-request-received', () => loadRequests());
    socket.on('friendship-accepted', () => { loadFriends(); loadRequests(); });
    socket.on('friendship-removed', ({ friendshipId }) => closeFriendship(friendshipId));
    socket.on('friend-request-declined', () => loadRequests());
    return () => {
      socket.off('song-received');
      socket.off('swap-received');
      socket.off('swap-read');
      socket.off('song-cleared');
      socket.off('song-rated');
      socket.off('all-songs-cleared');
      socket.off('send-success');
      socket.off('duplicate-song');
      socket.off('send-error');
      socket.off('history-updated');
      socket.off('history-cleared');
      socket.off('friend-request-received');
      socket.off('friendship-accepted');
      socket.off('friendship-removed');
      socket.off('friend-request-declined');
    };
  }, []);

  const selectFriend = async (friendship) => {
    const freshFriends = await loadFriends();
    const fresh = freshFriends.find(f => f.friendship_id === friendship.friendship_id) ?? friendship;
    setActiveFriendship(fresh);
    activeFriendshipRef.current = fresh;
    setShowSettings(false);
    if (window.innerWidth <= 700) setSidebarOpen(false);
    setSongLink('');
    setSongDetails(null);
    setVerifyError('');
    setDuplicate(null);
    setReceivedSong(null);
    setHistory([]);
    markRead(friendship.friendship_id);

    socket.emit('join-friendship', friendship.friendship_id);
    const [histRes, curRes, myRes] = await Promise.all([
      fetch(`/api/friends/${friendship.friendship_id}/history`, { credentials: 'include' }),
      fetch(`/api/friends/${friendship.friendship_id}/current-song`, { credentials: 'include' }),
      fetch(`/api/friends/${friendship.friendship_id}/my-song`, { credentials: 'include' }),
    ]);
    if (histRes.ok) {
      const hist = await histRes.json();
      setHistory(hist);
    }
    if (curRes.ok) {
      const song = await curRes.json();
      if (song && song.sentBy !== user.name) setReceivedSong(song);
    }
    if (myRes.ok) {
      const mySong = await myRes.json();
      if (mySong) setSongDetails(mySong);
    }
  };

  const PLATFORM_PRIORITY = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal', 'deezer'];

  const buildSearchUrl = (platform, title, artist) => {
    const q = encodeURIComponent(`${title} ${artist}`);
    switch (platform) {
      case 'spotify':       return `https://open.spotify.com/search/${q}`;
      case 'appleMusic':    return `https://music.apple.com/search?term=${q}`;
      case 'youtubeMusic':  return `https://music.youtube.com/search?q=${q}`;
      case 'tidal':         return `https://listen.tidal.com/search?q=${q}`;
      case 'deezer':        return `https://www.deezer.com/search/${q}`;
      case 'amazonMusic':   return `https://music.amazon.com/search/${q}`;
      default:              return null;
    }
  };

  const openWithLinks = (platformLinks, song) => {
    const preferred = platformLinks[preferredPlatform];
    if (preferred?.url) {
      if (preferredPlatform === 'spotify' && preferred.nativeAppUriMobile) {
        window.location.href = preferred.nativeAppUriMobile;
        setTimeout(() => window.open(preferred.url, '_blank'), 1000);
      } else {
        window.open(preferred.url, '_blank');
      }
      return;
    }
    // Preferred platform not in API response — use search URL if we have metadata
    if (song?.title && song?.artist) {
      const searchUrl = buildSearchUrl(preferredPlatform, song.title, song.artist);
      if (searchUrl) { window.open(searchUrl, '_blank'); return; }
    }
    // Final fallback: best available direct link
    for (const p of PLATFORM_PRIORITY) {
      const link = platformLinks[p];
      if (link?.url) { window.open(link.url, '_blank'); return; }
    }
    if (song?.odesliPageUrl) window.open(song.odesliPageUrl, '_blank');
  };

  const openSong = async (song) => {
    if (!song) return;
    if (song.platformLinks) {
      openWithLinks(song.platformLinks, song);
      return;
    }
    // Legacy song (no platformLinks) — re-resolve via /api/verify if user prefers non-Spotify
    if (preferredPlatform !== 'spotify' && song.spotifyUrl) {
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ link: song.spotifyUrl }),
        });
        if (res.ok) {
          const resolved = await res.json();
          if (resolved.platformLinks) { openWithLinks(resolved.platformLinks, { ...resolved, ...song }); return; }
        }
      } catch {}
    }
    // Fallback: open in Spotify
    if (song.spotifyUri) window.location.href = song.spotifyUri;
    setTimeout(() => { if (song.spotifyUrl) window.open(song.spotifyUrl, '_blank'); }, 1000);
  };

  // Called with a link (on paste) or with a click/key event (uses the input's value)
  const verifySong = async (linkArg) => {
    const link = (typeof linkArg === 'string' ? linkArg : songLink).trim();
    if (!link) return;
    const reqId = ++verifyReqRef.current;
    setVerifyError('');
    setSongDetails(null);
    setVerifying(true);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link }),
      });
      // A proxy error page (Cloudflare/Railway) isn't JSON — don't mistake that for a network failure
      const data = await res.json().catch(() => ({}));
      if (reqId !== verifyReqRef.current) return;
      if (!res.ok) {
        if (res.status === 401) setVerifyError('Your session expired — log in again');
        else if (data.error) setVerifyError(data.error);
        else if (res.status >= 500) setVerifyError(`Server error (${res.status}) — try again in a moment`);
        else setVerifyError('Could not find that song');
        return;
      }
      setSongDetails(data);
    } catch {
      if (reqId === verifyReqRef.current) setVerifyError('Network error — check your connection');
    } finally {
      if (reqId === verifyReqRef.current) setVerifying(false);
    }
  };

  const sendSong = () => {
    if (!songDetails || !activeFriendship) return;
    setDuplicate(null);
    setVerifyError('');
    socket.emit('send-song', { song: songDetails, friendshipId: activeFriendship.friendship_id });
  };

  // Called with a code (from an invite link) or from the Add button (uses the input)
  const addFriend = async (codeArg) => {
    const code = typeof codeArg === 'string' ? codeArg : addCodeInput;
    setAddCodeError('');
    setAddCodeSuccess('');
    const r = await fetch('/api/friends/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ friendCode: code }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) { setAddCodeSuccess(data.message); setAddCodeInput(''); loadRequests(); }
    else setAddCodeError(data.error || 'Could not add that friend');
  };

  const applyRating = ({ id, rating }) => {
    setHistory(prev => prev.map(e => (e.id === id ? { ...e, rating } : e)));
    setReceivedSong(prev => (prev?.id === id ? { ...prev, rating } : prev));
    setSongDetails(prev => (prev?.id === id ? { ...prev, rating } : prev));
  };

  const rateSong = async (entry, rating) => {
    const previous = entry.rating ?? null;
    applyRating({ id: entry.id, rating }); // optimistic
    try {
      const r = await fetch(`/api/songs/${entry.id}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating }),
      });
      if (!r.ok) throw new Error();
    } catch {
      applyRating({ id: entry.id, rating: previous });
      setVerifyError('Could not save your rating — try again');
    }
  };

  const removeFriend = async () => {
    const f = activeFriendship;
    if (!f) return;
    if (!window.confirm(`Remove ${f.friend_name}? This permanently deletes your whole swap history with them.`)) return;
    const r = await fetch(`/api/friends/${f.friendship_id}`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) { setVerifyError('Could not remove friend — try again'); return; }
    closeFriendship(f.friendship_id);
  };

  // Leave a friendship's view after it's removed (by either person)
  const closeFriendship = (friendshipId) => {
    setUnreadFriendships(prev => { const next = new Set(prev); next.delete(friendshipId); return next; });
    if (activeFriendshipRef.current?.friendship_id === friendshipId) {
      activeFriendshipRef.current = null;
      setActiveFriendship(null);
      setHistory([]);
      setReceivedSong(null);
      setSongDetails(null);
    }
    loadFriends();
  };

  const shareInvite = async () => {
    const url = `${window.location.origin}/add/${user.friend_code}`;
    // Phones get the native share sheet; desktops copy to the clipboard
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'Song Swap', text: 'Swap songs with me on Song Swap', url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch { window.prompt('Copy your invite link:', url); }
  };

  const acceptRequest = async (id) => {
    await fetch(`/api/friends/accept/${id}`, { method: 'POST', credentials: 'include' });
    await Promise.all([loadFriends(), loadRequests()]);
  };

  const declineRequest = async (id) => {
    await fetch(`/api/friends/requests/${id}`, { method: 'DELETE', credentials: 'include' });
    await loadRequests();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(user.friend_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const logout = () => fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {
    setUser(null);
    setActiveFriendship(null);
    setUnreadFriendships(new Set());
  });

  if (user === undefined) return null;

  if (!user && !showAuth) return (
    <LandingPage
      onLogin={() => { setAuthMode('login'); setShowAuth(true); }}
      onSignup={() => { setAuthMode('register'); setShowAuth(true); }}
    />
  );

  if (!user) return (
    <div id="login-page">
      <div id="login-card">
        <img src={icon} id="login-logo" alt="icon" />
        <h1 id="login-title">Song Swap</h1>
        <p id="login-subtitle">
          {authMode === 'login' ? 'Log in to your Song Swap account' : 'Create your free Song Swap account'}
        </p>
        {pendingInvite && <p id="invite-note">You've been invited to swap songs — sign up or log in and we'll send the friend request.</p>}
        {authMode === 'login'
          ? <LoginForm onLogin={loadMe} />
          : <RegisterForm onLogin={loadMe} />
        }
        <p id="auth-toggle">
          {authMode === 'login' ? (
            <>No account? <button className="link-btn" onClick={() => setAuthMode('register')}>Sign up</button></>
          ) : (
            <>Have an account? <button className="link-btn" onClick={() => setAuthMode('login')}>Log in</button></>
          )}
        </p>
        <button className="link-btn" id="back-to-home" onClick={() => setShowAuth(false)}>← Back to home</button>
        <p id="auth-legal">
          <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>
        </p>
      </div>
    </div>
  );

  return (
    <div id="screen">
      <header id="title-card">
        <button id="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
          <span className="bar" /><span className="bar" /><span className="bar" />
          {unreadFriendships.size > 0 && <span className="unread-badge">{unreadFriendships.size}</span>}
        </button>
        <img src={icon} id="logo" alt='icon' />
        <h1 id="main-title">
          {showSettings ? 'Settings' : activeFriendship ? activeFriendship.friend_name : 'Song Swap'}
        </h1>
        <div id="user-info">
          <span id="user-name">{user.name}</span>
          {user.is_admin && (
            <button id="admin-btn" onClick={() => setShowAdmin(v => !v)}>Admin</button>
          )}
          <button id="settings-btn" className={showSettings ? 'active' : ''} onClick={() => setShowSettings(v => !v)} aria-label={showSettings ? 'Close settings' : 'Settings'} aria-pressed={showSettings} title={showSettings ? 'Close settings' : 'Settings'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button id="logout-btn" onClick={logout}>Logout</button>
        </div>
      </header>

      <div id="app-body">
        {sidebarOpen && <div id="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <aside id="sidebar" className={sidebarOpen ? 'open' : 'closed'}>
          <div id="sidebar-inner">
            {/* Friend code */}
            <div className="sidebar-section">
              <p className="sidebar-label">Your Code</p>
              <div id="friend-code-row">
                <span id="friend-code-value">{user.friend_code}</span>
                <button className="copy-btn" onClick={copyCode}>{copied ? '✓' : 'Copy'}</button>
              </div>
              <button id="invite-link-btn" className="copy-btn" onClick={shareInvite}>
                {inviteCopied ? '✓ Invite link copied' : 'Share invite link'}
              </button>
            </div>

            {/* Add friend */}
            <div className="sidebar-section">
              <p className="sidebar-label">Add Friend</p>
              <div id="add-friend-row">
                <input
                  placeholder="Friend code"
                  value={addCodeInput}
                  onChange={e => { setAddCodeInput(e.target.value.toUpperCase()); setAddCodeError(''); setAddCodeSuccess(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') addFriend(); }}
                  maxLength={6}
                />
                <button onClick={addFriend}>Add</button>
              </div>
              {addCodeError && <p className="sidebar-feedback error">{addCodeError}</p>}
              {addCodeSuccess && <p className="sidebar-feedback success">{addCodeSuccess}</p>}
            </div>

            {/* Friend requests */}
            {friendRequests.length > 0 && (
              <div className="sidebar-section">
                <p className="sidebar-label">
                  Requests
                  <span className="request-badge">{friendRequests.length}</span>
                </p>
                {friendRequests.map(req => (
                  <div key={req.id} className="request-item">
                    <span className="request-name">{req.from_name}</span>
                    <div className="request-actions">
                      <button className="accept-btn" onClick={() => acceptRequest(req.id)}>✓</button>
                      <button className="decline-btn" onClick={() => declineRequest(req.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Sent requests (waiting on the other person) */}
            {sentRequests.length > 0 && (
              <div className="sidebar-section">
                <p className="sidebar-label">Sent</p>
                {sentRequests.map(req => (
                  <div key={req.id} className="request-item">
                    <span className="request-name">
                      {req.to_name}
                      <span className="request-waiting"> · waiting</span>
                    </span>
                    <div className="request-actions">
                      <button className="decline-btn" title="Cancel request" aria-label={`Cancel request to ${req.to_name}`} onClick={() => declineRequest(req.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Friends list */}
            <div className="sidebar-section sidebar-friends">
              <p className="sidebar-label">Friends</p>
              {friends.length === 0 ? (
                <p className="empty-msg">No friends yet</p>
              ) : (
                friends.map(f => (
                  <div
                    key={f.friendship_id}
                    className={`friend-item${activeFriendship?.friendship_id === f.friendship_id ? ' active' : ''}`}
                    onClick={() => selectFriend(f)}
                  >
                    <div className="friend-avatar">{f.friend_name[0].toUpperCase()}</div>
                    <span className="friend-name">{f.friend_name}</span>
                    {unreadFriendships.has(f.friendship_id) && <span className="unread-dot" />}
                  </div>
                ))
              )}
            </div>
          </div>
          <div id="sidebar-footer">
            <a href="https://ko-fi.com/mguaste" target="_blank" rel="noreferrer" id="kofi-link">Support on Ko-fi</a>
          </div>
        </aside>

        <main id="main-content">
          {showSettings ? (
            <div id="settings-page">
              <button className="link-btn" id="settings-back" onClick={() => setShowSettings(false)}>← Back</button>
              <div className="settings-section">
                <h2 className="settings-section-title">Account</h2>
                <div className="settings-row">
                  <label className="settings-label">Change Password</label>
                  <div className="settings-password-form">
                    <input
                      type="password"
                      placeholder="Current password"
                      value={settingsPwCurrent}
                      onChange={e => { setSettingsPwCurrent(e.target.value); setSettingsPwError(''); setSettingsPwSuccess(''); }}
                    />
                    <input
                      type="password"
                      placeholder="New password"
                      value={settingsPwNew}
                      onChange={e => { setSettingsPwNew(e.target.value); setSettingsPwError(''); setSettingsPwSuccess(''); }}
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={settingsPwConfirm}
                      onChange={e => { setSettingsPwConfirm(e.target.value); setSettingsPwError(''); setSettingsPwSuccess(''); }}
                    />
                    {settingsPwError && <p className="settings-feedback error">{settingsPwError}</p>}
                    {settingsPwSuccess && <p className="settings-feedback success">{settingsPwSuccess}</p>}
                    <button className="settings-save-btn" onClick={async () => {
                      if (settingsPwNew !== settingsPwConfirm) { setSettingsPwError('New passwords do not match'); return; }
                      const r = await fetch('/api/me/password', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ currentPassword: settingsPwCurrent, newPassword: settingsPwNew }),
                      });
                      const d = await r.json();
                      if (r.ok) {
                        setSettingsPwSuccess('Password updated');
                        setSettingsPwCurrent(''); setSettingsPwNew(''); setSettingsPwConfirm('');
                      } else {
                        setSettingsPwError(d.error || 'Failed to update password');
                      }
                    }}>Save Password</button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h2 className="settings-section-title">Music</h2>
                <div className="settings-row">
                  <label className="settings-label">Open Songs In</label>
                  <select
                    className="platform-select"
                    value={preferredPlatform}
                    onChange={(e) => {
                      const p = e.target.value;
                      setPreferredPlatform(p);
                      fetch('/api/me/preferred-platform', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ platform: p }),
                      });
                    }}
                  >
                    <option value="spotify">Spotify</option>
                    <option value="appleMusic">Apple Music</option>
                    <option value="youtubeMusic">YouTube Music</option>
                    <option value="amazonMusic">Amazon Music</option>
                    <option value="tidal">Tidal</option>
                    <option value="deezer">Deezer</option>
                  </select>
                </div>
              </div>

              {user.is_admin && (
                <div className="settings-section">
                  <h2 className="settings-section-title">Admin</h2>
                  <div className="settings-row">
                    <label className="settings-label">History</label>
                    <button className="settings-danger-btn" onClick={() => fetch('/api/admin/history', { method: 'DELETE', credentials: 'include' })}>Clear All History</button>
                  </div>
                  <div className="settings-row">
                    <label className="settings-label">Current Songs</label>
                    <button className="settings-danger-btn" onClick={() => fetch('/api/admin/current-song', { method: 'DELETE', credentials: 'include' })}>Clear Current Songs</button>
                  </div>
                </div>
              )}
            </div>
          ) : !activeFriendship && friends.length === 0 ? (
            <div id="empty-state" className="onboarding">
              <img src={icon} id="empty-logo" alt="icon" />
              <h2 id="onboarding-title">Swap songs with a friend</h2>
              <ol id="onboarding-steps">
                <li><span className="step-title">Share your link</span><span className="step-sub">Send it to a friend</span></li>
                <li><span className="step-title">They sign up</span><span className="step-sub">Then you accept</span></li>
                <li><span className="step-title">Swap a song</span><span className="step-sub">From any music app</span></li>
              </ol>
              <button id="onboarding-invite-btn" onClick={shareInvite}>
                {inviteCopied ? '✓ Invite link copied' : 'Share invite link'}
              </button>
              <p id="onboarding-code">
                or give them your code <span>{user.friend_code}</span>
              </p>
              {sentRequests.length > 0 && (
                <p id="onboarding-waiting">
                  Waiting on {sentRequests.map(r => r.to_name).join(', ')} to accept
                </p>
              )}
              {friendRequests.length > 0 && (
                <button className="link-btn" onClick={() => setSidebarOpen(true)}>
                  You have {friendRequests.length} friend request{friendRequests.length > 1 ? 's' : ''} — open sidebar
                </button>
              )}
            </div>
          ) : !activeFriendship ? (
            <div id="empty-state">
              <img src={icon} id="empty-logo" alt="icon" />
              <p>Select a friend to start swapping songs</p>
            </div>
          ) : (

            <>
              <div id="song-swap-main">
                <div className="song-cont">
                  <h2 className="song-cont-title">Send</h2>
                  <div className="song-info" onClick={() => openSong(songDetails)} style={songDetails ? {cursor: 'pointer'} : {}}>
                    <div className={`send-art-wrapper${sent ? ' sending' : ''}${denied ? ' denied' : ''}`}>
                      <div className="send-art-inner">
                        {songDetails
                          ? <img className="album-art" src={songDetails.albumArt} alt="Album Art" />
                          : <AlbumArtPlaceholder />
                        }
                      </div>
                      <div className="send-art-check">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40%" height="40%">
                          <polyline points="4 12 9 17 20 6" />
                        </svg>
                      </div>
                      <div className="send-art-deny">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40%" height="40%">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </div>
                    </div>
                    <h3>{songDetails ? songDetails.title : 'Song Title'}</h3>
                    <p>Artist: {songDetails ? songDetails.artist : 'Artist Name'}</p>
                    <p>Album: {songDetails ? songDetails.album : 'Album Name'}</p>
                    {songDetails?.id && (
                      <p className="card-rating">
                        {songDetails.rating
                          ? <>{activeFriendship.friend_name} rated it <StarRating value={songDetails.rating} /></>
                          : <span className="rating-pending">Not rated yet</span>}
                      </p>
                    )}
                  </div>
                  <div className="input-group">
                    <input
                      placeholder="Paste a music link..."
                      value={songLink}
                      onChange={(e) => { verifyReqRef.current++; setVerifying(false); setSongLink(e.target.value); setSongDetails(null); setDuplicate(null); setVerifyError(''); }}
                      onPaste={(e) => {
                        // Look the song up as soon as a link is pasted into an empty box
                        const text = e.clipboardData.getData('text').trim();
                        if (songLink.trim() || !/^(https?:\/\/|spotify:)/i.test(text)) return;
                        e.preventDefault();
                        setSongLink(text); setDuplicate(null);
                        verifySong(text);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !verifying) songDetails ? sendSong() : verifySong(); }}
                    />
                    <button onClick={songDetails ? sendSong : verifySong} disabled={sent || denied || verifying}>
                      {verifying ? 'Checking…' : songDetails ? 'Send' : 'Verify'}
                    </button>
                  </div>
                  {verifyError && <p id="duplicate-warning">{verifyError}</p>}
                  {duplicate && (
                    <p id="duplicate-warning">
                      Already sent on {new Date(duplicate.sentAt).toLocaleDateString()} by {duplicate.sentBy}
                    </p>
                  )}
                </div>

                <div className="song-cont">
                  <h2 className="song-cont-title">Receive</h2>
                  <div className="song-info" onClick={() => openSong(receivedSong)} style={receivedSong ? {cursor: 'pointer'} : {}}>
                    {receivedSong
                      ? <img className="album-art" src={receivedSong.albumArt} alt="Album Art" />
                      : <AlbumArtPlaceholder />
                    }
                    <h3>{receivedSong ? receivedSong.title : 'Song Title'}</h3>
                    <p>Artist: {receivedSong ? receivedSong.artist : 'Artist Name'}</p>
                    <p>Album: {receivedSong ? receivedSong.album : 'Album Name'}</p>
                    {receivedSong?.id && (
                      <div className="card-rating">
                        <StarRating value={receivedSong.rating} onRate={n => rateSong(receivedSong, n)} className="large" />
                        <span className="rating-pending">{receivedSong.rating ? 'Your rating' : 'Rate this song'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {history.length > 0 && (
                <div id="history">
                  <h2 id="history-title">History</h2>
                  <div id="history-list">
                    {history.map((entry, i) => (
                      <div key={entry.id ?? i} className="history-entry" onClick={() => openSong(entry)}>
                        <span className="history-index">{history.length - i}</span>
                        <img src={entry.albumArt} alt="art" className="history-art" />
                        <div className="history-info">
                          <span className="history-song">{entry.title}</span>
                          <span className="history-meta">{entry.artist} · {entry.sentBy} · {new Date(entry.sentAt).toLocaleDateString()}</span>
                        </div>
                        {entry.id && (entry.sentBy === user.name
                          ? <StarRating value={entry.rating} className="history-stars" />
                          : <StarRating value={entry.rating} onRate={n => rateSong(entry, n)} className="history-stars" />)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div id="remove-friend-row">
                <button id="remove-friend-btn" onClick={removeFriend}>Remove {activeFriendship.friend_name}</button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
