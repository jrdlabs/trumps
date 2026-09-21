# Trumps

Mobile-first, four-player online trick-taking game using a static HTML/CSS/JavaScript frontend and Supabase.

## Run locally

This app uses JavaScript modules, so serve the folder over HTTP instead of opening `index.html` directly.

```bash
python3 -m http.server 8080 --directory .
```

Then visit `http://localhost:8080/trumps/`.

## Current milestone

- Anonymous Supabase session (no visible account or login)
- Create a four-player room
- Join by five-character room code
- Restore the current lobby after refresh
- Realtime player-list updates
- Copyable invite link
- Host/seat indicators and clean leave-room behavior

Game dealing, bidding, play, and scoring are intentionally reserved for the next milestone.

## GitHub Pages

The project is static and can be published directly from the repository root or `/docs` folder. No Vercel or Node server is required in production.

## Supabase requirement

Enable **Anonymous Sign-Ins** in the Supabase dashboard under **Authentication → Sign In / Providers → Anonymous**. The frontend uses the project URL and publishable key in `js/config.js`; no secret/service key is present in the browser.
