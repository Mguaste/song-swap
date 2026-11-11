// /add/ABC123 invite links: remember the code (survives sign-up/log-in), then
// clean the URL. The code is turned into a friend request once logged in.
const INVITE_KEY = 'ss_pending_invite';
export const readPendingInvite = () => {
  const m = window.location.pathname.match(/^\/add\/([A-Za-z0-9]{6})\/?$/);
  try {
    if (m) {
      sessionStorage.setItem(INVITE_KEY, m[1].toUpperCase());
      window.history.replaceState(null, '', '/');
    }
    return sessionStorage.getItem(INVITE_KEY);
  } catch { return m ? m[1].toUpperCase() : null; }
};
export const clearPendingInvite = () => { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ } };

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
