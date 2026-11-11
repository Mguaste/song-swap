import { Avatar } from './Avatar';
import { StarRating } from './StarRating';
import { AlbumArtPlaceholder } from './AlbumArtPlaceholder';
import { MatchLine } from './MatchLine';
import { timeAgo } from '../lib/format';

// One friend's swap: header, Send and Receive cards, history
export function SwapPage({
  user, friendship, match, history, songDetails, receivedSong,
  songLink, sent, denied, verifying, verifyError, duplicate,
  onLinkChange, onLinkPaste, onVerify, onSend, onOpenSong, onRate, onRemove,
}) {
  return (
    <>
      <div id="swap-header">
        <Avatar userId={friendship.friend_id} avatarAt={friendship.friend_avatar_at}
          name={friendship.friend_name} className="avatar-swap" />
        <div className="swap-header-text">
          <h2 className="page-heading">{friendship.friend_name}</h2>
          <p className="swap-header-sub">
            {history.length > 0
              ? `${history.length} song${history.length > 1 ? 's' : ''} swapped · last ${timeAgo(history[0].sentAt)}`
              : 'No songs swapped yet — send the first one'}
          </p>
          <MatchLine match={match} />
        </div>
      </div>
      <div id="song-swap-main">
        <div className="song-cont">
          <h2 className="song-cont-title">Send</h2>
          <div className="song-info" onClick={() => onOpenSong(songDetails)} style={songDetails ? { cursor: 'pointer' } : {}}>
            <div className={`send-art-wrapper${sent ? ' sending' : ''}${denied ? ' denied' : ''}`}>
              <div className="send-art-inner">
                {songDetails
                  ? <img className="album-art" src={songDetails.albumArt} alt="Album Art" />
                  : <AlbumArtPlaceholder />
                }
              </div>
              <div className="send-art-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40%" height="40%">
                  <polyline points="4 12 9 17 20 6" />
                </svg>
              </div>
              <div className="send-art-deny">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="40%" height="40%">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
            </div>
            <h3>{songDetails ? songDetails.title : 'Song Title'}</h3>
            <p>Artist: {songDetails ? songDetails.artist : 'Artist Name'}</p>
            <p>Album: {songDetails ? songDetails.album : 'Album Name'}</p>
            {songDetails?.id && (
              <p className="card-rating">
                {songDetails.rating
                  ? <>{friendship.friend_name} rated it <StarRating value={songDetails.rating} /></>
                  : <span className="rating-pending">Not rated yet</span>}
              </p>
            )}
          </div>
          <div className="input-group">
            <input
              placeholder="Paste a music link..."
              value={songLink}
              onChange={e => onLinkChange(e.target.value)}
              onPaste={e => {
                // Look the song up as soon as a link is pasted into an empty box
                const text = e.clipboardData.getData('text').trim();
                if (songLink.trim() || !/^(https?:\/\/|spotify:)/i.test(text)) return;
                e.preventDefault();
                onLinkPaste(text);
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !verifying) (songDetails ? onSend() : onVerify()); }}
            />
            <button onClick={() => (songDetails ? onSend() : onVerify())} disabled={sent || denied || verifying}>
              {verifying ? 'Checking…' : songDetails ? 'Send' : 'Verify'}
            </button>
          </div>
          {verifyError && <p id="duplicate-warning">{verifyError}</p>}
          {duplicate && (
            <p id="duplicate-warning">
              Already sent on {new Date(duplicate.sentAt).toLocaleDateString()} by {duplicate.sentBy}
            </p>
          )}
        </div>

        <div className="song-cont">
          <h2 className="song-cont-title">Receive</h2>
          <div className="song-info" onClick={() => onOpenSong(receivedSong)} style={receivedSong ? { cursor: 'pointer' } : {}}>
            {receivedSong
              ? <img className="album-art" src={receivedSong.albumArt} alt="Album Art" />
              : <AlbumArtPlaceholder />
            }
            <h3>{receivedSong ? receivedSong.title : 'Song Title'}</h3>
            <p>Artist: {receivedSong ? receivedSong.artist : 'Artist Name'}</p>
            <p>Album: {receivedSong ? receivedSong.album : 'Album Name'}</p>
            {receivedSong?.id && (
              <div className="card-rating">
                <StarRating value={receivedSong.rating} onRate={n => onRate(receivedSong, n)} className="large" />
                <span className="rating-pending">{receivedSong.rating ? 'Your rating' : 'Rate this song'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div id="history">
          <h2 id="history-title">History</h2>
          <div id="history-list">
            {history.map((entry, i) => (
              <div key={entry.id ?? i} className="history-entry" onClick={() => onOpenSong(entry)}>
                <span className="history-index">{history.length - i}</span>
                <img src={entry.albumArt} alt="art" className="history-art" />
                <div className="history-info">
                  <span className="history-song">{entry.title}</span>
                  <span className="history-meta">{entry.artist} · {entry.sentBy} · {new Date(entry.sentAt).toLocaleDateString()}</span>
                </div>
                {entry.id && (entry.sentBy === user.name
                  ? <StarRating value={entry.rating} className="history-stars" />
                  : <StarRating value={entry.rating} onRate={n => onRate(entry, n)} className="history-stars" />)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div id="remove-friend-row">
        <button id="remove-friend-btn" onClick={onRemove}>Remove {friendship.friend_name}</button>
      </div>
    </>
  );
}
