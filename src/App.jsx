import './App.css'
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import icon from './assets/SSLogo.png'

const socket = io();

const BASE_TITLE = document.title;

// After a deploy, tabs that were already open keep running the old code until
// reloaded. The server sends its build id on every socket connect; if it's not
// the bundle this tab loaded, reload — right away if nothing is typed into the
// song box, otherwise as soon as the tab is hidden.
const LOADED_BUILD = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src') ?? null;
let reloadPending = false;
socket.on('build-id', (serverBuild) => {
  if (!LOADED_BUILD || !serverBuild || serverBuild === LOADED_BUILD || reloadPending) return;
  reloadPending = true;
  const typing = document.querySelector('input:focus, textarea:focus') || [...document.querySelectorAll('input')].some(i => i.type !== 'password' && i.value);
  if (document.visibilityState === 'hidden' || !typing) { window.location.reload(); return; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window.location.reload();
  });
});
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

// Profile picture, or the first letter of the name when there isn't one
function Avatar({ userId, avatarAt, name, className = '' }) {
  const [failedFor, setFailedFor] = useState(null);
  if (userId && avatarAt && failedFor !== avatarAt) {
    return <img className={`friend-avatar avatar-img ${className}`} alt=""
      src={`/api/avatars/${userId}?v=${encodeURIComponent(avatarAt)}`} onError={() => setFailedFor(avatarAt)} />;
  }
  return <span className={`friend-avatar ${className}`}>{(name?.[0] ?? '?').toUpperCase()}</span>;
}

// Center-crop to a square and shrink, so uploads stay small (~20–40 KB)
const resizeImage = (file, size = 256) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a2a2a'; // behind transparent PNGs
    ctx.fillRect(0, 0, size, size);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image")); };
  img.src = url;
});

// Settings → Profile: picture and username
function ProfileSettings({ user, onChanged }) {
  const [picError, setPicError] = useState('');
  const [picBusy, setPicBusy] = useState(false);
  const [name, setName] = useState(user.name);
  const [nameMsg, setNameMsg] = useState(null); // { error|success: text }
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setPicError(''); setPicBusy(true);
    try {
      const blob = await resizeImage(file);
      const r = await fetch('/api/me/avatar', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      onChanged();
    } catch (e) { setPicError(e.message || 'Upload failed'); }
    finally { setPicBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const removePic = async () => {
    await fetch('/api/me/avatar', { method: 'DELETE', credentials: 'include' });
    onChanged();
  };
  const rename = async () => {
    setNameMsg(null);
    const r = await fetch('/api/me/name', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setNameMsg({ success: `Username changed — log in as ${d.name} from now on` }); onChanged(); }
    else setNameMsg({ error: d.error || 'Could not change username' });
  };

  return (
    <>
      <div className="settings-row">
        <label className="settings-label">Profile Picture</label>
        <div className="profile-pic-row">
          <Avatar userId={user.id} avatarAt={user.avatar_at} name={user.name} className="avatar-lg" />
          <div className="profile-pic-actions">
            <button className="settings-save-btn" disabled={picBusy} onClick={() => fileRef.current?.click()}>
              {picBusy ? 'Uploading…' : user.avatar_at ? 'Change Photo' : 'Add Photo'}
            </button>
            {user.avatar_at && !picBusy && <button className="link-btn" onClick={removePic}>Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])} />
        </div>
      </div>
      {picError && <p className="settings-feedback error">{picError}</p>}
      <div className="settings-row">
        <label className="settings-label">Username</label>
        <div className="settings-password-form">
          <input value={name} maxLength={30} autoCapitalize="off" autoCorrect="off"
            onChange={e => { setName(e.target.value); setNameMsg(null); }}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim() && name.trim() !== user.name) rename(); }} />
          <button className="settings-save-btn" disabled={!name.trim() || name.trim() === user.name} onClick={rename}>Change Username</button>
          {nameMsg?.error && <p className="settings-feedback error">{nameMsg.error}</p>}
          {nameMsg?.success && <p className="settings-feedback success">{nameMsg.success}</p>}
          <p className="settings-hint">You can change it once every 7 days. Friends see the new name right away.</p>
        </div>
      </div>
    </>
  );
}

