import icon from '../assets/SSLogo.png';
import { ShareSongCard } from './ShareSongCard';

// Shown instead of the dashboard until you have a friend
export function Onboarding({ user, inviteCopied, onInvite, sentRequests, friendRequests, onOpenSidebar }) {
  return (
    <div id="empty-state" className="onboarding">
      <img src={icon} id="empty-logo" alt="icon" />
      <h2 id="onboarding-title">Swap songs with a friend</h2>
      <ol id="onboarding-steps">
        <li><span className="step-title">Share your link</span><span className="step-sub">Send it to a friend</span></li>
        <li><span className="step-title">They sign up</span><span className="step-sub">Then you accept</span></li>
        <li><span className="step-title">Swap a song</span><span className="step-sub">From any music app</span></li>
      </ol>
      <button id="onboarding-invite-btn" onClick={onInvite}>
        {inviteCopied ? '✓ Invite link copied' : 'Share invite link'}
      </button>
      <p id="onboarding-code">
        or give them your code <span>{user.friend_code}</span>
      </p>
      {sentRequests.length > 0 && (
        <p id="onboarding-waiting">
          Waiting on {sentRequests.map(r => r.to_name).join(', ')} to accept
        </p>
      )}
      <ShareSongCard />
      {friendRequests.length > 0 && (
        <button className="link-btn" onClick={onOpenSidebar}>
          You have {friendRequests.length} friend request{friendRequests.length > 1 ? 's' : ''} — open sidebar
        </button>
      )}
    </div>
  );
}
