// Light/dark theme, saved per device. index.html applies it before the first
// paint (same key) so the page doesn't flash the wrong colors on load.
const THEME_KEY = 'theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

export const getThemeChoice = () => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch { return 'dark'; }
};

const resolve = (choice) => (choice === 'system' ? (media.matches ? 'light' : 'dark') : choice);

export const applyTheme = (choice = getThemeChoice()) => {
  document.documentElement.dataset.theme = resolve(choice);
};

export const setThemeChoice = (choice) => {
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* not saved; applies this visit only */ }
  applyTheme(choice);
};

// Follow the OS when "Match device" is picked
media.addEventListener?.('change', () => { if (getThemeChoice() === 'system') applyTheme('system'); });
