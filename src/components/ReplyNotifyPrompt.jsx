import { useEffect, useState } from 'react';
import { pushStatus, enablePush, willRestorePush } from '../lib/push';

// "Not now" hides it for a week, then it can ask again after a later send
const SNOOZE_KEY = 'ss_reply_notify_snoozed_until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const snoozed = () => { try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ } };

// Shown under Send right after you send a song, when notifications are off:
// the moment you actually want to hear back.
export function ReplyNotifyPrompt({ userId, friendName, sent }) {
  const [status, setStatus] = useState(null);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sent || snoozed() || willRestorePush(userId)) return;
    pushStatus().then(s => {
      setStatus(s);
      if (s === 'off' || s === 'ios-install') setShow(true);
    });
  }, [sent, userId]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setShow(false), 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (!show) return null;
  const dismiss = () => { snooze(); setShow(false); };
  const enable = async () => {
    setError('');
    try {
      await enablePush(userId);
      setDone(true);
    } catch (e) {
      setError(e.message);
      setStatus(await pushStatus());
    }
  };

  if (done) {
    return <div className="reply-notify"><p className="dash-invite-title">🔔 You'll hear when {friendName} sends one back</p></div>;
  }
  return (
    <div className="reply-notify">
      <div>
        <p className="dash-invite-title">🔔 Want to know when {friendName} sends one back?</p>
        <p className="dash-invite-sub">
          {status === 'ios-install'
            ? 'On iPhone, add Song Swap to your Home Screen (Share → Add to Home Screen) and open it from there to get notifications.'
            : "We'll send you a notification. You can turn it off in Settings."}
        </p>
        {error && <p className="settings-feedback error">{error}</p>}
      </div>
      <div className="dash-notify-actions">
        {status === 'off' && <button className="notify-on-btn" onClick={enable}>Turn on</button>}
        <button className="link-btn" onClick={dismiss}>{status === 'off' ? 'Not now' : 'Got it'}</button>
      </div>
    </div>
  );
}
