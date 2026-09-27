-- Bot seats are room members for display and turn order, but never auth users.
-- This migration is staged on the feature branch; deploy with the complete bot engine.

alter table public.trumps_rooms
  add column game_mode text not null default 'multiplayer'
  check (game_mode in ('multiplayer', 'single_player'));

alter table public.trumps_players
  alter column user_id drop not null;

alter table public.trumps_players
  add column player_type text not null default 'human'
  check (player_type in ('human', 'bot'));

alter table public.trumps_players
  add column bot_difficulty text
  check (bot_difficulty is null or bot_difficulty = 'normal');

alter table public.trumps_players
  add constraint trumps_player_identity_check check (
    (player_type = 'human' and user_id is not null and bot_difficulty is null)
    or
    (player_type = 'bot' and user_id is null and bot_difficulty = 'normal' and not is_host)
  );

-- Keep the existing nullable unique(room_id, user_id) for human players.
-- Each room may have three bots, so bot uniqueness is enforced by seat instead.
create index trumps_players_bot_room_idx
  on public.trumps_players (room_id, seat) where player_type = 'bot';
