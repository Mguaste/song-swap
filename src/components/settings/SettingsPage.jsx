import { ProfileSettings } from './ProfileSettings';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { MyShares } from './MyShares';
import { BlockedUsers } from './BlockedUsers';
import { NotificationSettings } from './NotificationSettings';
import { useState } from 'react';
import { PLATFORMS, isPhone, getSpotifyOpen, setSpotifyOpen } from '../../lib/platforms';
import { getThemeChoice, setThemeChoice } from '../../lib/theme';


export function SettingsPage({ user, onBack, onProfileChanged, preferredPlatform, onPlatformChange, showDashboard, onShowDashboardChange, onAccountDeleted }) {
  const [spotifyOpen, setSpotifyOpenState] = useState(getSpotifyOpen);
  const changeSpotifyOpen = (value) => { setSpotifyOpen(value); setSpotifyOpenState(value); };
  const [theme, setTheme] = useState(getThemeChoice);
  const changeTheme = (value) => { setThemeChoice(value); setTheme(value); };

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
        <h2 className="settings-section-title">Appearance</h2>
        <div className="settings-row">
          <label className="settings-label">Theme</label>
          <div className="settings-password-form">
            <select className="platform-select" value={theme} onChange={e => changeTheme(e.target.value)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match device</option>
            </select>
            <p className="settings-hint">Saved on this device.</p>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Home</h2>
        <div className="settings-row">
          <label className="settings-label">Dashboard</label>
          <div className="settings-password-form">
            <p className="settings-hint">
              {showDashboard ? 'Your home page shows the dashboard.' : 'The dashboard is off. Your home page stays blank.'}
            </p>
            <button className="settings-save-btn" onClick={() => onShowDashboardChange(!showDashboard)}>
              {showDashboard ? 'Turn Off' : 'Turn On Dashboard'}
            </button>
          </div>
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

      <div className="settings-section">
        <h2 className="settings-section-title">Your song links</h2>
        <MyShares />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Blocked users</h2>
        <BlockedUsers />
      </div>

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
