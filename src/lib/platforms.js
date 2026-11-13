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

export const openSpotify = (webUrl, appUri) => {
  // No web fallback: the page can't tell the app opening from the browser's
  // own "choose an app" dialog, so a fallback would open Spotify twice.
  if (appUri && !isPhone() && getSpotifyOpen() === 'app') {
    window.location.href = appUri;
    return;
  }
  if (webUrl) window.open(webUrl, '_blank');
};
