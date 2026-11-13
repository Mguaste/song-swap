import { useState, useRef, useEffect } from 'react';
import { readPendingSource } from '../lib/pending';
import { resizeImage } from '../lib/image';

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
  // Optional profile picture: resized as soon as it's picked, uploaded after sign-up
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const pickPhoto = async (file) => {
    if (!file) return;
    setPhotoError('');
    try {
      const blob = await resizeImage(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) { setPhotoError(e.message || "Couldn't read that image"); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, password, preferredPlatform, ref: readPendingSource().via }),
    });
    if (!res.ok) {
      setBusy(false);
      setError((await res.json()).error || 'Registration failed');
      return;
    }
    // The account exists now; a failed upload shouldn't block getting in
    // (they can add a picture later in Settings)
    if (photo) {
      await fetch('/api/me/avatar', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'image/jpeg' }, body: photo.blob,
      }).catch(() => {});
    }
    onLogin();
  };

  return (
    <form id="login-form" onSubmit={submit}>
      <div className="register-photo">
        <button type="button" className="register-photo-btn" onClick={() => fileRef.current?.click()}
          aria-label={photo ? 'Change profile picture' : 'Add a profile picture'}>
          {photo
            ? <img src={photo.url} alt="" />
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}
        </button>
        <div className="register-photo-text">
          <span>{photo ? 'Looking good' : 'Add a photo'} <em>(optional)</em></span>
          {photo
            ? <button type="button" className="register-photo-remove" onClick={() => setPhoto(null)}>Remove</button>
            : <span className="register-photo-hint">Friends will see it next to your name</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
      </div>
      {photoError && <p id="login-error">{photoError}</p>}
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
      <button type="submit" disabled={busy}>{busy ? 'Signing up…' : 'Sign Up'}</button>
    </form>
  );
}
