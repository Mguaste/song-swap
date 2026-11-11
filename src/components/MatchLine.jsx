// "75% match · you both sent Frank Ocean", or how far off a match is
export function MatchLine({ match }) {
  if (!match) return null;
  if (!match.ready) {
    const parts = [];
    if (match.songsNeeded) parts.push(`swap ${match.songsNeeded} more song${match.songsNeeded > 1 ? 's' : ''}`);
    if (match.ratingsNeeded) parts.push(`rate ${match.ratingsNeeded} more`);
    const text = parts.join(' and ');
    return <p className="match-line pending">{text.charAt(0).toUpperCase() + text.slice(1)} to see your match</p>;
  }
  const detail = match.sharedArtists?.length
    ? `you both sent ${match.sharedArtists.join(', ')}`
    : [match.youGive && `you rate theirs ${match.youGive}★`, match.theyGive && `they rate yours ${match.theyGive}★`].filter(Boolean).join(' · ');
  return (
    <p className="match-line" title="80% from how you rate each other's songs, 20% from artists you both send">
      <strong>{match.percent}% match</strong>{detail ? ` · ${detail}` : ''}
    </p>
  );
}
