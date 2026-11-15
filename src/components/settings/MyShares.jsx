import { useEffect, useState } from 'react';

// Settings → Your song links: review and revoke the /s/ links you've made.
export function MyShares() {
  const [list, setList] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const load = () => fetch('/api/shares/mine', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : []))
    .then(setList)
    .catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    if (!window.confirm('Revoke this link? Anyone who has it will no longer be able to open it.')) return;
    await fetch(`/api/shares/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    load();
  };
  const copy = async (s) => {
    try {
      await navigator.clipboard.writeText(s.url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { window.prompt('Copy your song link:', s.url); }
  };

  if (!list) return <p className="settings-hint">Loading…</p>;
  if (list.length === 0) return <p className="settings-hint">You haven't made any song links yet. Make one from the dashboard.</p>;

  return (
    <ul className="my-shares-list">
      {list.map(s => (
        <li key={s.id} className={`my-share-item${s.expired ? ' expired' : ''}`}>
          {s.albumArt ? <img src={s.albumArt} alt="" className="dash-art-sm" /> : <span className="dash-art-sm placeholder" />}
          <span className="my-share-text">
            <span className="my-share-title">{s.title || 'Unknown song'}</span>
            <span className="my-share-meta">
              {new Date(s.createdAt).toLocaleDateString()}
              {s.expired ? ' · expired' : s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ''}
            </span>
          </span>
          {!s.expired && <button className="link-btn" onClick={() => copy(s)}>{copiedId === s.id ? 'Copied' : 'Copy'}</button>}
          <button className="link-btn" onClick={() => revoke(s.id)}>Revoke</button>
        </li>
      ))}
    </ul>
  );
}
