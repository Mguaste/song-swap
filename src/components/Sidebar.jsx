import { Avatar } from './Avatar';

// Friend code, add friend, requests and the friends list (most recent first)
export function Sidebar({
  user, open, onClose, copied, onCopyCode, inviteCopied, onShareInvite,
  addCode, onAddCodeChange, onAddFriend, addCodeError, addCodeSuccess,
  friendRequests, sentRequests, onAccept, onDecline,
  friends, activeFriendshipId, unread, onSelectFriend,
  onDashboard, dashboardActive,
}) {
  const sorted = [...friends].sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0));
  return (
    <>
      {open && <div id="sidebar-backdrop" onClick={onClose} />}
      <aside id="sidebar" className={open ? 'open' : 'closed'}>
        <div id="sidebar-inner">
          <div className="sidebar-section">
            <p className="sidebar-label">Your Code</p>
            <div id="friend-code-row">
              <span id="friend-code-value">{user.friend_code}</span>
              <button className="copy-btn" onClick={onCopyCode}>{copied ? '✓' : 'Copy'}</button>
            </div>
            <button id="invite-link-btn" className="copy-btn" onClick={onShareInvite}>
              {inviteCopied ? '✓ Invite link copied' : 'Share invite link'}
            </button>
          </div>

          <div className="sidebar-section">
            <p className="sidebar-label">Add Friend</p>
            <div id="add-friend-row">
              <input
                placeholder="Friend code"
                value={addCode}
                onChange={e => onAddCodeChange(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') onAddFriend(); }}
                maxLength={6}
              />
              <button onClick={() => onAddFriend()}>Add</button>
            </div>
            {addCodeError && <p className="sidebar-feedback error">{addCodeError}</p>}
            {addCodeSuccess && <p className="sidebar-feedback success">{addCodeSuccess}</p>}
          </div>

          {friendRequests.length > 0 && (
            <div className="sidebar-section">
              <p className="sidebar-label">
                Requests
                <span className="request-badge">{friendRequests.length}</span>
              </p>
              {friendRequests.map(req => (
                <div key={req.id} className="request-item">
                  <span className="request-name">{req.from_name}</span>
                  <div className="request-actions">
                    <button className="accept-btn" onClick={() => onAccept(req.id)}>✓</button>
                    <button className="decline-btn" onClick={() => onDecline(req.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sentRequests.length > 0 && (
            <div className="sidebar-section">
              <p className="sidebar-label">Sent</p>
              {sentRequests.map(req => (
                <div key={req.id} className="request-item">
                  <span className="request-name">
                    {req.to_name}
                    <span className="request-waiting"> · waiting</span>
                  </span>
                  <div className="request-actions">
                    <button className="decline-btn" title="Cancel request" aria-label={`Cancel request to ${req.to_name}`} onClick={() => onDecline(req.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sidebar-section sidebar-friends">
            <div
              className={`friend-item dashboard-item${dashboardActive ? ' active' : ''}`}
              onClick={onDashboard}
              role="button"
            >
              <span className="friend-avatar dashboard-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
                </svg>
              </span>
              <span className="friend-name">Dashboard</span>
            </div>
            <p className="sidebar-label">Friends</p>
            {friends.length === 0 ? (
              <p className="empty-msg">No friends yet</p>
            ) : (
              sorted.map(f => (
                <div
                  key={f.friendship_id}
                  className={`friend-item${activeFriendshipId === f.friendship_id ? ' active' : ''}`}
                  onClick={() => onSelectFriend(f)}
                >
                  <Avatar userId={f.friend_id} avatarAt={f.friend_avatar_at} name={f.friend_name} />
                  <span className="friend-name">{f.friend_name}</span>
                  {unread.has(f.friendship_id) && <span className="unread-dot" />}
                </div>
              ))
            )}
          </div>
        </div>
        <div id="sidebar-footer">
          <a href="https://ko-fi.com/mguaste" target="_blank" rel="noreferrer" id="kofi-link">Support on Ko-fi</a>
        </div>
      </aside>
    </>
  );
}
