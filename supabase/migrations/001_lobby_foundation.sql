-- Canonical lobby foundation for the Trumps project.

create table if not exists public.trumps_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{5}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished', 'abandoned')),
  max_players smallint not null default 4 check (max_players = 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trumps_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.trumps_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 24),
  seat smallint not null check (seat between 0 and 3),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, seat),
  unique (room_id, user_id)
);

create table if not exists public.trumps_game_state (
  room_id uuid primary key references public.trumps_rooms(id) on delete cascade,
  phase text not null default 'lobby' check (phase in ('lobby', 'bidding', 'playing', 'hand_complete', 'game_complete')),
  hand_index smallint not null default 0 check (hand_index between 0 and 21),
  hand_size smallint not null default 12 check (hand_size between 2 and 12),
  dealer_seat smallint check (dealer_seat between 0 and 3),
  turn_seat smallint check (turn_seat between 0 and 3),
  trump_suit text check (trump_suit is null or trump_suit in ('S', 'H', 'D', 'C')),
  public_state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists trumps_players_room_id_idx on public.trumps_players(room_id);
create index if not exists trumps_players_user_id_idx on public.trumps_players(user_id);
create index if not exists trumps_rooms_host_user_id_idx on public.trumps_rooms(host_user_id);

alter table public.trumps_rooms enable row level security;
alter table public.trumps_players enable row level security;
alter table public.trumps_game_state enable row level security;

revoke all on public.trumps_rooms, public.trumps_players, public.trumps_game_state from anon;
revoke all on public.trumps_rooms, public.trumps_players, public.trumps_game_state from authenticated;
grant select on public.trumps_rooms, public.trumps_players, public.trumps_game_state to authenticated;

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.trumps_is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.trumps_players p
    where p.room_id = p_room_id and p.user_id = (select auth.uid())
  );
$$;

revoke all on function private.trumps_is_room_member(uuid) from public;
grant execute on function private.trumps_is_room_member(uuid) to authenticated;

create or replace function private.trumps_generate_room_code()
returns text language plpgsql set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..5 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function private.trumps_create_room_impl(p_display_name text)
returns table(room_id uuid, room_code text, seat smallint)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_code text;
  v_name text := trim(p_display_name);
  v_try integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 24 then
    raise exception 'Display name must be 1 to 24 characters';
  end if;
  loop
    v_try := v_try + 1;
    v_code := private.trumps_generate_room_code();
    begin
      insert into public.trumps_rooms (code, host_user_id)
      values (v_code, v_user_id) returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_try >= 10 then raise exception 'Could not allocate room code'; end if;
    end;
  end loop;
  insert into public.trumps_players (room_id, user_id, display_name, seat, is_host)
  values (v_room_id, v_user_id, v_name, 0, true);
  insert into public.trumps_game_state (room_id) values (v_room_id);
  return query select v_room_id, v_code, 0::smallint;
end;
$$;

create or replace function private.trumps_join_room_impl(p_room_code text, p_display_name text)
returns table(room_id uuid, room_code text, seat smallint)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.trumps_rooms%rowtype;
  v_name text := trim(p_display_name);
  v_seat smallint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 24 then
    raise exception 'Display name must be 1 to 24 characters';
  end if;
  select * into v_room from public.trumps_rooms
  where code = upper(trim(p_room_code)) for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.status <> 'lobby' then raise exception 'Game has already started'; end if;
  select p.seat into v_seat from public.trumps_players p
  where p.room_id = v_room.id and p.user_id = v_user_id;
  if found then
    update public.trumps_players set display_name = v_name, last_seen_at = now()
    where room_id = v_room.id and user_id = v_user_id;
    return query select v_room.id, v_room.code, v_seat;
    return;
  end if;
  select s::smallint into v_seat from generate_series(0, 3) s
  where not exists (
    select 1 from public.trumps_players p where p.room_id = v_room.id and p.seat = s
  ) order by s limit 1;
  if v_seat is null then raise exception 'Room is full'; end if;
  insert into public.trumps_players (room_id, user_id, display_name, seat, is_host)
  values (v_room.id, v_user_id, v_name, v_seat, false);
  return query select v_room.id, v_room.code, v_seat;
end;
$$;

create or replace function private.trumps_leave_room_impl(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_was_host boolean;
  v_next_host uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select is_host into v_was_host from public.trumps_players
  where room_id = p_room_id and user_id = v_user_id;
  if not found then return; end if;
  delete from public.trumps_players where room_id = p_room_id and user_id = v_user_id;
  if not exists (select 1 from public.trumps_players where room_id = p_room_id) then
    delete from public.trumps_rooms where id = p_room_id;
    return;
  end if;
  if v_was_host then
    select user_id into v_next_host from public.trumps_players
    where room_id = p_room_id order by seat limit 1;
    update public.trumps_players set is_host = (user_id = v_next_host) where room_id = p_room_id;
    update public.trumps_rooms set host_user_id = v_next_host, updated_at = now() where id = p_room_id;
  end if;
end;
$$;

revoke all on function private.trumps_create_room_impl(text) from public;
revoke all on function private.trumps_join_room_impl(text, text) from public;
revoke all on function private.trumps_leave_room_impl(uuid) from public;
grant execute on function private.trumps_create_room_impl(text) to authenticated;
grant execute on function private.trumps_join_room_impl(text, text) to authenticated;
grant execute on function private.trumps_leave_room_impl(uuid) to authenticated;

create or replace function public.trumps_create_room(p_display_name text)
returns table(room_id uuid, room_code text, seat smallint)
language sql security invoker set search_path = ''
as $$ select * from private.trumps_create_room_impl(p_display_name); $$;

create or replace function public.trumps_join_room(p_room_code text, p_display_name text)
returns table(room_id uuid, room_code text, seat smallint)
language sql security invoker set search_path = ''
as $$ select * from private.trumps_join_room_impl(p_room_code, p_display_name); $$;

create or replace function public.trumps_leave_room(p_room_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.trumps_leave_room_impl(p_room_id); $$;

revoke all on function public.trumps_create_room(text) from public, anon;
revoke all on function public.trumps_join_room(text, text) from public, anon;
revoke all on function public.trumps_leave_room(uuid) from public, anon;
grant execute on function public.trumps_create_room(text) to authenticated;
grant execute on function public.trumps_join_room(text, text) to authenticated;
grant execute on function public.trumps_leave_room(uuid) to authenticated;

drop policy if exists "members can view players in their room" on public.trumps_players;
create policy "members can view players in their room"
on public.trumps_players for select to authenticated
using ((select private.trumps_is_room_member(room_id)));

drop policy if exists "members can view their room" on public.trumps_rooms;
create policy "members can view their room"
on public.trumps_rooms for select to authenticated
using ((select private.trumps_is_room_member(id)));

drop policy if exists "members can view game state" on public.trumps_game_state;
create policy "members can view game state"
on public.trumps_game_state for select to authenticated
using ((select private.trumps_is_room_member(room_id)));

alter publication supabase_realtime add table public.trumps_rooms;
alter publication supabase_realtime add table public.trumps_players;
