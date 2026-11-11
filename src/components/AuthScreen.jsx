import icon from '../assets/SSLogo.png';
import { LoginForm, RegisterForm } from './AuthForms';

export function AuthScreen({ authMode, onModeChange, pendingInvite, onLoggedIn, onBack }) {
  return (
    <div id="login-page">
      <div id="login-card">
        <img src={icon} id="login-logo" alt="icon" />
        <h1 id="login-title">Song Swap</h1>
        <p id="login-subtitle">
          {authMode === 'login' ? 'Log in to your Song Swap account' : 'Create your free Song Swap account'}
        </p>
        {pendingInvite && <p id="invite-note">You've been invited to swap songs — sign up or log in and we'll send the friend request.</p>}
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
