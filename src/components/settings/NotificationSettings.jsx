import { useEffect, useState } from 'react';
import { pushStatus, enablePush, disablePush } from '../../lib/push';

const MESSAGES = {
  unsupported: "This browser doesn't support notifications.",
  'ios-install': 'On iPhone, add Song Swap to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.',
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then come back here.',
  off: 'Get a notification when a friend sends you a song or a friend request.',
  on: "Notifications are on for this device. You won't get them while Song Swap is open on screen.",
};

// Settings → Notifications (per device)
export function NotificationSettings({ userId }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { pushStatus().then(setStatus); }, []);

  const toggle = async () => {
    setBusy(true); setError('');
    try {
      if (status === 'on') await disablePush({ userId, forget: true }); else await enablePush(userId);
    } catch (e) { setError(e.message || 'Something went wrong'); }
    setStatus(await pushStatus());
    setBusy(false);
  };

  if (!status) return null;
  return (
    <div className="settings-password-form">
      <p className="settings-hint notif-msg">{MESSAGES[status]}</p>
      {(status === 'on' || status === 'off') && (
        <button className="settings-save-btn" disabled={busy} onClick={toggle}>
          {busy ? 'Working…' : status === 'on' ? 'Turn Off' : 'Turn On Notifications'}
        </button>
      )}
      {error && <p className="settings-feedback error">{error}</p>}
    </div>
  );
}
