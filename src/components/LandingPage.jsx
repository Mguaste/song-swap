import icon from '../assets/SSLogo.png';

const FEATURES = [
  {
    title: 'One song at a time',
    body: 'Trade a single track at a time. No endless playlists, no algorithmic recommendations, just you and a friend sharing the music you love.',
    icon: (
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    ),
  },
  {
    title: 'Any platform',
    body: 'Spotify, Apple Music, YouTube Music, Deezer, Tidal, Amazon Music — paste a link and it opens in the app you prefer.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </>
    ),
  },
  {
    title: 'Instant delivery',
    body: 'Songs land the moment they are sent. Real-time updates mean no refreshing and no waiting.',
    icon: (
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    ),
  },
  {
    title: 'Add friends with a code',
    body: 'Share your six-character friend code and start swapping. No emails, no searching, no spam.',
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 11h-6M19 8v6" />
      </>
    ),
  },
  {
    title: 'No repeats',
    body: 'Built-in duplicate detection makes sure you never send a friend the same song twice.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Full history',
    body: 'Every swap is saved. Look back through everything you and a friend have traded over time.',
    icon: (
      <>
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </>
    ),
  },
];

const STEPS = [
  { n: '1', title: 'Create an account', body: 'Sign up and pick the music app you listen on.' },
  { n: '2', title: 'Add a friend', body: 'Swap six-character codes to connect.' },
  { n: '3', title: 'Send a song', body: 'Paste a link, hit send, and discover what comes back.' },
];

export function LandingPage({ onLogin, onSignup }) {
  return (
    <div id="landing">
      <header id="landing-nav">
        <div className="landing-brand">
          <img src={icon} alt="Song Swap" />
          <span>Song Swap</span>
        </div>
        <div className="landing-nav-actions">
          <button className="landing-btn-ghost" onClick={onLogin}>Log in</button>
          <button className="landing-btn-primary" onClick={onSignup}>Sign up</button>
        </div>
      </header>

      <section id="landing-hero">
        <img src={icon} id="landing-hero-logo" alt="Song Swap" />
        <h1>Share the songs you love <br/>with the people you love.</h1>
        <p className="landing-hero-sub">
          Song Swap is a simple way to trade music with friends — one track at a time,
          on whatever app you already use.
        </p>
        <div className="landing-hero-actions">
          <button className="landing-btn-primary landing-btn-lg" onClick={onSignup}>Get started — it's free</button>
          <button className="landing-btn-ghost landing-btn-lg" onClick={onLogin}>I have an account</button>
        </div>
        <p className="landing-hero-tagline">Community in Music</p>
      </section>

      <section id="landing-features">
        <h2 className="landing-section-title">Why Song Swap</h2>
        <div className="landing-feature-grid">
          {FEATURES.map(f => (
            <div className="landing-feature" key={f.title}>
              <div className="landing-feature-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                  {f.icon}
                </svg>
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="landing-steps">
        <h2 className="landing-section-title">How it works</h2>
        <div className="landing-steps-row">
          {STEPS.map(s => (
            <div className="landing-step" key={s.n}>
              <div className="landing-step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="landing-cta">
        <h2>Ready to swap?</h2>
        <p>Find out what your friends are listening to today.</p>
        <button className="landing-btn-primary landing-btn-lg" onClick={onSignup}>Create your account</button>
      </section>

      <footer id="landing-footer">
        <div className="landing-footer-row">
          <span>© 2026 Song Swap</span>
          <nav className="landing-footer-links">
            <a href="/what-is-a-song-swap">What is a song swap?</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="https://github.com/Mguaste/song-swap" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://ko-fi.com/mguaste" target="_blank" rel="noreferrer">Support on Ko-fi</a>
          </nav>
        </div>
        <p className="landing-disclaimer">
          Song Swap is an independent project and is not affiliated with, endorsed by, or connected to
          Spotify, Apple, Google, Amazon, Tidal, or Deezer. Platform names are used only to describe which
          services' song links the app can open. We never ask for your credentials to any other service.
        </p>
      </footer>
    </div>
  );
}
