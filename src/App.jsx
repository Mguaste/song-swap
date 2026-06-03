import './App.css'
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import icon from './assets/SSLogo.png'

const socket = io();

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
      <select value={preferredPlatform} onChange={e => setPreferredPlatform(e.target.value)} className="register-platform-select">
        <option value="spotify">Spotify</option>
        <option value="appleMusic">Apple Music</option>
        <option value="youtubeMusic">YouTube Music</option>
        <option value="amazonMusic">Amazon Music</option>
        <option value="tidal">Tidal</option>
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
    body: 'Spotify, Apple Music, YouTube Music, Amazon Music, Tidal — paste any link and it opens in the app you prefer.',
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
        <h1>Share the songs you love<br />with the people you love.</h1>
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
                <svg viewBox="0 0 24 24" fill="none" stroke="#1DB954" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
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
        <span>Song Swap</span>
        <a href="https://ko-fi.com/mguaste" target="_blank" rel="noreferrer">Support on Ko-fi</a>
      </footer>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState('login');
  const [showAuth, setShowAuth] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Friends
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [activeFriendship, setActiveFriendship] = useState(null);
  const activeFriendshipRef = useRef(null);
  const [addCodeInput, setAddCodeInput] = useState('');
  const [addCodeError, setAddCodeError] = useState('');
  const [addCodeSuccess, setAddCodeSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  // Swap lane
  const [songLink, setSongLink] = useState('');
  const [sent, setSent] = useState(false);
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

  const loadRequests = async () => {
    const r = await fetch('/api/friends/requests', { credentials: 'include' });
    if (r.ok) setFriendRequests(await r.json());
  };

  const loadUnreadStatus = async (currentUser) => {
    const r = await fetch('/api/friends/latest-activity', { credentials: 'include' });
    if (!r.ok) return;
    const activities = await r.json();
    const key = `ss_last_viewed_${currentUser.name}`;
    const lastViewed = JSON.parse(localStorage.getItem(key) || '{}');
    const unread = new Set();
    for (const { friendshipId, sentAt } of activities) {
      const lv = lastViewed[friendshipId];
      if (!lv || new Date(sentAt) > new Date(lv)) unread.add(friendshipId);
    }
    setUnreadFriendships(unread);
  };

  useEffect(() => { loadMe(); }, []);

  useEffect(() => {
    userRef.current = user;
    if (!user) return;
    loadFriends();
    loadRequests();
    loadUnreadStatus(user);
    socket.emit('join-user', user.name);
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => {
      if (song.friendshipId === activeFriendshipRef.current?.friendship_id) setReceivedSong(song);
    });
    socket.on('song-cleared', () => setReceivedSong(null));
    socket.on('all-songs-cleared', () => { setReceivedSong(null); setSongDetails(null); });
    socket.on('send-success', () => { setSent(true); setTimeout(() => { setSent(false); setSongLink(''); }, 1500); });
    socket.on('duplicate-song', (entry) => { setDuplicate(entry); setDenied(true); setTimeout(() => setDenied(false), 1500); });
    socket.on('history-updated', (entry) => {
      if (entry.friendshipId === activeFriendshipRef.current?.friendship_id) {
        setHistory(prev => [entry, ...prev]);
      } else if (entry.sentBy !== userRef.current?.name) {
        setUnreadFriendships(prev => new Set([...prev, entry.friendshipId]));
      }
    });
    socket.on('history-cleared', () => setHistory([]));
    socket.on('friend-request-received', () => loadRequests());
    socket.on('friendship-accepted', () => { loadFriends(); loadRequests(); });
    socket.on('friend-request-declined', () => loadRequests());
    return () => {
      socket.off('song-received');
      socket.off('song-cleared');
      socket.off('all-songs-cleared');
      socket.off('send-success');
      socket.off('duplicate-song');
      socket.off('history-updated');
      socket.off('history-cleared');
      socket.off('friend-request-received');
      socket.off('friendship-accepted');
      socket.off('friend-request-declined');
    };
  }, []);

  const selectFriend = async (friendship) => {
    const freshFriends = await loadFriends();
    const fresh = freshFriends.find(f => f.friendship_id === friendship.friendship_id) ?? friendship;
    setActiveFriendship(fresh);
    activeFriendshipRef.current = fresh;
    if (window.innerWidth <= 700) setSidebarOpen(false);
    setSongLink('');
    setSongDetails(null);
    setVerifyError('');
    setDuplicate(null);
    setReceivedSong(null);
    setHistory([]);
    // Mark as read
    setUnreadFriendships(prev => { const next = new Set(prev); next.delete(friendship.friendship_id); return next; });
    const lvKey = `ss_last_viewed_${userRef.current?.name}`;
    const lv = JSON.parse(localStorage.getItem(lvKey) || '{}');
    lv[friendship.friendship_id] = new Date().toISOString();
    localStorage.setItem(lvKey, JSON.stringify(lv));

    socket.emit('join-friendship', friendship.friendship_id);
    const [histRes, curRes, myRes] = await Promise.all([
      fetch(`/api/friends/${friendship.friendship_id}/history`, { credentials: 'include' }),
      fetch(`/api/friends/${friendship.friendship_id}/current-song`, { credentials: 'include' }),
      fetch(`/api/friends/${friendship.friendship_id}/my-song`, { credentials: 'include' }),
    ]);
    if (histRes.ok) setHistory(await histRes.json());
    if (curRes.ok) {
      const song = await curRes.json();
      if (song && song.sentBy !== user.name) setReceivedSong(song);
    }
    if (myRes.ok) {
      const mySong = await myRes.json();
      if (mySong) setSongDetails(mySong);
    }
  };

  const PLATFORM_PRIORITY = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal'];

  const buildSearchUrl = (platform, title, artist) => {
    const q = encodeURIComponent(`${title} ${artist}`);
    switch (platform) {
      case 'spotify':       return `https://open.spotify.com/search/${q}`;
      case 'appleMusic':    return `https://music.apple.com/search?term=${q}`;
      case 'youtubeMusic':  return `https://music.youtube.com/search?q=${q}`;
      case 'tidal':         return `https://listen.tidal.com/search?q=${q}`;
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
    // Legacy song (no platformLinks) — resolve via odesli if user prefers non-Spotify
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

  const verifySong = async () => {
    setVerifyError('');
    setSongDetails(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link: songLink }),
      });
      const data = await res.json();
      if (!res.ok) { setVerifyError(data.error || 'Could not find that song'); return; }
      setSongDetails(data);
    } catch {
      setVerifyError('Network error — check your connection');
    }
  };

  const sendSong = () => {
    if (!songDetails || !activeFriendship) return;
    setDuplicate(null);
    socket.emit('send-song', { song: songDetails, sentBy: user.name, friendshipId: activeFriendship.friendship_id });
  };

  const addFriend = async () => {
    setAddCodeError('');
    setAddCodeSuccess('');
    const r = await fetch('/api/friends/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ friendCode: addCodeInput }),
    });
    const data = await r.json();
    if (r.ok) { setAddCodeSuccess(data.message); setAddCodeInput(''); }
    else setAddCodeError(data.error);
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
        <p id="login-subtitle">Community in Music</p>
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
      </div>
    </div>
  );

  return (
    <div id="screen">
      <header id="title-card">
        <button id="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
          <span /><span /><span />
          {unreadFriendships.size > 0 && <span className="unread-badge">{unreadFriendships.size}</span>}
        </button>
        <img src={icon} id="logo" alt='icon' />
        <h1 id="main-title">
          {showSettings ? 'Settings' : activeFriendship ? activeFriendship.friend_name : 'Song Swap'}
        </h1>
        <div id="user-info">
          <span id="user-name">{user.name}</span>
          {user.name === 'Mguaste' && (
            <button id="admin-btn" onClick={() => setShowAdmin(v => !v)}>Admin</button>
          )}
          <button id="settings-btn" onClick={() => setShowSettings(v => !v)} aria-label="Settings">
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
                  </select>
                </div>
              </div>

              {user.name === 'Mguaste' && (
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
                  </div>
                  <div className="input-group">
                    <input
                      placeholder="Paste a music link..."
                      value={songLink}
                      onChange={(e) => { setSongLink(e.target.value); setSongDetails(null); setDuplicate(null); setVerifyError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') songDetails ? sendSong() : verifySong(); }}
                    />
                    <button onClick={songDetails ? sendSong : verifySong} disabled={sent || denied}>
                      {songDetails ? 'Send' : 'Verify'}
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
                  </div>
                </div>
              </div>

              {history.length > 0 && (
                <div id="history">
                  <h2 id="history-title">History</h2>
                  <div id="history-list">
                    {history.map((entry, i) => (
                      <div key={i} className="history-entry" onClick={() => openSong(entry)}>
                        <span className="history-index">{history.length - i}</span>
                        <img src={entry.albumArt} alt="art" className="history-art" />
                        <div className="history-info">
                          <span className="history-song">{entry.title}</span>
                          <span className="history-meta">{entry.artist} · {entry.sentBy} · {new Date(entry.sentAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
