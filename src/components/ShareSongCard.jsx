import { useState } from 'react';

// Make a /s/<id> link for one song, to send to anyone (even people who
// aren't on Song Swap yet)
export function ShareSongCard() {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const create = async (value = link) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link: value.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setResult(d); setLink(''); }
      else setError(d.error || 'Could not make a link for that song');
    } catch {
      setError('Could not reach Song Swap — check your connection');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const { url, song } = result;
    // Phones get the native share sheet; desktops copy to the clipboard
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: `${song.title} — ${song.artist}`, text: `Listen to ${song.title} by ${song.artist}`, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { window.prompt('Copy your song link:', url); }
  };

  return (
    <div className="dash-card share-song-card">
      <p className="dash-invite-title">Send a song to anyone</p>
      <p className="dash-invite-sub">They can listen in their own music app, no account needed, then swap back with you.</p>

      {result ? (
        <div className="share-song-result">
          {result.song.albumArt ? <img src={result.song.albumArt} alt="" className="dash-art-sm" /> : <span className="dash-art-sm placeholder" />}
          <span className="dash-song-text">
            <span className="dash-song-title">{result.song.title}</span>
            <span className="dash-song-meta-muted">{result.url.replace(/^https?:\/\//, '')}</span>
          </span>
          <button className="share-song-btn" onClick={share}>{copied ? '✓ Copied' : 'Share link'}</button>
          <button className="link-btn share-song-again" onClick={() => { setResult(null); setCopied(false); }}>Send another</button>
        </div>
      ) : (
        <div className="share-song-input">
          <input
            placeholder="Paste a song link…"
            value={link}
            onChange={e => { setLink(e.target.value); setError(''); }}
            onPaste={e => {
              const text = e.clipboardData.getData('text').trim();
              if (link.trim() || !/^(https?:\/\/|spotify:)/i.test(text)) return;
              e.preventDefault();
              setLink(text);
              create(text);
            }}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
          />
          <button className="share-song-btn" onClick={() => create()} disabled={busy || !link.trim()}>
            {busy ? 'Finding…' : 'Make link'}
          </button>
        </div>
      )}
      {error && <p className="share-song-error">{error}</p>}
    </div>
  );
}
