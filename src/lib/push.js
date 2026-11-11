// Web push helpers: register the service worker, and turn notifications on or
// off for this device.

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* push just stays unavailable */ });
};

// 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'
export const pushStatus = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
};

// Per device and account: did this user turn notifications on here? Logging
// out turns them off, and this lets logging back in restore them silently.
const wantKey = (userId) => `ss_push_wanted_${userId}`;
const setWanted = (userId, on) => {
  if (!userId) return;
  try { if (on) localStorage.setItem(wantKey(userId), '1'); else localStorage.removeItem(wantKey(userId)); } catch { /* ignore */ }
};
const isWanted = (userId) => { try { return localStorage.getItem(wantKey(userId)) === '1'; } catch { return false; } };

const urlBase64ToUint8Array = (base64) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};

// Must be called from a tap/click (browsers require it for the permission prompt)
export const enablePush = async (userId) => {
  const { publicKey } = await fetch('/api/push/key').then(r => r.json());
  if (!publicKey) throw new Error('Notifications aren\'t set up on the server yet');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked in your browser settings' : 'Permission not granted');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const r = await fetch('/api/push/subscribe', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!r.ok) throw new Error('Could not save the subscription');
  setWanted(userId, true);
};

// True when restorePush will switch notifications back on by itself
export const willRestorePush = (userId) =>
  isWanted(userId) && 'Notification' in window && Notification.permission === 'granted';

// After logging in: if this user had notifications on here and the browser
// already allows them, turn them back on without asking
export const restorePush = async (userId) => {
  if (!isWanted(userId) || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try { await enablePush(userId); } catch { /* stays off; Settings shows the toggle */ }
};

// Turn off for this device. forget = the user switched it off (not just a
// logout), so don't bring it back on next login.
export const disablePush = async ({ userId, forget = false } = {}) => {
  if (forget) setWanted(userId, false);
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
};
