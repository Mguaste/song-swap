import icon from '../assets/SSLogo.png';

export function Header({ user, unreadCount, showSettings, onToggleSidebar, onHome, onToggleSettings, onOpenAdmin, onLogout }) {
  return (
    <header id="title-card">
      <button id="sidebar-toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <span className="bar" /><span className="bar" /><span className="bar" />
        {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
      </button>
      <button id="home-btn" onClick={onHome} aria-label="Home" title="Home">
        <img src={icon} id="logo" alt="" />
      </button>
      <h1 id="main-title">Song Swap</h1>
      <div id="user-info">
        <span id="user-name">{user.name}</span>
        {user.is_admin && (
          <button id="admin-btn" onClick={onOpenAdmin} title="Admin tools are in Settings">Admin</button>
        )}
        <button id="settings-btn" className={showSettings ? 'active' : ''} onClick={onToggleSettings}
          aria-label={showSettings ? 'Close settings' : 'Settings'} aria-pressed={showSettings}
          title={showSettings ? 'Close settings' : 'Settings'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button id="logout-btn" onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
}
