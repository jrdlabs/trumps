-- Server-authoritative Trumps gameplay. Secret hands live in the private schema;
-- public.trumps_game_state contains only information shared by all four players.

create table if not exists private.trumps_hands (
  room_id uuid not null references public.trumps_rooms(id) on delete cascade,
  hand_index smallint not null check (hand_index between 0 and 21),
  seat smallint not null check (seat between 0 and 3),
  cards text[] not null,
  primary key (room_id, seat)
);

revoke all on private.trumps_hands from public, anon, authenticated;

alter table public.trumps_game_state drop constraint if exists trumps_game_state_phase_check;
alter table public.trumps_game_state add constraint trumps_game_state_phase_check
  check (phase in ('lobby','bidding','playing','trick_complete','hand_complete','game_complete'));

alter table public.trumps_players
  drop constraint if exists trumps_players_room_id_seat_key;
alter table public.trumps_players
  drop constraint if exists trumps_players_room_seat_unique;
drop index if exists public.trumps_players_room_seat_unique;
alter table public.trumps_players
  add constraint trumps_players_room_seat_unique unique (room_id, seat)
  deferrable initially immediate;

create or replace function private.trumps_hand_size(p_hand_index integer)
returns smallint language sql immutable set search_path = ''
as $$
  select case when p_hand_index <= 10 then (12 - p_hand_index)::smallint
              else (p_hand_index - 9)::smallint end;
$$;

create or replace function private.trumps_rank_value(p_card text)
returns integer language sql immutable set search_path = ''
as $$
  select case substring(p_card from 2)
    when 'J' then 11 when 'Q' then 12 when 'K' then 13 when 'A' then 14
    else substring(p_card from 2)::integer end;
$$;

