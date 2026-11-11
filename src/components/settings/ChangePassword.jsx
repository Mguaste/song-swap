import { useState } from 'react';

export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const edit = (setter) => (e) => { setter(e.target.value); setError(''); setSuccess(''); };

  const save = async () => {
    if (next !== confirm) { setError('New passwords do not match'); return; }
    const r = await fetch('/api/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setSuccess('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
    } else {
      setError(d.error || 'Failed to update password');
    }
  };

  return (
    <div className="settings-password-form">
      <input type="password" placeholder="Current password" value={current} onChange={edit(setCurrent)} />
      <input type="password" placeholder="New password" value={next} onChange={edit(setNext)} />
      <input type="password" placeholder="Confirm new password" value={confirm} onChange={edit(setConfirm)} />
      {error && <p className="settings-feedback error">{error}</p>}
      {success && <p className="settings-feedback success">{success}</p>}
      <button className="settings-save-btn" onClick={save}>Save Password</button>
    </div>
  );
}
