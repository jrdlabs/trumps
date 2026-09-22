-- Automatic trick pacing and player-private won-trick history.

create table if not exists private.trumps_won_tricks (
  room_id uuid not null references public.trumps_rooms(id) on delete cascade,
  hand_index smallint not null check (hand_index between 0 and 21),
  trick_number smallint not null check (trick_number between 0 and 11),
  winner_seat smallint not null check (winner_seat between 0 and 3),
  plays jsonb not null check (jsonb_typeof(plays) = 'array'),
  primary key (room_id, hand_index, trick_number)
);

revoke all on private.trumps_won_tricks from public, anon, authenticated;

create or replace function private.trumps_get_game_impl(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_seat smallint;
  v_hand text[];
  v_state jsonb;
  v_revision bigint;
  v_won_tricks jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select seat into v_seat from public.trumps_players
  where room_id = p_room_id and user_id = v_user_id;
  if not found then raise exception 'You are not a member of this room'; end if;
  select public_state, revision into v_state, v_revision
  from public.trumps_game_state where room_id = p_room_id;
  select cards into v_hand from private.trumps_hands
  where room_id = p_room_id and seat = v_seat;
  select coalesce(jsonb_agg(jsonb_build_object(
    'handIndex', hand_index,
    'trickNumber', trick_number,
    'plays', plays
  ) order by hand_index, trick_number), '[]'::jsonb)
  into v_won_tricks
  from private.trumps_won_tricks
  where room_id = p_room_id and winner_seat = v_seat;
  return coalesce(v_state, '{}'::jsonb) || jsonb_build_object(
    'revision', v_revision,
    'mySeat', v_seat,
    'hand', coalesce(to_jsonb(v_hand), '[]'::jsonb),
    'myWonTricks', v_won_tricks
  );
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

  delete from private.trumps_won_tricks where room_id = p_room_id;
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
    insert into private.trumps_won_tricks(room_id, hand_index, trick_number, winner_seat, plays)
    values (p_room_id, (v_state->>'handIndex')::smallint, v_trick::smallint, v_winner, v_plays)
    on conflict (room_id, hand_index, trick_number) do nothing;
    v_state := jsonb_set(v_state, '{tricksWon}', v_wins);
    v_state := jsonb_set(v_state, '{lastTrick}', jsonb_build_object('plays', v_plays, 'winner', v_winner));
    v_state := jsonb_set(v_state, '{trickCompletedAt}', to_jsonb(clock_timestamp()));
    v_state := jsonb_set(v_state, '{phase}', '"trick_complete"'::jsonb);
    v_state := jsonb_set(v_state, '{turnSeat}', 'null'::jsonb);
  end if;

  update public.trumps_game_state
  set phase = v_state->>'phase', turn_seat = nullif(v_state->>'turnSeat','')::smallint,
      public_state = v_state, revision = revision + 1, updated_at = now()
  where room_id = p_room_id;
end;
$$;

revoke all on function private.trumps_get_game_impl(uuid) from public;
revoke all on function private.trumps_start_game_impl(uuid) from public;
revoke all on function private.trumps_play_card_impl(uuid,text) from public;
grant execute on function private.trumps_get_game_impl(uuid) to authenticated;
grant execute on function private.trumps_start_game_impl(uuid) to authenticated;
grant execute on function private.trumps_play_card_impl(uuid,text) to authenticated;
