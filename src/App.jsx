import './App.css';
import { useState, useEffect, useRef } from 'react';
import { socket } from './socket';
import { BASE_TITLE, setFaviconPip } from './lib/favicon';
import { readPendingInvite, clearPendingInvite, readPendingShare, clearPendingShare, readPendingSwap } from './lib/pending';
import { registerServiceWorker, disablePush } from './lib/push';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Onboarding } from './components/Onboarding';
import { SwapPage } from './components/SwapPage';
import { LandingPage } from './components/LandingPage';
import { AuthScreen } from './components/AuthScreen';
import { SettingsPage } from './components/settings/SettingsPage';

function App() {
  const [user, setUser] = useState(undefined);
  const [authMode, setAuthMode] = useState(() => (readPendingInvite() ? 'register' : 'login'));
  const [pendingInvite, setPendingInvite] = useState(readPendingInvite);
  const [pendingShare, setPendingShare] = useState(readPendingShare);
  const pendingShareRef = useRef(pendingShare);
  const clearSessionRef = useRef(() => {});
  const pendingSwapRef = useRef(readPendingSwap()); // from a notification tap
  const openSwapRef = useRef(() => {});
  const refreshActiveSwapRef = useRef(() => {});
  const songLinkRef = useRef('');
  // Arriving logged out from an invite link goes straight to sign-up
  const [showAuth, setShowAuth] = useState(() => !!pendingInvite);
  // Phones start on the dashboard; the sidebar is opened with ☰
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 700);
  const [dashTick, setDashTick] = useState(0);

  // Friends
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [activeFriendship, setActiveFriendship] = useState(null);
  const activeFriendshipRef = useRef(null);
  const [addCodeInput, setAddCodeInput] = useState('');
  const [addCodeError, setAddCodeError] = useState('');
  const [addCodeSuccess, setAddCodeSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Swap lane
  const [songLink, setSongLink] = useState('');
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyReqRef = useRef(0); // ignore responses for a link that's since been changed
  const [denied, setDenied] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [songDetails, setSongDetails] = useState(null);
  const [receivedSong, setReceivedSong] = useState(null);
  const [history, setHistory] = useState([]);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [preferredPlatform, setPreferredPlatform] = useState('spotify');
  const [verifyError, setVerifyError] = useState('');

  // Unread tracking
  const [unreadFriendships, setUnreadFriendships] = useState(new Set());
  const userRef = useRef(null);

  const loadMe = async () => {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setUser(data);
      setPreferredPlatform(data.preferred_platform ?? 'spotify');
    } else {
      setUser(null);
    }
  };

  // Move a friend to the top of the list when a song is sent or received
  const bumpActivity = (friendshipId, sentAt) => setFriends(prev => prev.map(f =>
    f.friendship_id === friendshipId && (!f.last_activity || new Date(sentAt) > new Date(f.last_activity))
      ? { ...f, last_activity: sentAt } : f));

  const loadFriends = async () => {
    const r = await fetch('/api/friends', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setFriends(data);
      return data;
    }
    return friends;
  };

  // Incoming and outgoing pending requests
  const loadRequests = async () => {
    const [r, s] = await Promise.all([
      fetch('/api/friends/requests', { credentials: 'include' }),
      fetch('/api/friends/sent', { credentials: 'include' }),
    ]);
    if (r.ok) setFriendRequests(await r.json());
    if (s.ok) setSentRequests(await s.json());
  };

  const removeUnread = (friendshipId) => setUnreadFriendships(prev => {
    if (!prev.has(friendshipId)) return prev;
    const next = new Set(prev); next.delete(friendshipId); return next;
  });

  // Record on the server that this swap has been seen. The server tells this
  // account's other tabs/devices so their badges clear too.
  const markRead = (friendshipId) => {
    removeUnread(friendshipId);
    fetch(`/api/friends/${friendshipId}/read`, { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  const loadUnreadStatus = async (currentUser) => {
    const r = await fetch('/api/friends/latest-activity', { credentials: 'include' });
    if (!r.ok) return;
    const activities = await r.json();
    // One-time carry-over from when read status lived in this browser
    const legacyKey = `ss_last_viewed_${currentUser.name}`;
    let legacy = {};
    try { legacy = JSON.parse(localStorage.getItem(legacyKey) || '{}'); } catch { /* ignore */ }
    const unread = new Set();
    for (const { friendshipId, sentAt, unread: isUnread } of activities) {
      if (!isUnread) continue;
      const active = friendshipId === activeFriendshipRef.current?.friendship_id;
      const seenHere = legacy[friendshipId] && new Date(legacy[friendshipId]) >= new Date(sentAt);
      // The swap that's open right now is being looked at, so it's read
      if (active || seenHere) markRead(friendshipId);
      else unread.add(friendshipId);
    }
    try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
    setUnreadFriendships(unread);
  };

  // A swap's history, the friend's current song, and the song you sent.
  // Each is undefined if its request failed.
  const fetchSwap = async (friendshipId) => {
    const get = (what) => fetch(`/api/friends/${friendshipId}/${what}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : undefined)).catch(() => undefined);
    const [hist, cur, mine] = await Promise.all([get('history'), get('current-song'), get('my-song')]);
    const received = cur === undefined ? undefined : (cur && cur.sentBy !== userRef.current?.name ? cur : null);
    return { hist, received, mine };
  };

  // Re-fetch the open swap after coming back to the tab or reconnecting, since
  // songs sent while the phone slept or the socket was down were missed.
  // Leaves a link you're typing or a verified-but-unsent song alone.
  const refreshActiveSwap = async () => {
    const id = activeFriendshipRef.current?.friendship_id;
    if (!id) return;
    const { hist, received, mine } = await fetchSwap(id);
    if (activeFriendshipRef.current?.friendship_id !== id) return; // switched friends meanwhile
    if (hist) setHistory(hist);
    if (received !== undefined) setReceivedSong(received);
    if (mine !== undefined && !songLinkRef.current.trim()) {
      setSongDetails(prev => (prev && !prev.id ? prev : mine));
    }
  };
  useEffect(() => { refreshActiveSwapRef.current = refreshActiveSwap; });
  useEffect(() => { songLinkRef.current = songLink; }, [songLink]);

  const selectFriend = async (friendship) => {
    const freshFriends = await loadFriends();
    const fresh = freshFriends.find(f => f.friendship_id === friendship.friendship_id) ?? friendship;
    setActiveFriendship(fresh);
    activeFriendshipRef.current = fresh;
    setShowSettings(false);
    if (window.innerWidth <= 700) setSidebarOpen(false);
    setSongLink('');
    setSongDetails(null);
    setVerifyError('');
    setDuplicate(null);
    setReceivedSong(null);
    setHistory([]);
    markRead(friendship.friendship_id);

    socket.emit('join-friendship', friendship.friendship_id);
    const { hist, received, mine } = await fetchSwap(friendship.friendship_id);
    if (hist) setHistory(hist);
    if (received) setReceivedSong(received);
    if (mine) setSongDetails(mine);
    const shared = pendingShareRef.current;
    if (shared) {
      pendingShareRef.current = null;
      setPendingShare(null);
      clearPendingShare();
      setSongLink(shared);
      verifySong(shared);
    }
  };

  const PLATFORM_PRIORITY = ['spotify', 'appleMusic', 'youtubeMusic', 'amazonMusic', 'tidal', 'deezer'];

  const buildSearchUrl = (platform, title, artist) => {
    const q = encodeURIComponent(`${title} ${artist}`);
    switch (platform) {
      case 'spotify':       return `https://open.spotify.com/search/${q}`;
      case 'appleMusic':    return `https://music.apple.com/search?term=${q}`;
      case 'youtubeMusic':  return `https://music.youtube.com/search?q=${q}`;
      case 'tidal':         return `https://listen.tidal.com/search?q=${q}`;
      case 'deezer':        return `https://www.deezer.com/search/${q}`;
      case 'amazonMusic':   return `https://music.amazon.com/search/${q}`;
      default:              return null;
    }
  };

  const openWithLinks = (platformLinks, song) => {
    const preferred = platformLinks[preferredPlatform];
    if (preferred?.url) {
      if (preferredPlatform === 'spotify' && preferred.nativeAppUriMobile) {
        window.location.href = preferred.nativeAppUriMobile;
        setTimeout(() => window.open(preferred.url, '_blank'), 1000);
      } else {
        window.open(preferred.url, '_blank');
      }
      return;
    }
    // Preferred platform not in API response — use search URL if we have metadata
    if (song?.title && song?.artist) {
      const searchUrl = buildSearchUrl(preferredPlatform, song.title, song.artist);
      if (searchUrl) { window.open(searchUrl, '_blank'); return; }
    }
    // Final fallback: best available direct link
    for (const p of PLATFORM_PRIORITY) {
      const link = platformLinks[p];
      if (link?.url) { window.open(link.url, '_blank'); return; }
    }
    if (song?.odesliPageUrl) window.open(song.odesliPageUrl, '_blank');
  };

  const openSong = async (song) => {
    if (!song) return;
    if (song.platformLinks) {
      openWithLinks(song.platformLinks, song);
      return;
    }
    // Legacy song (no platformLinks) — re-resolve via /api/verify if user prefers non-Spotify
    if (preferredPlatform !== 'spotify' && song.spotifyUrl) {
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ link: song.spotifyUrl }),
        });
        if (res.ok) {
          const resolved = await res.json();
          if (resolved.platformLinks) { openWithLinks(resolved.platformLinks, { ...resolved, ...song }); return; }
        }
      } catch { /* lookup failed — fall back to Spotify below */ }
    }
    // Fallback: open in Spotify
    if (song.spotifyUri) window.location.href = song.spotifyUri;
    setTimeout(() => { if (song.spotifyUrl) window.open(song.spotifyUrl, '_blank'); }, 1000);
  };

  // Called with a link (on paste) or with a click/key event (uses the input's value)
  const verifySong = async (linkArg) => {
    const link = (typeof linkArg === 'string' ? linkArg : songLink).trim();
    if (!link) return;
    const reqId = ++verifyReqRef.current;
    setVerifyError('');
    setSongDetails(null);
    setVerifying(true);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ link }),
      });
      // A proxy error page (Cloudflare/Railway) isn't JSON — don't mistake that for a network failure
      const data = await res.json().catch(() => ({}));
      if (reqId !== verifyReqRef.current) return;
      if (!res.ok) {
        if (res.status === 401) setVerifyError('Your session expired — log in again');
        else if (data.error) setVerifyError(data.error);
        else if (res.status >= 500) setVerifyError(`Server error (${res.status}) — try again in a moment`);
        else setVerifyError('Could not find that song');
        return;
      }
      setSongDetails(data);
    } catch {
      if (reqId === verifyReqRef.current) setVerifyError('Network error — check your connection');
    } finally {
      if (reqId === verifyReqRef.current) setVerifying(false);
    }
  };

  const sendSong = () => {
    if (!songDetails || !activeFriendship) return;
    setDuplicate(null);
    setVerifyError('');
    socket.emit('send-song', { song: songDetails, friendshipId: activeFriendship.friendship_id });
  };

  // Called with a code (from an invite link) or from the Add button (uses the input)
  const addFriend = async (codeArg) => {
    const code = typeof codeArg === 'string' ? codeArg : addCodeInput;
    setAddCodeError('');
    setAddCodeSuccess('');
    const r = await fetch('/api/friends/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ friendCode: code }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) { setAddCodeSuccess(data.message); setAddCodeInput(''); loadRequests(); }
    else setAddCodeError(data.error || 'Could not add that friend');
  };

  const applyRating = ({ id, rating }) => {
    setHistory(prev => prev.map(e => (e.id === id ? { ...e, rating } : e)));
    setReceivedSong(prev => (prev?.id === id ? { ...prev, rating } : prev));
    setSongDetails(prev => (prev?.id === id ? { ...prev, rating } : prev));
  };

  const rateSong = async (entry, rating) => {
    const previous = entry.rating ?? null;
    applyRating({ id: entry.id, rating }); // optimistic
    try {
      const r = await fetch(`/api/songs/${entry.id}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating }),
      });
      if (!r.ok) throw new Error();
    } catch {
      applyRating({ id: entry.id, rating: previous });
      setVerifyError('Could not save your rating — try again');
    }
  };

  const removeFriend = async () => {
    const f = activeFriendship;
    if (!f) return;
    if (!window.confirm(`Remove ${f.friend_name}? This permanently deletes your whole swap history with them.`)) return;
    const r = await fetch(`/api/friends/${f.friendship_id}`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) { setVerifyError('Could not remove friend — try again'); return; }
    closeFriendship(f.friendship_id);
  };

  // Leave a friendship's view after it's removed (by either person)
  const closeFriendship = (friendshipId) => {
    setUnreadFriendships(prev => { const next = new Set(prev); next.delete(friendshipId); return next; });
    if (activeFriendshipRef.current?.friendship_id === friendshipId) {
      activeFriendshipRef.current = null;
      setActiveFriendship(null);
      setHistory([]);
      setReceivedSong(null);
      setSongDetails(null);
    }
    loadFriends();
  };

  const shareInvite = async () => {
    const url = `${window.location.origin}/add/${user.friend_code}`;
    // Phones get the native share sheet; desktops copy to the clipboard
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'Song Swap', text: 'Swap songs with me on Song Swap', url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch { window.prompt('Copy your invite link:', url); }
  };

  // Back to the dashboard
  const goHome = () => {
    activeFriendshipRef.current = null;
    setActiveFriendship(null);
    setShowSettings(false);
    setSongLink('');
    setSongDetails(null);
    setReceivedSong(null);
    setHistory([]);
    setVerifyError('');
    setDuplicate(null);
    if (window.innerWidth <= 700) setSidebarOpen(false);
  };

  const openFriendById = (friendshipId) => {
    const f = friends.find(x => x.friendship_id === friendshipId);
    if (f) selectFriend(f);
  };

  const acceptRequest = async (id) => {
    await fetch(`/api/friends/accept/${id}`, { method: 'POST', credentials: 'include' });
    await Promise.all([loadFriends(), loadRequests()]);
  };

  const declineRequest = async (id) => {
    await fetch(`/api/friends/requests/${id}`, { method: 'DELETE', credentials: 'include' });
    await loadRequests();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(user.friend_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Back to the logged-out screen (after logout, account deletion, or being
  // signed out by a password reset)
  const clearSession = () => {
    setUser(null);
    setShowSettings(false);
    // Clear the ref too, or the next account to log in on this tab inherits
    // the old open swap and it gets marked read for them
    activeFriendshipRef.current = null;
    setActiveFriendship(null);
    setUnreadFriendships(new Set());
  };
  useEffect(() => { clearSessionRef.current = clearSession; });
  // Stop this device's notifications first, while the session still exists
  const logout = () => disablePush()
    .finally(() => fetch('/api/logout', { method: 'POST', credentials: 'include' }))
    .then(clearSession);

  // Open a swap by id (notification tap while the app is already open)
  const openSwapById = (friendshipId) => {
    const f = friends.find(x => x.friendship_id === friendshipId);
    if (f) selectFriend(f);
    else { pendingSwapRef.current = friendshipId; loadFriends().then(list => { const g = list.find(x => x.friendship_id === friendshipId); if (g) { pendingSwapRef.current = null; selectFriend(g); } }); }
  };

  // Typing in the send box: drop any lookup in flight for the old text
  const handleLinkChange = (value) => {
    verifyReqRef.current++;
    setVerifying(false);
    setSongLink(value);
    setSongDetails(null);
    setDuplicate(null);
    setVerifyError('');
  };
  // Pasting a link into an empty box looks it up right away
  const handleLinkPaste = (text) => {
    setSongLink(text);
    setDuplicate(null);
    verifySong(text);
  };

  const changePlatform = (platform) => {
    setPreferredPlatform(platform);
    fetch('/api/me/preferred-platform', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ platform }),
    });
  };

  const cancelShare = () => { pendingShareRef.current = null; setPendingShare(null); clearPendingShare(); };

  // The Admin button opens Settings at the admin tools
  const openAdmin = () => {
    setShowSettings(true);
    setTimeout(() => document.getElementById('settings-admin')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ── Effects (after the functions they use) ──

  // Service worker (for push notifications) + taps on notifications while open
  useEffect(() => {
    registerServiceWorker();
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e) => {
      if (e.data?.type !== 'open-url') return;
      const id = Number(new URLSearchParams(e.data.url.split('?')[1] || '').get('swap'));
      if (id) openSwapRef.current(id);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => { openSwapRef.current = openSwapById; });

  // Load the logged-in user once on start
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadMe(); }, []);

  // Unread count in the tab title, plus a red pip on the favicon
  useEffect(() => {
    const count = unreadFriendships.size;
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
    setFaviconPip(count > 0);
  }, [unreadFriendships]);

  // Coming back to the tab: re-sync unread status from the server. Phones pause
  // background tabs and drop the socket, so live events (new swaps, reads on
  // other devices) can be missed. This also marks the open swap as read, if a
  // song arrived for it while the tab was hidden.
  useEffect(() => {
    const onVisible = () => {
      // The server skips push notifications while a tab is on screen
      socket.emit('visibility', document.visibilityState === 'visible');
      if (document.visibilityState !== 'visible' || !userRef.current) return;
      loadUnreadStatus(userRef.current);
      refreshActiveSwapRef.current();
      setDashTick(t => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // loadUnreadStatus only uses state setters, refs and fetch, so a stale copy is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the Settings page
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowSettings(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings]);

  // On login (or a new user object): load lists, apply a pending invite/share,
  // and reconnect the socket with the session cookie
  useEffect(() => {
    userRef.current = user;
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFriends();
    loadRequests();
    loadUnreadStatus(user);
    // Shared a song into the app: with one friend, open them straight away;
    // otherwise show the friends list and fill it in once one is picked
    if (pendingSwapRef.current) {
      const id = pendingSwapRef.current;
      pendingSwapRef.current = null;
      loadFriends().then(list => {
        const f = list.find(x => x.friendship_id === id);
        if (f) selectFriend(f);
      });
    } else if (pendingShareRef.current) {
      loadFriends().then(list => {
        if (list.length === 1) selectFriend(list[0]);
        else setSidebarOpen(true);
      });
    }
    if (pendingInvite) {
      clearPendingInvite();
      setPendingInvite(null);
      if (pendingInvite !== user.friend_code) {
        setSidebarOpen(true);
        addFriend(pendingInvite);
      }
    }
    // The socket connects at page load, possibly before login, so reconnect to
    // send the session cookie. Rooms are rejoined on every (re)connect.
    const joinRooms = () => {
      socket.emit('join-user');
      socket.emit('visibility', document.visibilityState === 'visible');
      if (activeFriendshipRef.current) socket.emit('join-friendship', activeFriendshipRef.current.friendship_id);
      // Catch up on anything sent while disconnected (server restart, phone sleep)
      loadUnreadStatus(user);
      refreshActiveSwapRef.current();
    };
    socket.on('connect', joinRooms);
    socket.disconnect().connect();
    return () => socket.off('connect', joinRooms);
    // Runs per login only; the loaders it calls just fetch and set state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    socket.on('song-received', (song) => {
      if (song.friendshipId === activeFriendshipRef.current?.friendship_id) setReceivedSong(song);
    });
    socket.on('swap-received', ({ friendshipId, sentAt }) => {
      bumpActivity(friendshipId, sentAt);
      const viewing = friendshipId === activeFriendshipRef.current?.friendship_id
        && document.visibilityState === 'visible';
      if (viewing) markRead(friendshipId);
      else setUnreadFriendships(prev => prev.has(friendshipId) ? prev : new Set(prev).add(friendshipId));
    });
    socket.on('swap-read', ({ friendshipId }) => removeUnread(friendshipId));
    // Account deleted on another device, or password reset by an admin
    socket.on('force-logout', () => clearSessionRef.current());
    socket.on('song-cleared', () => { setReceivedSong(null); setDashTick(t => t + 1); });
    // Ratings change the match %, which comes with the friends list
    socket.on('song-rated', (u) => { applyRating(u); loadFriends(); });
    socket.on('all-songs-cleared', () => { setReceivedSong(null); setSongDetails(null); });
    socket.on('send-success', () => { setSent(true); setTimeout(() => { setSent(false); setSongLink(''); }, 1500); });
    socket.on('duplicate-song', (entry) => { setDuplicate(entry); setDenied(true); setTimeout(() => setDenied(false), 1500); });
    socket.on('send-error', ({ error }) => setVerifyError(error || 'Could not send that song'));
    socket.on('history-updated', (entry) => {
      bumpActivity(entry.friendshipId, entry.sentAt);
      if (entry.friendshipId === activeFriendshipRef.current?.friendship_id) {
        setHistory(prev => [entry, ...prev]);
        if (entry.sentBy === userRef.current?.name) {
          setSongDetails(prev => (prev && !prev.id && prev.title === entry.title ? { ...prev, id: entry.id, rating: null } : prev));
        }
        // Unread handling for incoming songs is done by swap-received, which
        // knows whether the tab is hidden; only mark read if it's being looked at
        if (entry.sentBy !== userRef.current?.name && document.visibilityState === 'visible') {
          markRead(entry.friendshipId);
        }
      } else if (entry.sentBy !== userRef.current?.name) {
        setUnreadFriendships(prev => new Set([...prev, entry.friendshipId]));
      }
    });
    socket.on('history-cleared', () => setHistory([]));
    socket.on('friend-request-received', () => loadRequests());
    socket.on('friendship-accepted', () => { loadFriends(); loadRequests(); });
    // A friend changed their name or picture: refresh lists and the open swap
    socket.on('friend-updated', async () => {
      const list = await loadFriends();
      loadRequests();
      const active = activeFriendshipRef.current && list.find(f => f.friendship_id === activeFriendshipRef.current.friendship_id);
      if (active) { activeFriendshipRef.current = active; setActiveFriendship(active); }
      refreshActiveSwapRef.current();
    });
    // You changed your name/picture in another tab
    socket.on('me-updated', () => loadMe());
    socket.on('friendship-removed', ({ friendshipId }) => closeFriendship(friendshipId));
    socket.on('friend-request-declined', () => loadRequests());
    return () => {
      socket.off('song-received');
      socket.off('swap-received');
      socket.off('swap-read');
      socket.off('force-logout');
      socket.off('song-cleared');
      socket.off('song-rated');
      socket.off('all-songs-cleared');
      socket.off('send-success');
      socket.off('duplicate-song');
      socket.off('send-error');
      socket.off('history-updated');
      socket.off('history-cleared');
      socket.off('friend-request-received');
      socket.off('friendship-accepted');
      socket.off('friend-updated');
      socket.off('me-updated');
      socket.off('friendship-removed');
      socket.off('friend-request-declined');
    };
    // Subscribed once; handlers read live values through refs and state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user === undefined) return null;

  if (!user && !showAuth) return (
    <LandingPage
      onLogin={() => { setAuthMode('login'); setShowAuth(true); }}
      onSignup={() => { setAuthMode('register'); setShowAuth(true); }}
    />
  );

  if (!user) return (
    <AuthScreen
      authMode={authMode}
      onModeChange={setAuthMode}
      pendingInvite={pendingInvite}
      onLoggedIn={loadMe}
      onBack={() => setShowAuth(false)}
    />
  );

  const activeMatch = activeFriendship && friends.find(f => f.friendship_id === activeFriendship.friendship_id)?.match;

  return (
    <div id="screen">
      <Header
        user={user}
        unreadCount={unreadFriendships.size}
        showSettings={showSettings}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
        onHome={goHome}
        onToggleSettings={() => setShowSettings(v => !v)}
        onOpenAdmin={openAdmin}
        onLogout={logout}
      />

      <div id="app-body">
        <Sidebar
          user={user}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          copied={copied}
          onCopyCode={copyCode}
          inviteCopied={inviteCopied}
          onShareInvite={shareInvite}
          addCode={addCodeInput}
          onAddCodeChange={v => { setAddCodeInput(v); setAddCodeError(''); setAddCodeSuccess(''); }}
          onAddFriend={addFriend}
          addCodeError={addCodeError}
          addCodeSuccess={addCodeSuccess}
          friendRequests={friendRequests}
          sentRequests={sentRequests}
          onAccept={acceptRequest}
          onDecline={declineRequest}
          friends={friends}
          activeFriendshipId={activeFriendship?.friendship_id}
          unread={unreadFriendships}
          onSelectFriend={selectFriend}
        />

        <main id="main-content">
          {showSettings ? (
            <SettingsPage
              user={user}
              onBack={() => setShowSettings(false)}
              onProfileChanged={loadMe}
              preferredPlatform={preferredPlatform}
              onPlatformChange={changePlatform}
              onAccountDeleted={clearSession}
            />
          ) : !activeFriendship && friends.length === 0 ? (
            <Onboarding
              user={user}
              inviteCopied={inviteCopied}
              onInvite={shareInvite}
              sentRequests={sentRequests}
              friendRequests={friendRequests}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
          ) : !activeFriendship ? (
            <Dashboard
              user={user}
              friends={friends}
              friendCount={friends.length}
              friendRequests={friendRequests}
              sentRequests={sentRequests}
              refreshKey={`${[...unreadFriendships].sort().join()}|${friends.map(f => f.last_activity).join()}|${dashTick}`}
              onOpenFriend={openFriendById}
              onOpenSong={openSong}
              onAccept={acceptRequest}
              onDecline={declineRequest}
              onInvite={shareInvite}
              inviteCopied={inviteCopied}
              pendingShare={pendingShare}
              onCancelShare={cancelShare}
            />
          ) : (
            <SwapPage
              user={user}
              friendship={activeFriendship}
              match={activeMatch}
              history={history}
              songDetails={songDetails}
              receivedSong={receivedSong}
              songLink={songLink}
              sent={sent}
              denied={denied}
              verifying={verifying}
              verifyError={verifyError}
              duplicate={duplicate}
              onLinkChange={handleLinkChange}
              onLinkPaste={handleLinkPaste}
              onVerify={verifySong}
              onSend={sendSong}
              onOpenSong={openSong}
              onRate={rateSong}
              onRemove={removeFriend}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
