import { useEffect, useState } from 'react';

// Settings → Blocked: people you've blocked, with an unblock button.
export function BlockedUsers() {
  const [list, setList] = useState(null);

  const load = () => fetch('/api/blocks', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : []))
    .then(setList)
    .catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const unblock = async (id) => {
    await fetch(`/api/blocks/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    load();
  };

  if (!list) return <p className="settings-hint">Loading…</p>;
  if (list.length === 0) return <p className="settings-hint">You haven't blocked anyone.</p>;

  return (
    <ul className="blocked-list">
      {list.map(u => (
        <li key={u.id} className="blocked-item">
          <span className="blocked-name">{u.name}</span>
          <button className="link-btn" onClick={() => unblock(u.id)}>Unblock</button>
        </li>
      ))}
    </ul>
  );
}
