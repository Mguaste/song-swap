import { useState } from 'react';

// Settings → Delete account. Asks for the password before deleting anything.
export function DeleteAccount({ onDeleted }) {
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
