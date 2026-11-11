import { useState } from 'react';

// Settings → Admin → Reset Password. Shows a temporary password to pass on.
export function AdminResetPassword() {
  const [name, setName] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const submit = async () => {
    setError(''); setResult(null); setCopied(false);
    const r = await fetch('/api/admin/reset-password', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setResult(d); setName(''); } else setError(d.error || 'Reset failed');
  };
  return (
    <div className="settings-password-form">
      <input placeholder="Username" value={name} autoCapitalize="off" autoCorrect="off"
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) submit(); }} />
      <button className="settings-save-btn" disabled={!name.trim()} onClick={submit}>Reset Password</button>
      {error && <p className="settings-feedback error">{error}</p>}
      {result && (
        <p className="settings-feedback success">
          Temporary password for <strong>{result.name}</strong>: <code className="temp-password">{result.tempPassword}</code>{' '}
          <button className="link-btn" onClick={() => { navigator.clipboard?.writeText(result.tempPassword); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
          <br />They've been signed out. Send it to them privately and have them change it in Settings.
        </p>
      )}
    </div>
  );
}
