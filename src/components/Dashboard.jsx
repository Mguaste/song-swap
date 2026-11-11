import { useState, useEffect } from 'react';
import { Avatar } from './Avatar';
import { StarRating } from './StarRating';
import { timeAgo, greeting, untilText } from '../lib/format';
import { NotifyPrompt } from './NotifyPrompt';

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
export function Dashboard({ user, friends, friendCount, friendRequests, sentRequests, refreshKey, onOpenFriend, onOpenSong,
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

      <NotifyPrompt />

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
