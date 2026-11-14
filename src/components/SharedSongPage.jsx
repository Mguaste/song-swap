import { useEffect, useState } from 'react';
import icon from '../assets/SSLogo.png';
import { Avatar } from './Avatar';
import { PLATFORMS, buildSearchUrl, openSongLink } from '../lib/platforms';

// /s/<id>: a song someone shared. Works without an account: play it in any
// music app, then swap back (sign up, or add the sender if logged in).
export function SharedSongPage({ id, user, onSwapBack, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/shares/${encodeURIComponent(id)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setData(d);
        else setError(d.error || 'Could not load this song');
      })
      .catch(() => setError('Could not load this song — check your connection'));
  }, [id]);

  if (error) {
    return (
      <div id="shared-page">
        <div className="shared-card">
          <img src={icon} className="shared-logo" alt="Song Swap" />
          <p className="shared-error">{error}</p>
          <button className="shared-cta-btn" onClick={onClose}>Go to Song Swap</button>
        </div>
      </div>
    );
  }
  if (!data) return <div id="shared-page" />;

  const { from, song } = data;
  const isMine = user && user.id === from.id;
  const isMissing = (key) => !!song.platformLinks?.[key]?.notFound;
  // Not highlighted if we checked and the song isn't there
  const preferred = isMissing(user?.preferred_platform) ? null : user?.preferred_platform;
  // The listener's own app first, if we know it; services without the song last
  const platforms = [...PLATFORMS].sort(([a], [b]) =>
    (b === preferred) - (a === preferred) || isMissing(a) - isMissing(b));

  return (
    <div id="shared-page">
      <div className="shared-card">
        <button className="shared-brand" onClick={onClose}>
          <img src={icon} className="shared-logo" alt="" /> Song Swap
        </button>

        <p className="shared-from">
          <Avatar userId={from.id} avatarAt={from.avatarAt} name={from.name} className="avatar-shared" />
          {isMine ? 'You shared this song' : <><strong>{from.name}</strong>&nbsp;sent you a song</>}
        </p>

        {song.albumArt
          ? <img className="shared-art" src={song.albumArt} alt={`${song.album || song.title} cover`} />
          : <div className="shared-art placeholder" />}
        <h1 className="shared-title">{song.title}</h1>
        <p className="shared-artist">{song.artist}</p>
        {song.album && <p className="shared-album">{song.album}</p>}

        <p className="shared-listen-label">Listen on</p>
        <div className="shared-platforms">
          {platforms.map(([key, label]) => {
            const url = song.platformLinks?.[key]?.url ?? buildSearchUrl(key, song.title, song.artist);
            return url && (
              <a key={key} href={url} target="_blank" rel="noreferrer"
                className={`shared-platform${key === preferred ? ' preferred' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  openSongLink(key, url, song.platformLinks?.[key]?.nativeAppUriMobile);
                }}>
                {isMissing(key) ? `Search ${label}` : label}
              </a>
            );
          })}
        </div>

        <div className="shared-cta">
          {isMine ? (
            <>
              <p>This is your share link. Anyone you send it to can listen, then swap songs with you.</p>
              <button className="shared-cta-btn" onClick={onClose}>Back to Song Swap</button>
            </>
          ) : (
            <>
              <p><strong>Like it?</strong> Send {from.name} a song back.</p>
              <button className="shared-cta-btn" onClick={() => onSwapBack(from)}>
                {user ? `Add ${from.name} on Song Swap` : `Swap songs with ${from.name}`}
              </button>
              {!user && <p className="shared-fine">Free, no ads. Works with whatever music app you use.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