const timeAgo = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const untilText = (iso) => {
  const mins = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Small ring showing how many friends you've sent a song to today
function ProgressRing({ done, total }) {
  const r = 20, c = 2 * Math.PI * r, frac = total ? done / total : 0;
  return (
    <svg className="dash-ring" viewBox="0 0 48 48" aria-label={`${done} of ${total} friends sent to today`}>
      <circle cx="24" cy="24" r={r} className="dash-ring-track" />
      <circle cx="24" cy="24" r={r} className="dash-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      <text x="24" y="28" textAnchor="middle">{done}/{total}</text>
    </svg>
  );
}

const SmallArt = ({ song }) => (song?.albumArt ? <img src={song.albumArt} alt="" className="dash-art-sm" /> : <span className="dash-art-sm placeholder" />);

// Home screen when no swap is open. Refetches whenever refreshKey changes.
function Dashboard({ user, friends, friendCount, friendRequests, sentRequests, refreshKey, onOpenFriend, onOpenSong,
  onAccept, onDecline, onInvite, inviteCopied, pendingShare, onCancelShare }) {
  const [data, setData] = useState(null);
  const [localTick, setLocalTick] = useState(0);
  const [, setNow] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey, localTick]);
  // Keep the countdown and "x ago" times fresh
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const rate = async (song, rating) => {
    setData(d => ({ ...d, unrated: d.unrated.map(s => (s.id === song.id ? { ...s, rating } : s)) }));
    await fetch(`/api/songs/${song.id}/rating`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }).catch(() => {});
    setTimeout(() => setLocalTick(t => t + 1), 900); // let the stars show, then refresh lists
  };

  const friendOf = (friendshipId) => friends.find(x => x.friendship_id === friendshipId);
  const friendAvatar = (friendshipId, name) => {
    const fr = friendOf(friendshipId);
    return <Avatar userId={fr?.friend_id} avatarAt={fr?.friend_avatar_at} name={name} />;
  };

  const newForYou = data?.newForYou ?? [];
  const today = data?.today ?? [];
  // Songs already under "New for you" get rated after opening; don't list them twice
  const unrated = (data?.unrated ?? []).filter(s => !newForYou.some(n => n.id === s.id));
  const recent = data?.recent ?? [];
  const loved = data?.loved ?? [];
  const stats = data?.stats;
  const sentToday = today.filter(t => t.mine).length;
  // Friends you still owe a song first
  const todaySorted = [...today].sort((a, b) => (!!a.mine - !!b.mine) || (!!b.theirs - !!a.theirs));

  return (
    <div id="dashboard">
      <header className="dash-hero">
        <Avatar userId={user.id} avatarAt={user.avatar_at} name={user.name} className="avatar-lg" />
        <div className="dash-hero-text">
          <h2 className="dash-greeting">{greeting()}, {user.name}</h2>
          {today.length > 0 && (
            <p className="dash-hero-sub">
              {sentToday === today.length
                ? "You've sent everyone a song today 🎉"
                : `You've sent to ${sentToday} of ${today.length} friend${today.length > 1 ? 's' : ''} today`}
            </p>
          )}
          {data?.resetAt && <p className="dash-hero-reset">New day of swaps in {untilText(data.resetAt)}</p>}
        </div>
        {today.length > 0 && <ProgressRing done={sentToday} total={today.length} />}
      </header>

      {pendingShare && (
        <div className="dash-card dash-share">
          <p>Pick a friend to send the song you shared</p>
          <button className="link-btn" onClick={onCancelShare}>Cancel</button>
        </div>
      )}

      {newForYou.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">New for you</h2>
          {newForYou.map(s => (
            <button key={s.id} className="dash-card dash-song" onClick={() => onOpenFriend(s.friendshipId)}>
              {s.albumArt ? <img src={s.albumArt} alt="" className="dash-art" /> : <div className="dash-art placeholder" />}
              <span className="dash-song-text">
                <span className="dash-song-title">{s.title}</span>
                <span className="dash-song-sub">{s.artist}</span>
                <span className="dash-song-meta">from {s.friendName} · {timeAgo(s.sentAt)}</span>
              </span>
              <span className="dash-chevron">›</span>
            </button>
          ))}
        </section>
      )}

      {today.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">Today</h2>
          <div className="dash-card dash-today">
            {todaySorted.map(t => (
              <button key={t.friendshipId} className="dash-today-row" onClick={() => onOpenFriend(t.friendshipId)}>
                {friendAvatar(t.friendshipId, t.friendName)}
                <span className="dash-today-name">{t.friendName}</span>
                <span className="dash-today-side" title={t.mine ? `You sent ${t.mine.title}` : ''}>
                  <span className="dash-today-label">You</span>
                  {t.mine ? <SmallArt song={t.mine} /> : <span className="dash-send-pill">Send</span>}
                </span>
                <span className="dash-today-side" title={t.theirs ? `They sent ${t.theirs.title}` : ''}>
                  <span className="dash-today-label">Them</span>
                  {t.theirs ? <SmallArt song={t.theirs} /> : <span className="dash-today-none">—</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(friendRequests.length > 0 || sentRequests.length > 0) && (
        <section className="dash-section">
          <h2 className="dash-title">Requests</h2>
          {friendRequests.map(r => (
            <div key={r.id} className="dash-card dash-request">
              <span><strong>{r.from_name}</strong> wants to swap</span>
              <span className="request-actions">
                <button className="accept-btn" aria-label={`Accept ${r.from_name}`} onClick={() => onAccept(r.id)}>✓</button>
                <button className="decline-btn" aria-label={`Decline ${r.from_name}`} onClick={() => onDecline(r.id)}>✕</button>
              </span>
            </div>
          ))}
          {sentRequests.length > 0 && (
            <p className="dash-waiting">Waiting on {sentRequests.map(r => r.to_name).join(', ')} to accept</p>
          )}
        </section>
      )}

      {unrated.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">Rate what you got</h2>
          {unrated.map(s => (
            <div key={s.id} className="dash-card dash-rate">
              <button className="dash-rate-song" onClick={() => onOpenSong(s)} title="Open in your music app">
                {s.albumArt ? <img src={s.albumArt} alt="" className="dash-art" /> : <div className="dash-art placeholder" />}
                <span className="dash-song-text">
                  <span className="dash-song-title">{s.title}</span>
                  <span className="dash-song-sub">{s.artist}</span>
                  <span className="dash-song-meta">from {s.friendName} · {timeAgo(s.sentAt)}</span>
                </span>
              </button>
              <StarRating value={s.rating} onRate={n => rate(s, n)} />
            </div>
          ))}
        </section>
      )}

      {friendCount < 3 && (
        <div className="dash-card dash-invite">
          <div>
            <p className="dash-invite-title">Invite a friend</p>
            <p className="dash-invite-sub">Song Swap is better with more people to swap with.</p>
          </div>
          <button id="dash-invite-btn" onClick={onInvite}>{inviteCopied ? '✓ Link copied' : 'Share invite link'}</button>
        </div>
      )}

      {stats && (stats.sent + stats.received) > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">Your numbers</h2>
          <div className="dash-stats">
            <div className="dash-stat"><span className="dash-stat-num">{stats.sent + stats.received}</span><span className="dash-stat-label">songs swapped</span></div>
            <div className="dash-stat"><span className="dash-stat-num">{stats.sent}</span><span className="dash-stat-label">sent</span></div>
            <div className="dash-stat"><span className="dash-stat-num">{stats.received}</span><span className="dash-stat-label">received</span></div>
            <div className="dash-stat">
              <span className="dash-stat-num">{stats.avg_rating_received ? `${stats.avg_rating_received}★` : '—'}</span>
              <span className="dash-stat-label">{stats.ratings_received ? `avg rating you got` : 'no ratings yet'}</span>
            </div>
            {stats.top_artist && (
              <div className="dash-stat dash-stat-wide"><span className="dash-stat-num dash-stat-text">{stats.top_artist}</span><span className="dash-stat-label">most swapped artist</span></div>
            )}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">Recent swaps</h2>
          <div className="dash-card dash-recent">
            {recent.map(s => {
              const mineSong = s.sentBy === user.name;
              return (
                <button key={s.id} className="dash-recent-row" onClick={() => onOpenFriend(s.friendshipId)}>
                  <SmallArt song={s} />
                  <span className="dash-song-text">
                    <span className="dash-song-title">{s.title}</span>
                    <span className="dash-song-meta-muted">{mineSong ? `You → ${s.friendName}` : `${s.friendName} → you`} · {timeAgo(s.sentAt)}</span>
                  </span>
                  {s.rating ? <span className="dash-recent-rating">{'★'.repeat(s.rating)}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {loved.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-title">Songs you loved <span className="dash-hint">· rated 4★ or more</span></h2>
          <div className="dash-loved">
            {loved.map(s => (
              <button key={s.id} className="dash-loved-item" onClick={() => onOpenSong(s)} title={`${s.title} — ${s.artist} (from ${s.friendName})`}>
                {s.albumArt ? <img src={s.albumArt} alt="" /> : <div className="dash-art placeholder" />}
                <span className="dash-loved-title">{s.title}</span>
                <span className="dash-loved-sub">{s.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Settings → Delete account. Asks for the password before deleting anything.
function DeleteAccount({ onDeleted }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/me', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) onDeleted();
      else setError(d.error || 'Could not delete your account');
    } catch { setError('Network error — try again'); }
    finally { setBusy(false); }
  };
  if (!open) {
    return <button className="settings-danger-btn" onClick={() => setOpen(true)}>Delete Account</button>;
  }
  return (
    <div className="settings-password-form">
      <p className="settings-warning">This permanently deletes your account, your friends list and every swap's history. It can't be undone.</p>
      <input type="password" placeholder="Your password" value={password} autoFocus
        onChange={e => { setPassword(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter' && password && !busy) submit(); }} />
      {error && <p className="settings-feedback error">{error}</p>}
      <div className="settings-actions">
        <button className="settings-delete-confirm" disabled={!password || busy} onClick={submit}>{busy ? 'Deleting…' : 'Delete Forever'}</button>
        <button className="link-btn" onClick={() => { setOpen(false); setPassword(''); setError(''); }}>Cancel</button>
      </div>
    </div>
  );
}

// Settings → Admin → Reset Password. Shows a temporary password to pass on.
function AdminResetPassword() {
  const [name, setName] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const submit = async () => {
    setError(''); setResult(null); setCopied(false);
    const r = await fetch('/api/admin/reset-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setResult(d); setName(''); } else setError(d.error || 'Reset failed');
  };
  return (
    <div className="settings-password-form">
      <input placeholder="Username" value={name} autoCapitalize="off" autoCorrect="off"
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) submit(); }} />
      <button className="settings-save-btn" disabled={!name.trim()} onClick={submit}>Reset Password</button>
      {error && <p className="settings-feedback error">{error}</p>}
      {result && (
        <p className="settings-feedback success">
          Temporary password for <strong>{result.name}</strong>: <code className="temp-password">{result.tempPassword}</code>{' '}
          <button className="link-btn" onClick={() => { navigator.clipboard?.writeText(result.tempPassword); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
          <br />They've been signed out. Send it to them privately and have them change it in Settings.
        </p>
      )}
    </div>
  );
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

// /share?url=…&text=… — sent by Android's share menu (installed app) or an
// iPhone Shortcut. Keep the first link found (survives log-in), clean the URL,
// and fill it into the send box once a friend is picked.
const SHARE_KEY = 'ss_pending_share';
const readPendingShare = () => {
  let link = null;
  if (window.location.pathname.replace(/\/$/, '') === '/share') {
    const q = new URLSearchParams(window.location.search);
    const all = ['url', 'text', 'title'].map(k => q.get(k) || '').join(' ');
    link = all.match(/https?:\/\/\S+/)?.[0] ?? null;
    window.history.replaceState(null, '', '/');
  }
  try {
    if (link) sessionStorage.setItem(SHARE_KEY, link);
    return sessionStorage.getItem(SHARE_KEY);
  } catch { return link; }
};
const clearPendingShare = () => { try { sessionStorage.removeItem(SHARE_KEY); } catch { /* ignore */ } };

function App() {
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState(() => (readPendingInvite() ? 'register' : 'login'));
  const [pendingInvite, setPendingInvite] = useState(readPendingInvite);
  const [pendingShare, setPendingShare] = useState(readPendingShare);
  const pendingShareRef = useRef(pendingShare);
  const clearSessionRef = useRef(() => {});
  const refreshActiveSwapRef = useRef(() => {});
  const songLinkRef = useRef('');
  // Arriving logged out from an invite link goes straight to sign-up
  const [showAuth, setShowAuth] = useState(() => !!pendingInvite);
  // Phones start on the dashboard; the sidebar is opened with ☰
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 700);
  const [dashTick, setDashTick] = useState(0);

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

  // Move a friend to the top of the list when a song is sent or received
  const bumpActivity = (friendshipId, sentAt) => setFriends(prev => prev.map(f =>
    f.friendship_id === friendshipId && (!f.last_activity || new Date(sentAt) > new Date(f.last_activity))
      ? { ...f, last_activity: sentAt } : f));

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
      if (document.visibilityState !== 'visible' || !userRef.current) return;
      loadUnreadStatus(userRef.current);
      refreshActiveSwapRef.current();
      setDashTick(t => t + 1);
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
    // Shared a song into the app: with one friend, open them straight away;
    // otherwise show the friends list and fill it in once one is picked
    if (pendingShareRef.current) {
      loadFriends().then(list => {
        if (list.length === 1) selectFriend(list[0]);
        else setSidebarOpen(true);
      });
    }
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
      refreshActiveSwapRef.current();
    };
    socket.on('connect', joinRooms);
    socket.disconnect().connect();
    return () => socket.off('connect', joinRooms);
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => {
      if (song.friendshipId === activeFriendshipRef.current?.friendship_id) setReceivedSong(song);
    });
    socket.on('swap-received', ({ friendshipId, sentAt }) => {
      bumpActivity(friendshipId, sentAt);
      const viewing = friendshipId === activeFriendshipRef.current?.friendship_id
        && document.visibilityState === 'visible';
      if (viewing) markRead(friendshipId);
      else setUnreadFriendships(prev => prev.has(friendshipId) ? prev : new Set(prev).add(friendshipId));
    });
    socket.on('swap-read', ({ friendshipId }) => removeUnread(friendshipId));
    // Account deleted on another device, or password reset by an admin
    socket.on('force-logout', () => clearSessionRef.current());
    socket.on('song-cleared', () => { setReceivedSong(null); setDashTick(t => t + 1); });
    socket.on('song-rated', applyRating);
    socket.on('all-songs-cleared', () => { setReceivedSong(null); setSongDetails(null); });
    socket.on('send-success', () => { setSent(true); setTimeout(() => { setSent(false); setSongLink(''); }, 1500); });
    socket.on('duplicate-song', (entry) => { setDuplicate(entry); setDenied(true); setTimeout(() => setDenied(false), 1500); });
    socket.on('send-error', ({ error }) => setVerifyError(error || 'Could not send that song'));
    socket.on('history-updated', (entry) => {
      bumpActivity(entry.friendshipId, entry.sentAt);
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
    // A friend changed their name or picture: refresh lists and the open swap
    socket.on('friend-updated', async () => {
      const list = await loadFriends();
      loadRequests();
      const active = activeFriendshipRef.current && list.find(f => f.friendship_id === activeFriendshipRef.current.friendship_id);
      if (active) { activeFriendshipRef.current = active; setActiveFriendship(active); }
      refreshActiveSwapRef.current();
    });
    // You changed your name/picture in another tab
    socket.on('me-updated', () => loadMe());
    socket.on('friendship-removed', ({ friendshipId }) => closeFriendship(friendshipId));
    socket.on('friend-request-declined', () => loadRequests());
    return () => {
      socket.off('song-received');
      socket.off('swap-received');
      socket.off('swap-read');
      socket.off('force-logout');
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
      socket.off('friend-updated');
      socket.off('me-updated');
      socket.off('friendship-removed');
      socket.off('friend-request-declined');
    };
  }, []);

  // A swap's history, the friend's current song, and the song you sent.
  // Each is undefined if its request failed.
  const fetchSwap = async (friendshipId) => {
    const get = (what) => fetch(`/api/friends/${friendshipId}/${what}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : undefined)).catch(() => undefined);
    const [hist, cur, mine] = await Promise.all([get('history'), get('current-song'), get('my-song')]);
    const received = cur === undefined ? undefined : (cur && cur.sentBy !== userRef.current?.name ? cur : null);
    return { hist, received, mine };
  };

  // Re-fetch the open swap after coming back to the tab or reconnecting, since
  // songs sent while the phone slept or the socket was down were missed.
  // Leaves a link you're typing or a verified-but-unsent song alone.
  const refreshActiveSwap = async () => {
    const id = activeFriendshipRef.current?.friendship_id;
    if (!id) return;
    const { hist, received, mine } = await fetchSwap(id);
    if (activeFriendshipRef.current?.friendship_id !== id) return; // switched friends meanwhile
    if (hist) setHistory(hist);
    if (received !== undefined) setReceivedSong(received);
    if (mine !== undefined && !songLinkRef.current.trim()) {
      setSongDetails(prev => (prev && !prev.id ? prev : mine));
    }
  };
  useEffect(() => { refreshActiveSwapRef.current = refreshActiveSwap; });
  useEffect(() => { songLinkRef.current = songLink; }, [songLink]);

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
    const { hist, received, mine } = await fetchSwap(friendship.friendship_id);
    if (hist) setHistory(hist);
    if (received) setReceivedSong(received);
    if (mine) setSongDetails(mine);
    const shared = pendingShareRef.current;
    if (shared) {
      pendingShareRef.current = null;
      setPendingShare(null);
      clearPendingShare();
      setSongLink(shared);
      verifySong(shared);
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

  // Back to the dashboard
  const goHome = () => {
    activeFriendshipRef.current = null;
    setActiveFriendship(null);
    setShowSettings(false);
    setSongLink('');
    setSongDetails(null);
    setReceivedSong(null);
    setHistory([]);
    setVerifyError('');
    setDuplicate(null);
    if (window.innerWidth <= 700) setSidebarOpen(false);
  };

  const openFriendById = (friendshipId) => {
    const f = friends.find(x => x.friendship_id === friendshipId);
    if (f) selectFriend(f);
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

  // Back to the logged-out screen (after logout, account deletion, or being
  // signed out by a password reset)
  const clearSession = () => {
    setUser(null);
    setShowSettings(false);
    // Clear the ref too, or the next account to log in on this tab inherits
    // the old open swap and it gets marked read for them
    activeFriendshipRef.current = null;
    setActiveFriendship(null);
    setUnreadFriendships(new Set());
  };
  useEffect(() => { clearSessionRef.current = clearSession; });
  const logout = () => fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(clearSession);

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
        {authMode === 'login' && (
          <p id="auth-forgot">
            Forgot your password? <a href="https://github.com/Mguaste/song-swap/issues" target="_blank" rel="noreferrer">Open an issue</a> with
            your username (or ask the friend who invited you) and we'll send you a temporary one.
          </p>
        )}
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
        <button id="home-btn" onClick={goHome} aria-label="Home" title="Home">
          <img src={icon} id="logo" alt="" />
        </button>
        <h1 id="main-title">
          Song Swap
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
                [...friends].sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0)).map(f => (
                  <div
                    key={f.friendship_id}
                    className={`friend-item${activeFriendship?.friendship_id === f.friendship_id ? ' active' : ''}`}
                    onClick={() => selectFriend(f)}
                  >
                    <Avatar userId={f.friend_id} avatarAt={f.friend_avatar_at} name={f.friend_name} />
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
              <h2 className="page-heading">Settings</h2>
              <div className="settings-section">
                <h2 className="settings-section-title">Account</h2>
                <p className="settings-signed-in">Logged in as <strong>{user.name}</strong></p>
                <ProfileSettings key={user.name} user={user} onChanged={loadMe} />
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
                  <div className="settings-row">
                    <label className="settings-label">Reset Password</label>
                    <AdminResetPassword />
                  </div>
                </div>
              )}

              <div className="settings-section">
                <h2 className="settings-section-title">Danger Zone</h2>
                <div className="settings-row">
                  <label className="settings-label">Delete Account</label>
                  <DeleteAccount onDeleted={clearSession} />
                </div>
              </div>
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
            <Dashboard
              user={user}
              friends={friends}
              friendCount={friends.length}
              friendRequests={friendRequests}
              sentRequests={sentRequests}
              refreshKey={`${[...unreadFriendships].sort().join()}|${friends.map(f => f.last_activity).join()}|${dashTick}`}
              onOpenFriend={openFriendById}
              onOpenSong={openSong}
              onAccept={acceptRequest}
              onDecline={declineRequest}
              onInvite={shareInvite}
              inviteCopied={inviteCopied}
              pendingShare={pendingShare}
              onCancelShare={() => { pendingShareRef.current = null; setPendingShare(null); clearPendingShare(); }}
            />
          ) : (

            <>
              <div id="swap-header">
                <Avatar userId={activeFriendship.friend_id} avatarAt={activeFriendship.friend_avatar_at}
                  name={activeFriendship.friend_name} className="avatar-swap" />
                <div className="swap-header-text">
                  <h2 className="page-heading">{activeFriendship.friend_name}</h2>
                  <p className="swap-header-sub">
                    {history.length > 0
                      ? `${history.length} song${history.length > 1 ? 's' : ''} swapped · last ${timeAgo(history[0].sentAt)}`
                      : 'No songs swapped yet — send the first one'}
                  </p>
                </div>
              </div>
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
