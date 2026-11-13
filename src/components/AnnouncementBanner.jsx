import { useEffect, useState } from 'react';

// A memo from the admin, shown once: closing it (or using its button) marks
// it read on the server, so it doesn't come back on other devices either.
export function AnnouncementBanner({ refreshKey, onOpenSettings }) {
  const [memo, setMemo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/announcements', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setMemo(d?.announcement ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!memo) return null;

  const dismiss = async () => {
    setMemo(null);
    await fetch(`/api/announcements/${memo.id}/dismiss`, { method: 'POST', credentials: 'include' }).catch(() => {});
    // Show the next one, if several are waiting
    const d = await fetch('/api/announcements', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setMemo(d?.announcement ?? null);
  };

  return (
    <div className="announcement" role="status">
      <p className="announcement-text">{memo.message}</p>
      {memo.action === 'settings' && (
        <button className="announcement-action" onClick={() => { dismiss(); onOpenSettings(); }}>Open Settings</button>
      )}
      <button className="announcement-close" onClick={dismiss} aria-label="Close message">×</button>
    </div>
  );
}
