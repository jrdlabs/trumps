-- Multi-table membership, online heartbeats, host removal, and stale lobby cleanup.

create or replace function private.trumps_touch_presence_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.trumps_players
  set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  if not found then raise exception 'You are not a member of this room'; end if;
end;
$$;

create or replace function private.trumps_kick_player_impl(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_host boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.trumps_players
    where room_id = p_room_id and user_id = v_user_id and is_host
  ) then
    raise exception 'Only the host can remove a player';
  end if;

  select is_host into v_target_host
  from public.trumps_players
  where id = p_player_id and room_id = p_room_id;

  if not found then raise exception 'Player not found'; end if;
  if v_target_host then raise exception 'The host cannot remove themselves'; end if;

  delete from public.trumps_players
  where id = p_player_id and room_id = p_room_id;
end;
$$;

create or replace function private.trumps_cleanup_abandoned_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.trumps_rooms r
  where r.status = 'lobby'
    and r.created_at < now() - interval '12 hours'
    and not exists (
      select 1 from public.trumps_players p
      where p.room_id = r.id
        and p.last_seen_at >= now() - interval '12 hours'
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.trumps_touch_presence_impl(uuid) from public;
revoke all on function private.trumps_kick_player_impl(uuid, uuid) from public;
revoke all on function private.trumps_cleanup_abandoned_rooms() from public;
grant execute on function private.trumps_touch_presence_impl(uuid) to authenticated;
grant execute on function private.trumps_kick_player_impl(uuid, uuid) to authenticated;

create or replace function public.trumps_touch_presence(p_room_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.trumps_touch_presence_impl(p_room_id); $$;

create or replace function public.trumps_kick_player(p_room_id uuid, p_player_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.trumps_kick_player_impl(p_room_id, p_player_id); $$;

revoke all on function public.trumps_touch_presence(uuid) from public, anon;
revoke all on function public.trumps_kick_player(uuid, uuid) from public, anon;
grant execute on function public.trumps_touch_presence(uuid) to authenticated;
grant execute on function public.trumps_kick_player(uuid, uuid) to authenticated;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'trumps-clean-abandoned-lobbies';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'trumps-clean-abandoned-lobbies',
    '17 * * * *',
    'select private.trumps_cleanup_abandoned_rooms()'
  );
end $$;

