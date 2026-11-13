import { useEffect, useState } from 'react';

const MAX = 280;

// Settings → Admin → Memo to users: a banner every user sees once, next time they open the app
export function AdminAnnouncements() {
  const [list, setList] = useState([]);
  const [message, setMessage] = useState('');
  const [withSettings, setWithSettings] = useState(false);
  const [msg, setMsg] = useState(null); // { error|success }
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/admin/announcements', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : [])).then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const post = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/admin/announcements', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, action: withSettings ? 'settings' : null }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ error: d.error || 'Could not post' }); return; }
    setMessage(''); setWithSettings(false);
    setMsg({ success: 'Posted — people see it next time they open the app' });
    load();
  };

  const remove = async (id) => {
    await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="memo-admin">
      <textarea className="memo-input" rows={3} maxLength={MAX} placeholder="e.g. New: add a profile picture in Settings so friends know it's you"
        value={message} onChange={e => { setMessage(e.target.value); setMsg(null); }} />
      <div className="memo-options">
        <label className="memo-check">
          <input type="checkbox" checked={withSettings} onChange={e => setWithSettings(e.target.checked)} />
          “Open Settings” button
        </label>
        <span className="memo-count">{message.length}/{MAX}</span>
      </div>
      <button className="settings-save-btn" disabled={busy || !message.trim()} onClick={post}>Post to Everyone</button>
      {msg?.error && <p className="settings-feedback error">{msg.error}</p>}
      {msg?.success && <p className="settings-feedback success">{msg.success}</p>}

      {list.length > 0 && (
        <ul className="memo-list">
          {list.map(a => (
            <li key={a.id}>
              <p>{a.message}</p>
              <span className="memo-meta">
                {new Date(a.created_at).toLocaleDateString()}
                {a.action === 'settings' && ' · Settings button'} · closed by {a.seen}
                <button className="link-btn" onClick={() => remove(a.id)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
