# Joel’s Game Room

Static, mobile-first Trumps and Dominoes games sharing the existing Supabase project `yxaxfnoveylmtjzbbbee` (PersonalDB). No new repository, backend server, or Supabase project is needed.

## URLs

The existing GitHub Pages root responds at https://jrdlabs.github.io/trumps/ . After this change is merged/published:

- Game hub: https://jrdlabs.github.io/trumps/
- Trumps: https://jrdlabs.github.io/trumps/trumps.html
- Dominoes: https://jrdlabs.github.io/trumps/dominoes.html

Old Trumps invitations using `/?room=CODE` still redirect to Trumps. New invites use each game's own page. All assets are relative to the repository root; no SPA rewrite or build step is required. Keep Pages publishing from the repository root. The service-worker cache version has been bumped and includes both games.

## Local preview

The private Dominoes admin test area is documented in [ADMIN-SETUP.md](./ADMIN-SETUP.md), including the required one-time Google provider setup and controls. It reuses the real gameplay engine with private bot-filled test rooms.

The hub, Trumps, and Dominoes share one installable **Joel’s Game Room** app. Every page links the same manifest and includes an Install Game Room button. Supported browsers offer their native prompt; other browsers show installation instructions. The button is hidden when running as an installed app. Installation opens the hub so both games are available from one icon. The shared installation handler lives in `js/install.js`; the cache version includes its assets.

Run `node dev-server.cjs` from this directory and open http://127.0.0.1:8080/ . Gameplay requires an internet connection to Supabase. Cached pages do not enable offline turns.

## Supabase installation

The additive migration `dominoes_cut_throat` was applied to the existing project during implementation. **Do not rerun `supabase/dominoes.sql` on that project.** That file is the exact standalone installation SQL for a fresh environment; it creates only Dominoes objects and registers the realtime table. Existing Trumps SQL migrations remain unchanged.

The follow-up `dominoes_winner_starts` migration is also applied. Its standalone upgrade SQL is `supabase/dominoes-winner-starts.sql`. It changes only the Dominoes action function: double-six opens hand one, then the previous winner starts with any tile. A tied block retains the hand's starter. The fresh-install SQL includes this rule too. Deploy the updated frontend and refresh open game tabs so their tile highlighting uses the corrected rule.

Objects added:

- `public.dominoes_rooms`: room ID, six-character code, revision; member-only SELECT policy `dominoes_member_read`; no client writes.
- `dominoes_private.games`: authoritative game state and secret hands. No direct client table privileges; RLS denies direct access.
- `dominoes_private.member` and `dominoes_private.action`: restricted definer functions with empty search paths and caller identity/membership validation.
- `public.dominoes_action`: authenticated-only invoker RPC; calls the restricted private dispatcher.
- Realtime publication entry for `public.dominoes_rooms`. Payloads contain no hands; clients retrieve a sanitized snapshot via RPC.

Anonymous Sign-Ins must remain enabled in Authentication → Sign In / Providers → Anonymous (already enabled for Trumps). The existing publishable key in `js/config.js` is reused. No secrets are shipped to the browser. Do not expose `dominoes_private` through the Data API. No additional setup is needed on the existing project.

## Dominoes rules and behavior

Four players, double-six, all 28 tiles dealt (seven each), clockwise seats. The holder of double-six opens only the first hand. The previous winner opens each later hand with any tile; after a tied block, the same starter opens the redeal. Play on either matching end; no drawing, and passing is rejected when a legal tile exists. First out wins. Four consecutive passes block the hand; the lowest pip total wins, with no point awarded for a tied minimum. One point per hand win; first to six wins the match. The host starts the match and deals the next hand. These house rules are displayed in the lobby.

All actions lock the room's private state in a transaction and validate turn, tile ownership, chosen end, phase, and expected revision. Opponents' hands are withheld while live and revealed in completed-hand results. The UI includes score totals, hand history, and a play/pass review.

The shared anonymous Supabase session and Dominoes-specific room ID persist in browser storage. Reloading restores the same seat, including invited URLs. Realtime updates trigger sanitized refreshes; five-second polling and online/visibility refresh provide recovery. Closing a page reserves the seat. This first version has no bots, player replacement, turn timeout, lobby leave/kick controls, or automatic host transfer. An interrupted match waits for the same players to return; clearing browser storage loses that anonymous identity. A new match uses a new room.

## Validation

- `node tests/rules.test.mjs`: opening and left/right tile choice rules.
- Run `supabase/dominoes-test.sql` as database administrator: transaction-isolated, rolled-back tests for three randomized complete matches, unique deal, rejoin, outsider rejection, host checks, turn/revision/pass enforcement, deterministic blocked win/tie, and actual authenticated-role RLS/hand isolation.
- `node tests/live-smoke.mjs`: creates four disposable anonymous users, tests REST join/deal/play/reconnect, and verifies a real member-authorized websocket update. The script prints fixture IDs for administrator cleanup; it must be followed by deletion of those specific test rooms/users. Implementation test fixtures were removed.
- JavaScript syntax checks passed. Existing Trumps JavaScript/CSS and all eight migrations were left unchanged; its original HTML is retained as `trumps.html` with a hub link.
- Visual browser QA remains outstanding: the available in-app browser timed out reaching the local preview. Test mobile layout and a full four-phone match before treating the UI as release-verified.

Security advisor notices for Dominoes reflect intentional anonymous member access and the private table's deny-all RLS setup. Existing Trumps/cron/account-level advisor findings were not changed by this work.
