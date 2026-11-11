import { useState } from 'react';

// 1–5 stars. Interactive when onRate is given, otherwise display-only.
export function StarRating({ value, onRate, className = '' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  if (!onRate) {
    return (
      <span className={`star-rating readonly ${className}`} aria-label={value ? `Rated ${value} out of 5` : 'Not rated yet'}>
        {[1, 2, 3, 4, 5].map(n => <span key={n} className={`star${n <= shown ? ' on' : ''}`}>★</span>)}
      </span>
    );
  }
  return (
    <span
      className={`star-rating ${className}`}
      role="radiogroup"
      aria-label="Rate this song"
      onMouseLeave={() => setHover(0)}
      onClick={e => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={`star${n <= shown ? ' on' : ''}`}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onRate(n)}
        >★</button>
      ))}
    </span>
  );
}
