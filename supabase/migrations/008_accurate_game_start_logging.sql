drop trigger if exists trumps_activity_game_started on public.trumps_game_state;
CREATE OR REPLACE FUNCTION private.trumps_start_game_impl(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  insert into private.trumps_activity_log(event_type,room_id,room_code,actor_user_id,details)
  select 'game_started',r.id,r.code,v_user_id,jsonb_build_object('handSize',12)
  from public.trumps_rooms r where r.id=p_room_id;
  perform private.trumps_deal_hand(p_room_id, 0::smallint, 0::smallint, jsonb_build_array(0,0,0,0), '[]'::jsonb);
end;
$function$

