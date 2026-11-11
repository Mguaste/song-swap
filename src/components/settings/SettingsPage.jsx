import { ProfileSettings } from './ProfileSettings';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { AdminResetPassword } from './AdminResetPassword';

const PLATFORMS = [
  ['spotify', 'Spotify'], ['appleMusic', 'Apple Music'], ['youtubeMusic', 'YouTube Music'],
  ['amazonMusic', 'Amazon Music'], ['tidal', 'Tidal'], ['deezer', 'Deezer'],
];

export function SettingsPage({ user, onBack, onProfileChanged, preferredPlatform, onPlatformChange, onAccountDeleted }) {
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
      </div>

      {user.is_admin && (
        <div className="settings-section" id="settings-admin">
          <h2 className="settings-section-title">Admin</h2>
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
