// /add/ABC123 invite links: remember the code (survives sign-up/log-in), then
// clean the URL. The code is turned into a friend request once logged in.
const INVITE_KEY = 'ss_pending_invite';
// Where the pending invite came from: { via: 'invite' } or { via: 'share', shareId }
const SOURCE_KEY = 'ss_pending_source';
export const readPendingInvite = () => {
  const m = window.location.pathname.match(/^\/add\/([A-Za-z0-9]{6})\/?$/);
  try {
    if (m) {
      sessionStorage.setItem(INVITE_KEY, m[1].toUpperCase());
      sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ via: 'invite' }));
      window.history.replaceState(null, '', '/');
    }
    return sessionStorage.getItem(INVITE_KEY);
  } catch { return m ? m[1].toUpperCase() : null; }
};
export const readPendingSource = () => {
  try { return JSON.parse(sessionStorage.getItem(SOURCE_KEY)) ?? {}; } catch { return {}; }
};
export const clearPendingInvite = () => {
  try { sessionStorage.removeItem(INVITE_KEY); sessionStorage.removeItem(SOURCE_KEY); } catch { /* ignore */ }
};
// "Swap back" on a shared song turns into an invite from the sender
export const savePendingInvite = (code, shareId) => {
  try {
    sessionStorage.setItem(INVITE_KEY, code.toUpperCase());
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ via: 'share', shareId }));
  } catch { /* ignore */ }
};

// /s/<id> song share links: shown as their own page (the URL stays, so a
// refresh keeps working) until the visitor moves on
export const readShareLinkId = () => window.location.pathname.match(/^\/s\/([A-Za-z0-9]{10})\/?$/)?.[1] ?? null;

// /share?url=…&text=… — sent by Android's share menu (installed app) or an
// iPhone Shortcut. Keep the first link found (survives log-in), clean the URL,
// and fill it into the send box once a friend is picked.
const SHARE_KEY = 'ss_pending_share';
export const readPendingShare = () => {
  let link = null;
  if (window.location.pathname.replace(/\/$/, '') === '/share') {
    const q = new URLSearchParams(window.location.search);
    const all = ['url', 'text', 'title'].map(k => q.get(k) || '').join(' ');
    link = all.match(/https?:\/\/\S+/)?.[0] ?? null;
    window.history.replaceState(null, '', '/');
  }
  try {
    if (link) sessionStorage.setItem(SHARE_KEY, link);
    return sessionStorage.getItem(SHARE_KEY);
  } catch { return link; }
};
export const clearPendingShare = () => { try { sessionStorage.removeItem(SHARE_KEY); } catch { /* ignore */ } };

// /?swap=123 — opened from a push notification: show that swap once logged in
export const readPendingSwap = () => {
  const q = new URLSearchParams(window.location.search);
  const id = Number(q.get('swap'));
  if (q.has('swap')) window.history.replaceState(null, '', '/');
  return Number.isInteger(id) && id > 0 ? id : null;
};
