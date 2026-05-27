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
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password }),
    });
    if (res.ok) onLogin();
    else setError((await res.json()).error || 'Registration failed');
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <input type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Sign Up</button>
    </form>
  );
}

function App() {
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState('login');
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
  const [spotifyLink, setSpotifyLink] = useState('');
  const [sent, setSent] = useState(false);
  const [denied, setDenied] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [songDetails, setSongDetails] = useState(null);
  const [receivedSong, setReceivedSong] = useState(null);
  const [history, setHistory] = useState([]);

  // Admin
  const [showAdmin, setShowAdmin] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  const loadMe = async () => {
    const r = await fetch('/api/me', { credentials: 'include' });
    setUser(r.ok ? await r.json() : null);
  };

  const loadFriends = async () => {
    const r = await fetch('/api/friends', { credentials: 'include' });
    if (r.ok) setFriends(await r.json());
  };

  const loadRequests = async () => {
    const r = await fetch('/api/friends/requests', { credentials: 'include' });
    if (r.ok) setFriendRequests(await r.json());
  };

  useEffect(() => { loadMe(); }, []);

  useEffect(() => {
    if (!user) return;
    loadFriends();
    loadRequests();
    if (user.name === 'Mguaste') {
      fetch('/api/spotify-status', { credentials: 'include' })
        .then(r => r.json())
        .then(data => setSpotifyConnected(data.connected));
    }
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => {
      if (song.friendshipId === activeFriendshipRef.current?.friendship_id) setReceivedSong(song);
    });
    socket.on('song-cleared', () => setReceivedSong(null));
    socket.on('all-songs-cleared', () => { setReceivedSong(null); setSongDetails(null); });
    socket.on('send-success', () => { setSent(true); setTimeout(() => setSent(false), 1500); });
    socket.on('duplicate-song', (entry) => { setDuplicate(entry); setDenied(true); setTimeout(() => setDenied(false), 1500); });
    socket.on('history-updated', (entry) => {
      if (entry.friendshipId === activeFriendshipRef.current?.friendship_id) setHistory(prev => [entry, ...prev]);
    });
    socket.on('history-cleared', () => setHistory([]));
    return () => {
      socket.off('song-received');
      socket.off('song-cleared');
      socket.off('all-songs-cleared');
      socket.off('send-success');
      socket.off('duplicate-song');
      socket.off('history-updated');
      socket.off('history-cleared');
    };
  }, []);

  const selectFriend = async (friendship) => {
    setActiveFriendship(friendship);
    activeFriendshipRef.current = friendship;
    setSpotifyLink('');
    setSongDetails(null);
    setDuplicate(null);
    setReceivedSong(null);
    setHistory([]);
    socket.emit('join-friendship', friendship.friendship_id);
    const [histRes, curRes] = await Promise.all([
      fetch(`/api/friends/${friendship.friendship_id}/history`, { credentials: 'include' }),
      fetch(`/api/friends/${friendship.friendship_id}/current-song`, { credentials: 'include' }),
    ]);
    if (histRes.ok) setHistory((await histRes.json()).slice().reverse());
    if (curRes.ok) {
      const song = await curRes.json();
      if (song && song.sentBy !== user.name) setReceivedSong(song);
    }
  };

  const verifySong = async () => {
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link: spotifyLink }),
      });
      setSongDetails(await res.json());
    } catch (err) {
      console.error('Error verifying song:', err);
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

  const openInSpotify = (song) => {
    if (!song) return;
    window.location.href = song.spotifyUri;
    setTimeout(() => { window.open(song.spotifyUrl, '_blank'); }, 1000);
  };

  const logout = () => fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {
    setUser(null);
    setActiveFriendship(null);
  });

  if (user === undefined) return null;

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
      </div>
    </div>
  );

  return (
    <div id="screen">
      <header id="title-card">
        <button id="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
          <span /><span /><span />
        </button>
        <img src={icon} id="logo" alt='icon' />
        <h1 id="main-title">
          {activeFriendship ? activeFriendship.friend_name : 'Song Swap'}
        </h1>
        <div id="user-info">
          <span id="user-name">{user.name}</span>
          {user.name === 'Mguaste' && (
            <button id="admin-btn" onClick={() => setShowAdmin(v => !v)}>Admin</button>
          )}
          <button id="logout-btn" onClick={logout}>Logout</button>
        </div>
      </header>

      <div id="app-body">
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
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <main id="main-content">
          {!activeFriendship ? (
            <div id="empty-state">
              <img src={icon} id="empty-logo" alt="icon" />
              <p>Select a friend to start swapping songs</p>
            </div>
          ) : (
            <>
              <div id="song-swap-main">
                <div className="song-cont">
                  <h2 className="song-cont-title">Send</h2>
                  <div className="song-info" onClick={() => openInSpotify(songDetails)} style={songDetails ? {cursor: 'pointer'} : {}}>
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
                      placeholder="Paste Spotify Link"
                      value={spotifyLink}
                      onChange={(e) => { setSpotifyLink(e.target.value); setSongDetails(null); setDuplicate(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') songDetails ? sendSong() : verifySong(); }}
                    />
                    <button onClick={songDetails ? sendSong : verifySong} disabled={sent || denied}>
                      {songDetails ? 'Send' : 'Verify'}
                    </button>
                  </div>
                  {duplicate && (
                    <p id="duplicate-warning">
                      Already sent on {new Date(duplicate.sentAt).toLocaleDateString()} by {duplicate.sentBy}
                    </p>
                  )}
                </div>

                <div className="song-cont">
                  <h2 className="song-cont-title">Receive</h2>
                  <div className="song-info" onClick={() => openInSpotify(receivedSong)} style={receivedSong ? {cursor: 'pointer'} : {}}>
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
                      <div key={i} className="history-entry" onClick={() => openInSpotify(entry)}>
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

              {showAdmin && (
                <div id="admin-panel">
                  <h2 id="admin-title">Admin</h2>
                  <button onClick={() => fetch('/api/admin/history', { method: 'DELETE', credentials: 'include' })}>Clear All History</button>
                  <button onClick={() => fetch('/api/admin/current-song', { method: 'DELETE', credentials: 'include' })}>Clear Current Songs</button>
                  <a href="/api/spotify-auth">
                    <button id="spotify-connect-btn">{spotifyConnected ? 'Spotify Connected ✓' : 'Connect Spotify'}</button>
                  </a>
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
