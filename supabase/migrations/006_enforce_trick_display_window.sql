-- The live function was updated first and rollback-tested during an active game.\n\nCREATE OR REPLACE FUNCTION private.trumps_continue_impl(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if clock_timestamp() < (v_state->>'trickCompletedAt')::timestamptz + interval '6 seconds' then
    raise exception 'Trick display is still in progress';
  end if;
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
$function$
\n