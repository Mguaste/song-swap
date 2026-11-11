import { useEffect, useState } from 'react';
import { pushStatus, enablePush } from '../lib/push';

const DISMISS_KEY = 'ss_notify_prompt_dismissed';
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

// Dashboard card nudging you to turn on notifications (or install on iPhone)
export function NotifyPrompt() {
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(dismissed);
  const [error, setError] = useState('');
  useEffect(() => { pushStatus().then(setStatus); }, []);

  if (hidden || (status !== 'off' && status !== 'ios-install')) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setHidden(true); };
  const enable = async () => {
    setError('');
    try { await enablePush(); } catch (e) { setError(e.message); }
    setStatus(await pushStatus());
  };

  return (
    <div className="dash-card dash-notify">
      <div>
        <p className="dash-invite-title">🔔 Never miss a swap</p>
        <p className="dash-invite-sub">
          {status === 'ios-install'
            ? 'Add Song Swap to your Home Screen (Share → Add to Home Screen) and open it from there to get notifications.'
            : 'Get a notification when a friend sends you a song.'}
        </p>
        {error && <p className="settings-feedback error">{error}</p>}
      </div>
      <div className="dash-notify-actions">
        {status === 'off' && <button id="dash-invite-btn" onClick={enable}>Turn on</button>}
        <button className="link-btn" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
