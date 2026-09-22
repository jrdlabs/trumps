# Trumps — Project Roundup

A personal project (not work-related). Web-based, real-time multiplayer trick-taking card game for 4 players, in the "Oh Hell" / Nomination Whist family, with a custom scoring system. This document is a full handoff of everything decided and built so far.

---

## 1. Game Rules (finalized)

**Setup**
- 4 players, one standard 52-card deck, no jokers, Ace high in every suit.
- 22 hands per game. Deal size sequence: 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 (down to 2, then straight back up to 12 — two consecutive 2-card hands in the middle).
- Dealer seat rotates by one player every hand.
- Each hand: shuffle, deal N cards to each player (N = that hand's size), then flip the next card off the remaining stock — its suit becomes the **trump suit** for that hand. That flipped card is not part of anyone's hand; it's set aside and the deck is freshly reshuffled next hand.

**Bidding**
- Free bidding — no restriction forcing total bids to differ from the number of tricks (no "hook rule").
- Dealer bids first each hand. Bidding then proceeds around the table from the dealer.
- Each player bids how many tricks ("packs") they expect to win that hand, 0 up to the hand size.

**Trick play**
- Dealer leads the first trick of every hand.
- **First trick of the hand only:** every player must play a trump card if they hold one at all. If a player has zero trump cards, they may play anything.
- **All tricks after the first:** standard follow-suit — a player must play the suit led if they hold it; if they don't, they're free to play anything, including trump, to try to win the trick. (Playing trump to steal a trick when you can't follow suit is a known, intentional strategy.)
- Trick winner: if any trump was played in the trick, the highest trump wins; otherwise the highest card of the suit led wins.
- The winner of each trick leads the next one.

**Scoring** (per hand, cumulative across all 22 hands)
- Won exactly what you bid → `bid × 10`
- Won more than you bid → `(bid × 10) + (tricks won − bid)`
- Won less than you bid → `bid × -10`
- Bid 0, won 0 → 0
- Worked example (5-card hand): Player bids 2, wins 2 → scores 20. Another player bids 2, wins 1 → scores -20. Another bids 1, wins 2 → scores 21 (10 + 1 extra). Another bids 0, wins 0 → scores 0.
- Highest cumulative score after all 22 hands wins the game.

---

## 2. Architecture decisions

- **Real-time online multiplayer.** Friends join a room remotely (not pass-and-play, not solo-vs-bots) — this drives most of the technical decisions below.
- **No accounts.** Players join a room with just a name; nothing persists after the game ends. No login system needed.
- **Mobile-first.** Primary target is phones; layout and interaction design should be designed for that first.
- **Backend: Supabase**, on the user's own **personal** Supabase project — deliberately separate from any employer infrastructure. Two pieces:
  - **Postgres** for room/game state.
  - **Realtime** to push state changes to all 4 connected players instantly.
- **Game logic must live server-side**, not in the browser — because each player's hand is secret. If dealing/hand logic ran client-side, any player could inspect it via devtools and see everyone's cards. The server (a Supabase Edge Function, which runs Deno/JS/TypeScript — same language as the client, not a rewrite) holds the authoritative full game state; each client only ever receives its own hand plus public information (bids, cards played, running scores).
- **Rooms, not accounts:** host creates a room → gets a short code/link → shares it with 3 friends → each joins with just a name. Room state should expire after some idle period.
- **Reconnect handling:** since there's no login, a small per-room session token stored in the player's browser should let a dropped connection rejoin the same seat.
- **Engine written as pure, isolated functions** (not tangled into UI/React state) specifically so the exact same logic can be relocated into a server-side Edge Function later with minimal rewriting — porting is mostly about restructuring *what's allowed to see what* and adding turn/legality validation, not translating code.
- **Seat order randomization (not yet built):** for the real multiplayer version, when players join a room, their seating order should be randomized once at game start rather than assigned in join order. (Test names used in planning: Joe, Tom, John, Sue.)

---

## 3. What's been built so far (in Claude, as prototypes)

Two separate, currently **unconnected** React prototypes exist. Neither talks to Supabase — both are fully client-side/local-state for iteration purposes.

### A. Rules/engine test harness ("god mode")
A single-player-controls-all-four-seats version used to validate the entire rule engine before any multiplayer work begins.
- Full engine implemented as plain functions: deck building/shuffling (Fisher–Yates), dealing per the 12→2→12 sequence, trump flip, bid collection, first-trick forced-trump legality, follow-suit legality for later tricks, trick-winner resolution (trump beats led suit, highest card wins), the scoring formula, and running totals across all 22 hands.
- UI shows all 4 hands at once (intentional — it's a debug view, not the real player experience), with legal/illegal cards visually distinguished, tap-to-select-then-confirm for both bidding and card play, editable player names, and a **Tally tab** — a full scorecard: one row per completed hand, each player's name centered above their Bid/Win/Score columns, with a running total row.
- Small aesthetic extras added along the way: a live "bids so far / cards dealt" counter that turns red if total bids exceed the hand size, and hand cards sorted/grouped with alternating suit colors (black/red/black/red) with thin dividers between suit groups for readability.

### B. Player-view table mockup (visual/animation only — no rules wired up)
A from-scratch, separate file exploring what the real single-seat player experience should feel and look like. **No real game logic** — bidding, legality, and trick outcomes are all scripted/hardcoded purely to demonstrate motion and layout.
- Green felt table background with a wood-toned rail border, sized off the viewport (not a small fixed box) so it fills the screen and scales across device sizes.
- Player's own hand shown fanned out at the bottom of the screen; when the hand grows past 6 cards it automatically splits into two stacked fan rows (e.g. 6+6 for a 12-card hand) rather than one overcrowded row.
- Tap a card → it lifts and highlights; tap it again → it animates (CSS transition) into a center trick line.
- Opponents (only 3 visible — left, top, right) show *only* a name badge and a face-down trick pile with a count — no cards, matching real-table visibility. Their badge glows when it's their turn.
- Interaction for opponents/trick resolution is **manual, tap-to-advance** (a "Next" button) rather than auto-playing on a timer, by explicit choice — lets each animation step be inspected at the user's own pace during design review.
- Trick resolution: once all 4 cards are down, tapping "Next" flips them face-down and slides them together to the trick winner's pile, incrementing it.
- Known simplification flagged but not yet addressed: the "flip" is a straight swap to a card-back graphic while sliding, not a true 3D rotation — noted as a possible later polish item, not decided either way yet.

---

## 4. What's left to build

- Supabase schema design: rooms, players/seats, hands, bids, tricks played, running scores.
- Porting the validated engine logic from the god-mode prototype into a Supabase Edge Function, server-authoritative, with per-player visibility filtering (each client sees only their own hand + public state) and turn/legality enforcement.
- Realtime sync layer connecting the Edge Function's state to all 4 clients.
- Lobby/room UI: create room, get shareable code/link, join with name, host starts game.
- Seat order randomization at game start (noted above, not yet designed or built).
- Reconnect/session-token handling for dropped connections.
- Merging the two prototypes: the table mockup's visuals/animations need to be wired up to real game state instead of the current scripted/hardcoded sequence, and the tally/scorecard view from the god-mode build needs an equivalent in the real player-facing UI.
- Room idle/expiry policy (not yet defined — just noted that state shouldn't persist forever).

## 5. Open / undecided

- Whether to build the true 3D card-flip animation or keep the simpler instant-swap-while-sliding version.
- Exact Supabase schema shape (tables/columns) — not yet drafted, only the general approach (Postgres + Realtime, server-side logic) is settled.
- Room expiry timing.
- Any additional table polish beyond what's in the current mockup (sound, haptics, etc.) hasn't been discussed at all.

---

*The two prototype files (`trumps-game.jsx` — god-mode rules harness, and `trumps-table-mockup.jsx` — player-view table mockup) are being shared alongside this document.*
