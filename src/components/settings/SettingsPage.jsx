import { ProfileSettings } from './ProfileSettings';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { AdminResetPassword } from './AdminResetPassword';
import { AdminGrowth } from './AdminGrowth';
import { AdminAnnouncements } from './AdminAnnouncements';
import { NotificationSettings } from './NotificationSettings';
import { useState } from 'react';
import { PLATFORMS, isPhone, getSpotifyOpen, setSpotifyOpen } from '../../lib/platforms';


export function SettingsPage({ user, onBack, onProfileChanged, preferredPlatform, onPlatformChange, onAccountDeleted }) {
  const [spotifyOpen, setSpotifyOpenState] = useState(getSpotifyOpen);
  const changeSpotifyOpen = (value) => { setSpotifyOpen(value); setSpotifyOpenState(value); };

  return (
    <div id="settings-page">
      <button className="link-btn" id="settings-back" onClick={onBack}>← Back</button>
      <h2 className="page-heading">Settings</h2>

      <div className="settings-section">
        <h2 className="settings-section-title">Account</h2>
        <p className="settings-signed-in">Logged in as <strong>{user.name}</strong></p>
        <ProfileSettings key={user.name} user={user} onChanged={onProfileChanged} />
        <div className="settings-row">
          <label className="settings-label">Change Password</label>
          <ChangePassword />
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Music</h2>
        <div className="settings-row">
          <label className="settings-label">Open Songs In</label>
          <select className="platform-select" value={preferredPlatform} onChange={e => onPlatformChange(e.target.value)}>
            {PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {preferredPlatform === 'spotify' && !isPhone() && (
          <div className="settings-row">
            <label className="settings-label">Spotify On This Computer</label>
            <div className="settings-password-form">
              <select className="platform-select" value={spotifyOpen} onChange={e => changeSpotifyOpen(e.target.value)}>
                <option value="web">Browser</option>
                <option value="app">Desktop app</option>
              </select>
              <p className="settings-hint">Choose Desktop app if Spotify is installed on this computer. Phones always use the app.</p>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Notifications</h2>
        <div className="settings-row">
          <label className="settings-label">This Device</label>
          <NotificationSettings userId={user.id} />
        </div>
      </div>

      {user.is_admin && (
        <div className="settings-section" id="settings-admin">
          <h2 className="settings-section-title">Admin</h2>
          <div className="settings-row settings-row-block">
            <label className="settings-label">Growth</label>
            <AdminGrowth />
          </div>
          <div className="settings-row settings-row-block">
            <label className="settings-label">Memo to Users</label>
            <AdminAnnouncements />
          </div>
          <div className="settings-row">
            <label className="settings-label">History</label>
            <button className="settings-danger-btn" onClick={() => fetch('/api/admin/history', { method: 'DELETE', credentials: 'include' })}>Clear All History</button>
          </div>
          <div className="settings-row">
            <label className="settings-label">Current Songs</label>
            <button className="settings-danger-btn" onClick={() => fetch('/api/admin/current-song', { method: 'DELETE', credentials: 'include' })}>Clear Current Songs</button>
          </div>
          <div className="settings-row">
            <label className="settings-label">Reset Password</label>
            <AdminResetPassword />
          </div>
        </div>
      )}

      <div className="settings-section">
        <h2 className="settings-section-title">Danger Zone</h2>
        <div className="settings-row">
          <label className="settings-label">Delete Account</label>
          <DeleteAccount onDeleted={onAccountDeleted} />
        </div>
      </div>
    </div>
  );
}
