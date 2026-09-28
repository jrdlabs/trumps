create or replace function private.trumps_close_completed_room_impl(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_phase text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.trumps_players
    where room_id=p_room_id and user_id=v_user_id and is_host
  ) then raise exception 'Only the host can close this table'; end if;
  select phase into v_phase from public.trumps_game_state where room_id=p_room_id for update;
  if v_phase <> 'game_complete' then raise exception 'The table can only be closed after the game'; end if;
  delete from public.trumps_rooms where id=p_room_id;
end;
$$;

create or replace function public.trumps_close_completed_room(p_room_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.trumps_close_completed_room_impl(p_room_id);
$$;

revoke all on function private.trumps_close_completed_room_impl(uuid) from public,anon,authenticated;
grant execute on function private.trumps_close_completed_room_impl(uuid) to authenticated;
revoke all on function public.trumps_close_completed_room(uuid) from public,anon;
grant execute on function public.trumps_close_completed_room(uuid) to authenticated;
