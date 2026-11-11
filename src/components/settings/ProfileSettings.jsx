import { useState, useRef } from 'react';
import { Avatar } from '../Avatar';
import { resizeImage } from '../../lib/image';

// Settings → Profile: picture and username
export function ProfileSettings({ user, onChanged }) {
  const [picError, setPicError] = useState('');
  const [picBusy, setPicBusy] = useState(false);
  const [name, setName] = useState(user.name);
  const [nameMsg, setNameMsg] = useState(null); // { error|success: text }
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setPicError(''); setPicBusy(true);
    try {
      const blob = await resizeImage(file);
      const r = await fetch('/api/me/avatar', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      onChanged();
    } catch (e) { setPicError(e.message || 'Upload failed'); }
    finally { setPicBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const removePic = async () => {
    await fetch('/api/me/avatar', { method: 'DELETE', credentials: 'include' });
    onChanged();
  };
  const rename = async () => {
    setNameMsg(null);
    const r = await fetch('/api/me/name', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setNameMsg({ success: `Username changed — log in as ${d.name} from now on` }); onChanged(); }
    else setNameMsg({ error: d.error || 'Could not change username' });
  };

  return (
    <>
      <div className="settings-row">
        <label className="settings-label">Profile Picture</label>
        <div className="profile-pic-row">
          <Avatar userId={user.id} avatarAt={user.avatar_at} name={user.name} className="avatar-lg" />
          <div className="profile-pic-actions">
            <button className="settings-save-btn" disabled={picBusy} onClick={() => fileRef.current?.click()}>
              {picBusy ? 'Uploading…' : user.avatar_at ? 'Change Photo' : 'Add Photo'}
            </button>
            {user.avatar_at && !picBusy && <button className="link-btn" onClick={removePic}>Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])} />
        </div>
      </div>
      {picError && <p className="settings-feedback error">{picError}</p>}
      <div className="settings-row">
        <label className="settings-label">Username</label>
        <div className="settings-password-form">
          <input value={name} maxLength={30} autoCapitalize="off" autoCorrect="off"
            onChange={e => { setName(e.target.value); setNameMsg(null); }}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim() && name.trim() !== user.name) rename(); }} />
          <button className="settings-save-btn" disabled={!name.trim() || name.trim() === user.name} onClick={rename}>Change Username</button>
          {nameMsg?.error && <p className="settings-feedback error">{nameMsg.error}</p>}
          {nameMsg?.success && <p className="settings-feedback success">{nameMsg.success}</p>}
          <p className="settings-hint">You can change it once every 7 days. Friends see the new name right away.</p>
        </div>
      </div>
    </>
  );
}
