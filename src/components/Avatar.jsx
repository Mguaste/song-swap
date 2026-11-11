import { useState } from 'react';

// Profile picture, or the first letter of the name when there isn't one
export function Avatar({ userId, avatarAt, name, className = '' }) {
  const [failedFor, setFailedFor] = useState(null);
  if (userId && avatarAt && failedFor !== avatarAt) {
    return <img className={`friend-avatar avatar-img ${className}`} alt=""
      src={`/api/avatars/${userId}?v=${encodeURIComponent(avatarAt)}`} onError={() => setFailedFor(avatarAt)} />;
  }
  return <span className={`friend-avatar ${className}`}>{(name?.[0] ?? '?').toUpperCase()}</span>;
}
