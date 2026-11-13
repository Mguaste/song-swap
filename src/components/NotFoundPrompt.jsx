import { useEffect } from 'react';
import { PLATFORMS, buildSearchUrl } from '../lib/platforms';

// Shown when a song was searched for on the listener's own service and isn't
// there: offer the services that do have it, or a search anyway.
export function NotFoundPrompt({ song, platformLinks, preferredPlatform, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = PLATFORMS.find(([key]) => key === preferredPlatform)?.[1] ?? 'your app';
  const available = PLATFORMS.filter(([key]) => platformLinks[key]?.url);
  const searchUrl = song?.title && song?.artist ? buildSearchUrl(preferredPlatform, song.title, song.artist) : null;

  return (
    <div className="notfound-backdrop" onClick={onClose}>
      <div className="notfound-card" role="dialog" aria-modal="true" aria-labelledby="notfound-title"
        onClick={e => e.stopPropagation()}>
        <h2 id="notfound-title">Not on {label}</h2>
        <p>
          We couldn't find <strong>{song?.title || 'this song'}</strong>
          {song?.artist && <> by {song.artist}</>} on {label}. Listen on:
        </p>
        <div className="notfound-options">
          {available.map(([key, name]) => (
            <a key={key} href={platformLinks[key].url} target="_blank" rel="noreferrer"
              className="notfound-option" onClick={onClose}>
              {name}
            </a>
          ))}
        </div>
        <div className="notfound-footer">
          {searchUrl && (
            <a href={searchUrl} target="_blank" rel="noreferrer" className="notfound-search" onClick={onClose}>
              Search {label} anyway
            </a>
          )}
          <button className="notfound-close" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
