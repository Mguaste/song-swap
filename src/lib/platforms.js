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
