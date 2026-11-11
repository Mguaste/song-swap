import io from 'socket.io-client';

// One shared connection for the whole app
export const socket = io();

// After a deploy, tabs that were already open keep running the old code until
// reloaded. The server sends its build id on every socket connect; if it's not
// the bundle this tab loaded, reload — right away if nothing is typed into the
// song box, otherwise as soon as the tab is hidden.
const LOADED_BUILD = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src') ?? null;
let reloadPending = false;
socket.on('build-id', (serverBuild) => {
  if (!LOADED_BUILD || !serverBuild || serverBuild === LOADED_BUILD || reloadPending) return;
  reloadPending = true;
  const typing = document.querySelector('input:focus, textarea:focus') || [...document.querySelectorAll('input')].some(i => i.type !== 'password' && i.value);
  if (document.visibilityState === 'hidden' || !typing) { window.location.reload(); return; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window.location.reload();
  });
});
