import './App.css'
import { useState, useEffect } from 'react';
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

    if (res.ok) {
      onLogin(await res.json());
    } else {
      setError('Wrong password');
    }
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Enter</button>
    </form>
  );
}

function App() {
  const [user, setUser] = useState(undefined);
  const [spotifyLink, setSpotifyLink] = useState('');
  const [sent, setSent] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [songDetails, setSongDetials] = useState(null);
  const [receivedSong, setReceivedSong] = useState(null);
  const [history, setHistory] = useState([]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setUser(data);
        if (data) {
          const saved = localStorage.getItem(`lastSentSong_${data.name}`);
          if (saved) setSongDetials(JSON.parse(saved));
        }
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch('/api/history', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setHistory(data.slice().reverse()));
    if (user.name === 'Mguaste') {
      fetch('/api/spotify-status', { credentials: 'include' })
        .then(r => r.json())
        .then(data => setSpotifyConnected(data.connected));
    }
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => setReceivedSong(song));
    socket.on('song-cleared', () => { setReceivedSong(null); setSongDetials(null); });
    socket.on('duplicate-song', (entry) => setDuplicate(entry));
    socket.on('history-updated', (entry) => setHistory(prev => [entry, ...prev]));
    socket.on('history-cleared', () => setHistory([]));
    return () => {
      socket.off('song-received');
      socket.off('song-cleared');
      socket.off('duplicate-song');
      socket.off('history-updated');
      socket.off('history-cleared');
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const key = `lastSentSong_${user.name}`;
    if (songDetails) localStorage.setItem(key, JSON.stringify(songDetails));
    else localStorage.removeItem(key);
  }, [songDetails, user]);

  const verifySong = async () => {
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link: spotifyLink }),
      });
      const data = await response.json();
      setSongDetials(data);
    } catch (error) {
      console.error('Error verifying song:', error);
    }
  };

  const sendSong = () => {
    if (!songDetails) return;
    setDuplicate(null);
    socket.emit('send-song', { song: songDetails, sentBy: user.name });
    setSent(true);
    setTimeout(() => setSent(false), 1500);
  };

  const clearHistory = async () => {
    await fetch('/api/admin/history', { method: 'DELETE', credentials: 'include' });
    setHistory([]);
  };

  const clearCurrentSong = async () => {
    await fetch('/api/admin/current-song', { method: 'DELETE', credentials: 'include' });
  };

  const openInSpotify = (song) => {
    if (!song) return;
    window.location.href = song.spotifyUri;
    setTimeout(() => { window.open(song.spotifyUrl, '_blank'); }, 1000);
  };
  

  if (user === undefined) return null;

  if (!user) return (
    <div id="login-page">
      <div id="login-card">
        <img src={icon} id="login-logo" alt="icon" />
        <h1 id="login-title">Song Swap</h1>
        <p id="login-subtitle">Community in Music</p>
        <LoginForm onLogin={setUser} />
      </div>
    </div>
  );

  return (
    <div id="screen">
      <header id="title-card">
        <img src={icon} id="logo" alt='icon'></img>
        <h1 id="main-title">Song Swap</h1>
        <div id="user-info">
          {user.avatar && <img src={user.avatar} id="user-avatar" alt="avatar" />}
          <span id="user-name">{user.name}</span>
          {user.name === 'Mguaste' && (
            <button id="admin-btn" onClick={() => setShowAdmin(v => !v)}>Admin</button>
          )}
          <button id="logout-btn" onClick={() => fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => setUser(null))}>Logout</button>
        </div>
      </header>
      <main id="main-body">
        <div id="song-swap-main">
          {/*Send Section*/}
          <div className="song-cont">
            <h2 className="song-cont-title">Send</h2>
              <div className="song-info" onClick={() => openInSpotify(songDetails)} style={songDetails ? {cursor: 'pointer'} : {}}>
                <div className={`send-art-wrapper${sent ? ' sending' : ''}`}>
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
                </div>
                <h3>{songDetails ? songDetails.title : 'Song Title'}</h3>
                <p>Artist: {songDetails ? songDetails.artist : 'Artist Name'}</p>
                <p>Album: {songDetails ? songDetails.album: 'Album Name'}</p>
              </div>
            <div className="input-group">
              <input
                placeholder="Paste Spotify Link"
                value={spotifyLink}
                onChange={(e) => { setSpotifyLink(e.target.value); setSongDetials(null); setDuplicate(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') songDetails ? sendSong() : verifySong(); }}
              />
              <button onClick={songDetails ? sendSong : verifySong} disabled={sent}>
                {songDetails ? 'Send' : 'Verify'}
              </button>
            </div>
            {duplicate && (
              <p id="duplicate-warning">
                Already sent on {new Date(duplicate.sentAt).toLocaleDateString()} by {duplicate.sentBy}
              </p>
            )}
          </div>

          {/*Recieve Section*/}
          <div className="song-cont">
            <h2 className="song-cont-title">Recieve</h2>
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
        {showAdmin && (
          <div id="admin-panel">
            <h2 id="admin-title">Admin</h2>
            <button id="clear-history-btn" onClick={clearHistory}>Clear All History</button>
            <button id="clear-song-btn" onClick={clearCurrentSong}>Clear Current Song</button>
            <a href="/api/spotify-auth">
              <button id="spotify-connect-btn">
                {spotifyConnected ? 'Spotify Connected ✓' : 'Connect Spotify'}
              </button>
            </a>
          </div>
        )}

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
      </main>
    </div>
  )
}
export default App
