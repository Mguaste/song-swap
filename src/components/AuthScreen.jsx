import { useEffect, useState } from 'react';
import icon from '../assets/SSLogo.png';
import { readPendingSource } from '../lib/pending';
import { LoginForm, RegisterForm } from './AuthForms';

export function AuthScreen({ authMode, onModeChange, pendingInvite, onLoggedIn, onBack }) {
  const [inviter, setInviter] = useState(null);
  useEffect(() => {
    if (!pendingInvite) return;
    const src = readPendingSource().via === 'share' ? '?src=share' : '';
    fetch(`/api/invite/${encodeURIComponent(pendingInvite)}${src}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setInviter(d?.name ?? null))
      .catch(() => {});
  }, [pendingInvite]);

  return (
    <div id="login-page">
      <div id="login-card">
        <img src={icon} id="login-logo" alt="icon" />
        <h1 id="login-title">Song Swap</h1>
        <p id="login-subtitle">
          {authMode === 'login' ? 'Log in to your Song Swap account' : 'Create your free Song Swap account'}
        </p>
        {pendingInvite && (
          <p id="invite-note">
            {inviter ? <><strong>{inviter}</strong> invited you to swap songs.</> : "You've been invited to swap songs."}
            {' '}{authMode === 'login' ? 'Log in' : 'Create an account'} and we'll send {inviter ?? 'them'} a friend request.
          </p>
        )}
        {authMode === 'login'
          ? <LoginForm onLogin={onLoggedIn} />
          : <RegisterForm onLogin={onLoggedIn} />
        }
        {authMode === 'login' && (
          <p id="auth-forgot">
            Forgot your password? <a href="https://github.com/Mguaste/song-swap/issues" target="_blank" rel="noreferrer">Open an issue</a> with
            your username (or ask the friend who invited you) and we'll send you a temporary one.
          </p>
        )}
        <p id="auth-toggle">
          {authMode === 'login' ? (
            <>No account? <button className="link-btn" onClick={() => onModeChange('register')}>Sign up</button></>
          ) : (
            <>Have an account? <button className="link-btn" onClick={() => onModeChange('login')}>Log in</button></>
          )}
        </p>
        <button className="link-btn" id="back-to-home" onClick={onBack}>← Back to home</button>
        <p id="auth-legal">
          <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>
        </p>
      </div>
    </div>
  );
}