create or replace function private.trumps_deal_hand(
  p_room_id uuid,
  p_hand_index smallint,
  p_dealer_seat smallint,
  p_totals jsonb,
  p_history jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_deck text[];
  v_cards text[];
  v_hand_size smallint := private.trumps_hand_size(p_hand_index);
  v_seat integer;
  v_round integer;
  v_trump_card text;
  v_state jsonb;
begin
  select array_agg(suit || rank order by random()) into v_deck
  from unnest(array['S','H','C','D']) suit
  cross join unnest(array['2','3','4','5','6','7','8','9','10','J','Q','K','A']) rank;

  delete from private.trumps_hands where room_id = p_room_id;
  for v_seat in 0..3 loop
    v_cards := array[]::text[];
    for v_round in 0..(v_hand_size - 1) loop
      v_cards := array_append(v_cards, v_deck[(v_round * 4) + v_seat + 1]);
    end loop;
    insert into private.trumps_hands(room_id, hand_index, seat, cards)
    values (p_room_id, p_hand_index, v_seat, v_cards);
  end loop;

  v_trump_card := v_deck[(v_hand_size * 4) + 1];
  v_state := jsonb_build_object(
    'phase', 'bidding',
    'handIndex', p_hand_index,
    'handSize', v_hand_size,
    'dealerSeat', p_dealer_seat,
    'turnSeat', p_dealer_seat,
    'trumpCard', v_trump_card,
    'trumpSuit', left(v_trump_card, 1),
    'bids', jsonb_build_array(null, null, null, null),
    'tricksWon', jsonb_build_array(0, 0, 0, 0),
    'totals', coalesce(p_totals, jsonb_build_array(0, 0, 0, 0)),
    'history', coalesce(p_history, '[]'::jsonb),
    'trickNumber', 0,
    'currentTrick', '[]'::jsonb,
    'ledSuit', null,
    'lastTrick', null
  );

  update public.trumps_game_state
  set phase = 'bidding', hand_index = p_hand_index, hand_size = v_hand_size,
      dealer_seat = p_dealer_seat, turn_seat = p_dealer_seat,
      trump_suit = left(v_trump_card, 1), public_state = v_state,
      revision = revision + 1, updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function private.trumps_start_game_impl(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_phase text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select status into v_status from public.trumps_rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if not exists (select 1 from public.trumps_players where room_id = p_room_id and user_id = v_user_id and is_host) then
    raise exception 'Only the host can start the game';
  end if;
  if (select count(*) from public.trumps_players where room_id = p_room_id) <> 4 then
    raise exception 'Four players are required';
  end if;
  select phase into v_phase from public.trumps_game_state where room_id = p_room_id;
  if v_status = 'playing' and v_phase <> 'game_complete' then raise exception 'The game has already started'; end if;

  set constraints all deferred;
  with shuffled as (
    select id, (row_number() over (order by random()) - 1)::smallint as new_seat
    from public.trumps_players where room_id = p_room_id
  )
  update public.trumps_players p set seat = s.new_seat
  from shuffled s where p.id = s.id;

  update public.trumps_rooms set status = 'playing', updated_at = now() where id = p_room_id;
  perform private.trumps_deal_hand(p_room_id, 0::smallint, 0::smallint, jsonb_build_array(0,0,0,0), '[]'::jsonb);
end;
$$;

create or replace function private.trumps_get_game_impl(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_seat smallint;
  v_hand text[];
  v_state jsonb;
  v_revision bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select seat into v_seat from public.trumps_players
  where room_id = p_room_id and user_id = v_user_id;
  if not found then raise exception 'You are not a member of this room'; end if;
  select public_state, revision into v_state, v_revision
  from public.trumps_game_state where room_id = p_room_id;
  select cards into v_hand from private.trumps_hands
  where room_id = p_room_id and seat = v_seat;
  return coalesce(v_state, '{}'::jsonb) || jsonb_build_object(
    'revision', v_revision,
    'mySeat', v_seat,
    'hand', coalesce(to_jsonb(v_hand), '[]'::jsonb)
  );
end;
$$;

create or replace function private.trumps_bid_impl(p_room_id uuid, p_bid integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_seat smallint;
  v_state jsonb;
  v_hand_size integer;
  v_next smallint;
  v_complete boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select seat into v_seat from public.trumps_players where room_id = p_room_id and user_id = v_user_id;
  if not found then raise exception 'You are not a member of this room'; end if;
  select public_state into v_state from public.trumps_game_state where room_id = p_room_id for update;
  if v_state->>'phase' <> 'bidding' then raise exception 'Bidding is not active'; end if;
  if (v_state->>'turnSeat')::integer <> v_seat then raise exception 'It is not your turn to bid'; end if;
  v_hand_size := (v_state->>'handSize')::integer;
  if p_bid < 0 or p_bid > v_hand_size then raise exception 'Bid must be between 0 and %', v_hand_size; end if;

  v_state := jsonb_set(v_state, array['bids', v_seat::text], to_jsonb(p_bid), false);
  select bool_and(value <> 'null'::jsonb) into v_complete from jsonb_array_elements(v_state->'bids');
  if v_complete then
    v_state := jsonb_set(v_state, '{phase}', '"playing"'::jsonb);
    v_next := (v_state->>'dealerSeat')::smallint;
  else
    v_next := ((v_seat + 1) % 4)::smallint;
  end if;
  v_state := jsonb_set(v_state, '{turnSeat}', to_jsonb(v_next));
  update public.trumps_game_state
  set phase = (v_state->>'phase'), turn_seat = v_next, public_state = v_state,
      revision = revision + 1, updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function private.trumps_play_card_impl(p_room_id uuid, p_card text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_seat smallint;
  v_state jsonb;
  v_cards text[];
  v_plays jsonb;
  v_play jsonb;
  v_card text := upper(trim(p_card));
  v_suit text := left(upper(trim(p_card)), 1);
  v_trump text;
  v_led text;
  v_trick integer;
  v_winner smallint;
  v_winning_card text;
  v_candidate text;
  v_wins jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select seat into v_seat from public.trumps_players where room_id = p_room_id and user_id = v_user_id;
  if not found then raise exception 'You are not a member of this room'; end if;
  select public_state into v_state from public.trumps_game_state where room_id = p_room_id for update;
  if v_state->>'phase' <> 'playing' then raise exception 'Card play is not active'; end if;
  if (v_state->>'turnSeat')::integer <> v_seat then raise exception 'It is not your turn'; end if;
  select cards into v_cards from private.trumps_hands where room_id = p_room_id and seat = v_seat for update;
  if array_position(v_cards, v_card) is null then raise exception 'That card is not in your hand'; end if;

  v_trump := v_state->>'trumpSuit';
  v_led := v_state->>'ledSuit';
  v_trick := (v_state->>'trickNumber')::integer;
  v_plays := v_state->'currentTrick';
  if v_trick = 0 and exists (select 1 from unnest(v_cards) c where left(c,1) = v_trump) and v_suit <> v_trump then
    raise exception 'You must play a trump card on the first trick';
  end if;
  if v_trick > 0 and jsonb_array_length(v_plays) > 0
     and exists (select 1 from unnest(v_cards) c where left(c,1) = v_led) and v_suit <> v_led then
    raise exception 'You must follow the led suit';
  end if;

  update private.trumps_hands set cards = array_remove(cards, v_card)
  where room_id = p_room_id and seat = v_seat;
  if jsonb_array_length(v_plays) = 0 then
    v_led := v_suit;
    v_state := jsonb_set(v_state, '{ledSuit}', to_jsonb(v_led));
  end if;
  v_plays := v_plays || jsonb_build_array(jsonb_build_object('seat', v_seat, 'card', v_card));
  v_state := jsonb_set(v_state, '{currentTrick}', v_plays);

  if jsonb_array_length(v_plays) < 4 then
    v_state := jsonb_set(v_state, '{turnSeat}', to_jsonb(((v_seat + 1) % 4)::smallint));
  else
    for v_play in select value from jsonb_array_elements(v_plays) loop
      v_candidate := v_play->>'card';
      if v_winning_card is null
         or (left(v_candidate,1) = v_trump and left(v_winning_card,1) <> v_trump)
         or (left(v_candidate,1) = left(v_winning_card,1) and private.trumps_rank_value(v_candidate) > private.trumps_rank_value(v_winning_card))
         or (left(v_winning_card,1) <> v_trump and left(v_candidate,1) = v_led and left(v_winning_card,1) <> v_led) then
        v_winning_card := v_candidate;
        v_winner := (v_play->>'seat')::smallint;
      end if;
    end loop;
    v_wins := v_state->'tricksWon';
    v_wins := jsonb_set(v_wins, array[v_winner::text], to_jsonb(((v_wins->>v_winner)::integer + 1)));
    v_state := jsonb_set(v_state, '{tricksWon}', v_wins);
    v_state := jsonb_set(v_state, '{lastTrick}', jsonb_build_object('plays', v_plays, 'winner', v_winner));
    v_state := jsonb_set(v_state, '{phase}', '"trick_complete"'::jsonb);
    v_state := jsonb_set(v_state, '{turnSeat}', 'null'::jsonb);
  end if;

  update public.trumps_game_state
  set phase = v_state->>'phase', turn_seat = nullif(v_state->>'turnSeat','')::smallint,
      public_state = v_state, revision = revision + 1, updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function private.trumps_continue_impl(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_trick integer;
  v_hand_size integer;
  v_winner smallint;
  v_i integer;
  v_bid integer;
  v_won integer;
  v_score integer;
  v_scores jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_history jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.trumps_players where room_id = p_room_id and user_id = auth.uid()
  ) then raise exception 'You are not a member of this room'; end if;
  select public_state into v_state from public.trumps_game_state where room_id = p_room_id for update;
  if v_state->>'phase' <> 'trick_complete' then raise exception 'The trick is not complete'; end if;
  v_trick := (v_state->>'trickNumber')::integer;
  v_hand_size := (v_state->>'handSize')::integer;
  v_winner := (v_state->'lastTrick'->>'winner')::smallint;
  if v_trick + 1 = v_hand_size then
    v_totals := v_state->'totals';
    for v_i in 0..3 loop
      v_bid := (v_state->'bids'->>v_i)::integer;
      v_won := (v_state->'tricksWon'->>v_i)::integer;
      v_score := case when v_won = v_bid then v_bid * 10
                      when v_won > v_bid then v_bid * 10 + (v_won - v_bid)
                      else v_bid * -10 end;
      v_scores := v_scores || jsonb_build_array(v_score);
      v_totals := jsonb_set(v_totals, array[v_i::text], to_jsonb((v_totals->>v_i)::integer + v_score));
    end loop;
    v_history := (v_state->'history') || jsonb_build_array(jsonb_build_object(
      'handIndex', v_state->'handIndex', 'handSize', v_state->'handSize',
      'bids', v_state->'bids', 'won', v_state->'tricksWon', 'scores', v_scores
    ));
    v_state := jsonb_set(v_state, '{totals}', v_totals);
    v_state := jsonb_set(v_state, '{history}', v_history);
    v_state := jsonb_set(v_state, '{phase}',
      case when (v_state->>'handIndex')::integer = 21 then '"game_complete"'::jsonb else '"hand_complete"'::jsonb end);
    v_state := jsonb_set(v_state, '{turnSeat}', 'null'::jsonb);
  else
    v_state := jsonb_set(v_state, '{trickNumber}', to_jsonb(v_trick + 1));
    v_state := jsonb_set(v_state, '{currentTrick}', '[]'::jsonb);
    v_state := jsonb_set(v_state, '{ledSuit}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{lastTrick}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{phase}', '"playing"'::jsonb);
    v_state := jsonb_set(v_state, '{turnSeat}', to_jsonb(v_winner));
  end if;
  update public.trumps_game_state
  set phase = v_state->>'phase', turn_seat = nullif(v_state->>'turnSeat','')::smallint,
      public_state = v_state, revision = revision + 1, updated_at = now()
  where room_id = p_room_id;
end;
$$;

create or replace function private.trumps_next_hand_impl(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_next smallint;
  v_dealer smallint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.trumps_players where room_id = p_room_id and user_id = auth.uid() and is_host
  ) then raise exception 'Only the host can deal the next hand'; end if;
  select public_state into v_state from public.trumps_game_state where room_id = p_room_id for update;
  if v_state->>'phase' <> 'hand_complete' then raise exception 'The hand is not complete'; end if;
  v_next := ((v_state->>'handIndex')::integer + 1)::smallint;
  v_dealer := (((v_state->>'dealerSeat')::integer + 1) % 4)::smallint;
  perform private.trumps_deal_hand(p_room_id, v_next, v_dealer, v_state->'totals', v_state->'history');
end;
$$;

create or replace function public.trumps_start_game(p_room_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.trumps_start_game_impl(p_room_id); $$;
create or replace function public.trumps_get_game(p_room_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.trumps_get_game_impl(p_room_id); $$;
create or replace function public.trumps_bid(p_room_id uuid, p_bid integer)
returns void language sql security invoker set search_path = '' as $$ select private.trumps_bid_impl(p_room_id, p_bid); $$;
create or replace function public.trumps_play_card(p_room_id uuid, p_card text)
returns void language sql security invoker set search_path = '' as $$ select private.trumps_play_card_impl(p_room_id, p_card); $$;
create or replace function public.trumps_continue(p_room_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.trumps_continue_impl(p_room_id); $$;
create or replace function public.trumps_next_hand(p_room_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.trumps_next_hand_impl(p_room_id); $$;

revoke all on function private.trumps_hand_size(integer) from public;
revoke all on function private.trumps_rank_value(text) from public;
revoke all on function private.trumps_deal_hand(uuid,smallint,smallint,jsonb,jsonb) from public;
revoke all on function private.trumps_start_game_impl(uuid) from public;
revoke all on function private.trumps_get_game_impl(uuid) from public;
revoke all on function private.trumps_bid_impl(uuid,integer) from public;
revoke all on function private.trumps_play_card_impl(uuid,text) from public;
revoke all on function private.trumps_continue_impl(uuid) from public;
revoke all on function private.trumps_next_hand_impl(uuid) from public;
grant execute on function private.trumps_start_game_impl(uuid) to authenticated;
grant execute on function private.trumps_get_game_impl(uuid) to authenticated;
grant execute on function private.trumps_bid_impl(uuid,integer) to authenticated;
grant execute on function private.trumps_play_card_impl(uuid,text) to authenticated;
grant execute on function private.trumps_continue_impl(uuid) to authenticated;
grant execute on function private.trumps_next_hand_impl(uuid) to authenticated;

revoke all on function public.trumps_start_game(uuid) from public, anon;
revoke all on function public.trumps_get_game(uuid) from public, anon;
revoke all on function public.trumps_bid(uuid,integer) from public, anon;
revoke all on function public.trumps_play_card(uuid,text) from public, anon;
revoke all on function public.trumps_continue(uuid) from public, anon;
revoke all on function public.trumps_next_hand(uuid) from public, anon;
grant execute on function public.trumps_start_game(uuid) to authenticated;
grant execute on function public.trumps_get_game(uuid) to authenticated;
grant execute on function public.trumps_bid(uuid,integer) to authenticated;
grant execute on function public.trumps_play_card(uuid,text) to authenticated;
grant execute on function public.trumps_continue(uuid) to authenticated;
grant execute on function public.trumps_next_hand(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trumps_game_state;
exception when duplicate_object then null;
end $$;
