export const BASE_TITLE = document.title;

const FAVICON_URL = '/swap-favicon.png';
let faviconWithPip = null; // data URL, drawn once on first use

// Swap the tab icon between the plain favicon and one with a red unread pip
export function setFaviconPip(on) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (!on) { link.href = FAVICON_URL; return; }
  if (faviconWithPip) { link.href = faviconWithPip; return; }
  const img = new Image();
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size * 0.76, size * 0.24, size * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = '#121212';
    ctx.stroke();
    faviconWithPip = canvas.toDataURL('image/png');
    // Only apply if there's still something unread by the time it loaded
    if (document.title !== BASE_TITLE) link.href = faviconWithPip;
  };
  img.src = FAVICON_URL;
}
