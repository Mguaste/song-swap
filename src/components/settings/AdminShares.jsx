import { useEffect, useState } from 'react';

// Admin → Song Links: every /s/ share link, newest first. Revoke any of them.
export function AdminShares() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  const load = () => fetch('/api/admin/shares', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(setList)
    .catch(() => setError('Could not load share links'));
  useEffect(() => { load(); }, []);

  const revoke = async (id) => {
    if (!window.confirm('Revoke this link? It will stop working for everyone.')) return;
    await fetch(`/api/admin/shares/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    load();
  };

  if (error) return <p className="growth-note">{error}</p>;
  if (!list) return <p className="growth-note">Loading…</p>;
  if (list.length === 0) return <p className="growth-note">No song links yet.</p>;

  return (
    <ul className="share-admin-list">
      {list.map(s => (
        <li key={s.id} className={`share-admin-item${s.expired ? ' expired' : ''}`}>
          <span className="share-admin-text">
            <span className="share-admin-title">{s.title || 'Unknown'}{s.artist ? ` — ${s.artist}` : ''}</span>
            <span className="share-admin-meta">
              {s.owner} · {new Date(s.createdAt).toLocaleDateString()}
              {s.expired ? ' · expired' : s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ''}
            </span>
          </span>
          <button className="link-btn" onClick={() => revoke(s.id)}>Revoke</button>
        </li>
      ))}
    </ul>
  );
}
