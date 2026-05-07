import './App.css'
import icon from './assets/SSLogo.png'

function App() {

  return (
    <div id="screen">
      <header id="title-card">
        <img src={icon} id="logo" alt='icon'></img>
        <h1 id="main-title">Song Swap</h1>
      </header>
      <main id="main-body">
        <div id="song-swap-main">
          <div class="song-cont">
            <h2>Send</h2>
            <img class="album-art" alt='album_art'/>
            <h3>Song title</h3>
            <div class="input-group">
            <input placeholder="Paste Spotify Link" />
            <button>Send</button>
            </div>
          </div>
          <div class="song-cont">
            <h2>Recieve</h2>
            <img class="album-art" alt='album_art'/>
            <h3>Song title</h3>
          </div>
        </div>
        <p>Welcome To Song Swap: Work in Progress</p>
      </main>
    </div>
  )
}
export default App
