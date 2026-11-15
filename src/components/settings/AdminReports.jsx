import { useEffect, useState } from 'react';

// Admin → Reports: user reports, newest open ones first. Dismiss, or ban the
// reported account (signs them out everywhere and blocks login).
export function AdminReports() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  const load = () => fetch('/api/admin/reports', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(setList)
    .catch(() => setError('Could not load reports'));
  useEffect(() => { load(); }, []);

  const act = async (url) => {
    setBusy(b => b + 1);
    await fetch(url, { method: 'POST', credentials: 'include' }).catch(() => {});
    setBusy(b => b - 1);
    load();
  };
  const ban = (id, name) => {
    if (window.confirm(`Ban ${name}? They'll be signed out everywhere and can't log back in.`)) act(`/api/admin/users/${id}/ban`);
  };

  if (error) return <p className="growth-note">{error}</p>;
  if (!list) return <p className="growth-note">Loading…</p>;
  if (list.length === 0) return <p className="growth-note">No reports.</p>;

  return (
    <ul className="report-list">
      {list.map(r => (
        <li key={r.id} className={`report-item status-${r.status}`}>
          <div className="report-main">
            <span className="report-who">
              <strong>{r.reported_name}</strong>
              {r.is_banned && <span className="report-tag banned">banned</span>}
              {r.status !== 'open' && <span className="report-tag">{r.status}</span>}
            </span>
            <span className="report-meta">
              reported by {r.reporter_name ?? 'a former user'} · {new Date(r.created_at).toLocaleDateString()}
            </span>
            {r.reason && <p className="report-reason">“{r.reason}”</p>}
          </div>
          <div className="report-actions">
            {r.status === 'open' && (
              <button className="link-btn" disabled={busy > 0} onClick={() => act(`/api/admin/reports/${r.id}/dismiss`)}>Dismiss</button>
            )}
            {r.is_banned ? (
              <button className="link-btn" disabled={busy > 0} onClick={() => act(`/api/admin/users/${r.reported_id}/unban`)}>Unban</button>
            ) : !r.reported_is_admin && (
              <button className="settings-danger-btn" disabled={busy > 0} onClick={() => ban(r.reported_id, r.reported_name)}>Ban</button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
