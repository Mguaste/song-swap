## Donate
If you are so kind and would like to donate please visit my KOFI:
https://ko-fi.com/mguaste

# Song Swap

### Local development
1. Install and start Postgres, then create a database: `createdb songswap`
2. `cp .env.example .env` and set `SESSION_SECRET` (e.g. `openssl rand -hex 32`)
3. `npm install`, then `npm run dev` from the repo root (frontend on http://localhost:5173)
4. Register an account in the app. Tables are created on first start; SSL is off for localhost databases.

//### Client-Requirements:
//* [x] must be able to paste Spotify link 
//* [x] Must Use SSL certificate for use at work

### Quality of life Goals:
//* [x] History/Duplicate Check
//* [ ]Auto upload to Spotify Playlist -# may be optional/ not forced because of various service integration

### Immediate needs
* [x] landing page

### user feedback/bugs/fixes
* [x] Clear URL after send!!!
* Spotity integration not working. -# not needed based on multi-platform integration
* [x] make playlist optional 
-# playlist not supported because of multi-platform integration
* [x] auto push updates for friend stuff.


### stretch Goals
* overview screen
* [x] song rating (1–5 stars, recipient only) — liked list done (dashboard); compatibility still open
* [x] default music app/compatibility. 

### elastigirl goal
* bulk playlist Transfer.

### Shipped Nov 2026
* [x] Replaced retired Odesli API with our own lookup (ISRC matching, Spotify/Apple/YouTube/Deezer/Tidal links)
* [x] Deezer + Tidal support, dropdown arrows
* [x] Logins stored in Postgres (deploys no longer log everyone out, 30-day sessions)
* [x] Socket security (can't spoof senders or join other people's swaps)
* [x] Unread pips fixed, hamburger badge fixed
* [x] Verify on paste, Pacific-midnight reset (`RESET_TIMEZONE`), `is_admin` flag
* [x] Remove friend (deletes history) + invite links (`/add/CODE`, still needs accepting)
* [x] Star ratings
* [x] Onboarding screen for new users + sent requests list
* [x] Removed leftover Spotify tokens from the DB
* [x] Easier to leave Settings (Back link, highlighted gear, Esc, picking a friend closes it)
* [x] Unread count in the tab title + red favicon pip, updating live
* [x] Read status stored on the server (syncs across devices), tabs auto-reload after a deploy
* [x] Mobile layout: no sideways scrolling, Settings stacks on phones
* [x] Installable app (Add to Home Screen) + `/share` link for sharing songs in
* [x] Friends list sorted by recent activity (reorders live)
* [x] Open swap refreshes when you come back to the tab or reconnect (no reload needed after phone sleep)
* [x] Delete account + admin password reset
* [x] Home dashboard: new for you, your turn, requests, invite nudge, songs you loved (logo = Home; phones open on it)

### Future ideas
Data check (Nov 2026): 21 users but only 3 friendships, so the most important work is getting people connected and coming back.

**Bring people back (biggest impact)**
* [x] Installable phone app (PWA) + share target, so you can share from Spotify's share menu straight into Song Swap (Android; iPhone via a Shortcut)
* [ ] Push notifications when a friend sends you a song (builds on the PWA)
* [ ] 30-second song previews in the app (Deezer + iTunes give free preview clips, no key needed)

**Social**
* [ ] Note with a song ("this reminded me of you")
* [ ] Emoji reactions alongside ratings
* [ ] "Listened" check so the sender knows their friend opened it
* [ ] Overview/stats screen: streaks, top artists, average rating, taste overlap per friend
* [ ] Group swaps (3+ friends)
* [ ] Send to several friends at once

**QOL**
* [ ] Search/filter history (title, artist, sender, rating)
* [ ] Undo send (a few seconds to take it back)
* [ ] Export a swap's history (CSV, or a Spotify/YouTube playlist)
* [ ] Read pasted Amazon Music links (if their pages are readable)

**Account / trust**
* [x] Delete account (matches the privacy page)
* [x] Password reset (admin reset button or recovery code, since there's no email on file) — admin button done

**Infra / safety net**
* [ ] Turn on Railway Postgres backups
* [ ] Separate test database so changes can be tested for real before pushing
* [x] Railway CLI access for reading deploy logs
* [x] Local development setup (local Postgres + `.env.example`)
* [ ] Optional: Spotify API credentials (exact Spotify links + ISRC for everything; needs Spotify Premium on the dev account)

