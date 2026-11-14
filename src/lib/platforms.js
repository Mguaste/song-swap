// Music platforms the app can open songs in, in display order
export const PLATFORMS = [
  ['spotify', 'Spotify'], ['appleMusic', 'Apple Music'], ['youtubeMusic', 'YouTube Music'],
  ['amazonMusic', 'Amazon Music'], ['tidal', 'Tidal'], ['deezer', 'Deezer'],
];

// A search page on the platform, for when we don't have a direct link
// (Amazon Music has no public API, so it's always a search)
export const buildSearchUrl = (platform, title, artist) => {
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

// ── Spotify: browser or desktop app (saved per device) ──
// A website can't tell whether the Spotify desktop app is installed, and a
// spotify: link without it makes the browser ask which app to use, so the
// app is opt-in. Phones hand open.spotify.com links to the app on their own.
const SPOTIFY_OPEN_KEY = 'spotifyOpen';
export const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS
export const getSpotifyOpen = () => {
  try { return localStorage.getItem(SPOTIFY_OPEN_KEY) === 'app' ? 'app' : 'web'; } catch { return 'web'; }
};
export const setSpotifyOpen = (value) => {
  try { localStorage.setItem(SPOTIFY_OPEN_KEY, value); } catch { /* not saved; stays browser */ }
};

// Installed to the iPhone home screen (iOS only sets navigator.standalone)
const isIOSInstalled = () => navigator.standalone === true;

// In the installed iPhone app, a web link opens a browser sheet that hands the
// song to Spotify and then stays behind as a blank white screen. The spotify:
// link switches to the app directly. If nothing took us away (Spotify not
// installed), go to the web link instead.
const openAppWithWebFallback = (appUri, webUrl) => {
  let left = false;
  const onLeave = () => { left = true; };
  const onVisibility = () => { if (document.visibilityState === 'hidden') left = true; };
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('blur', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  window.location.href = appUri;
  setTimeout(() => {
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    if (!left && document.visibilityState === 'visible' && webUrl) window.location.href = webUrl;
  }, 1500);
};

// Installed iPhone app, no app link for this service: the web link opens a
// browser sheet that may hand off to the music app and stay behind blank.
// Close it when the person comes back to Song Swap.
const openWebClosingOnReturn = (url) => {
  const sheet = window.open(url, '_blank');
  if (!sheet) return;
  let away = false;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') { away = true; return; }
    if (!away) return;
    document.removeEventListener('visibilitychange', onVisibility);
    try { sheet.close(); } catch { /* already closed */ }
  };
  document.addEventListener('visibilitychange', onVisibility);
};

const openWeb = (url) => {
  if (!url) return;
  if (isIOSInstalled()) openWebClosingOnReturn(url);
  else window.open(url, '_blank');
};

// spotify:track:<id> from an open.spotify.com track link, when we weren't given one
const spotifyUriFromUrl = (url) => {
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i.exec(url || '');
  return m ? `spotify:${m[1].toLowerCase()}:${m[2]}` : null;
};

export const openSpotify = (webUrl, appUri) => {
  if (isIOSInstalled()) {
    const uri = appUri || spotifyUriFromUrl(webUrl);
    if (uri) openAppWithWebFallback(uri, webUrl);
    else openWeb(webUrl); // e.g. a search link
    return;
  }
  // No web fallback: the page can't tell the app opening from the browser's
  // own "choose an app" dialog, so a fallback would open Spotify twice.
  if (appUri && !isPhone() && getSpotifyOpen() === 'app') {
    window.location.href = appUri;
    return;
  }
  openWeb(webUrl);
};

// App links for a song's web link, used in the installed iPhone app. Only
// Apple Music's is documented; Tidal's and Deezer's are the commonly used
// forms, and the web fallback covers them if the app doesn't open.
// Amazon Music has no known app link.
const iosAppUri = (platform, url) => {
  let m;
  if (platform === 'appleMusic' && /^https:\/\/music\.apple\.com\//i.test(url) && !/\/search\b/i.test(url)) {
    return url.replace(/^https:/i, 'music:');
  }
  if (platform === 'tidal' && (m = /tidal\.com\/(?:browse\/)?track\/(\d+)/i.exec(url))) {
    return `tidal://track/${m[1]}`;
  }
  if (platform === 'deezer' && (m = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/(\d+)/i.exec(url))) {
    return `deezer://www.deezer.com/track/${m[1]}`;
  }
  // Undocumented; the YouTube Music app registers youtubemusic:, and this
  // mirrors the music.youtube.com link the way music: does for Apple Music.
  if (platform === 'youtubeMusic' && (m = /music\.youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/i.exec(url))) {
    return `youtubemusic://music.youtube.com/watch?v=${m[1]}`;
  }
  return null;
};

// Open any song or search link. In the installed iPhone app, Spotify, Apple
// Music, Tidal and Deezer switch straight to their apps, and other links'
// browser sheets close when you come back. Elsewhere: a new tab, which phones
// hand to the installed app.
export const openSongLink = (platform, url, appUri) => {
  if (!url) return;
  if (platform === 'spotify') return openSpotify(url, appUri);
  const uri = isIOSInstalled() ? iosAppUri(platform, url) : null;
  if (uri) openAppWithWebFallback(uri, url);
  else openWeb(url);
};
