import { useState } from 'react';
import { readPendingSource } from '../lib/pending';

export function LoginForm({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password }),
    });
    if (res.ok) onLogin();
    else setError((await res.json()).error || 'Invalid username or password');
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Log In</button>
    </form>
  );
}

export function RegisterForm({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [preferredPlatform, setPreferredPlatform] = useState('spotify');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password, preferredPlatform, ref: readPendingSource().via }),
    });
    if (res.ok) onLogin();
    else setError((await res.json()).error || 'Registration failed');
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <input placeholder="Username" value={name} onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
      <input type="password" placeholder="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      <label htmlFor="register-platform" className="register-platform-label">Preferred music app</label>
      <select id="register-platform" value={preferredPlatform} onChange={e => setPreferredPlatform(e.target.value)} className="register-platform-select">
        <option value="spotify">Spotify</option>
        <option value="appleMusic">Apple Music</option>
        <option value="youtubeMusic">YouTube Music</option>
        <option value="amazonMusic">Amazon Music</option>
        <option value="tidal">Tidal</option>
        <option value="deezer">Deezer</option>
      </select>
      {error && <p id="login-error">{error}</p>}
      <button type="submit">Sign Up</button>
    </form>
  );
}
