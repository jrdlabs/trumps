create table if not exists private.trumps_activity_log (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('room_created','player_joined','game_started','hand_completed','game_completed','room_closed')),
  room_id uuid,
  room_code text,
  actor_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists trumps_activity_log_room_time_idx
  on private.trumps_activity_log(room_id, occurred_at desc);
create index if not exists trumps_activity_log_type_time_idx
  on private.trumps_activity_log(event_type, occurred_at desc);

create table if not exists private.trumps_game_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  room_code text not null,
  game_number integer not null,
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  duration_seconds integer not null default 0,
  players jsonb not null,
  winner_names text[] not null,
  winning_score integer not null,
  hand_history jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, game_number)
);

create index if not exists trumps_game_history_completed_idx
  on private.trumps_game_history(completed_at desc);

create table if not exists private.trumps_admin_settings (
  singleton boolean primary key default true check (singleton),
  access_key_hash text not null,
  updated_at timestamptz not null default now()
);

alter table private.trumps_activity_log enable row level security;
alter table private.trumps_game_history enable row level security;
alter table private.trumps_admin_settings enable row level security;
revoke all on private.trumps_activity_log, private.trumps_game_history, private.trumps_admin_settings from public, anon, authenticated;

create or replace function private.trumps_log_room_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.trumps_activity_log(event_type,room_id,room_code,actor_user_id)
  values ('room_created',new.id,new.code,new.host_user_id);
  return new;
end;
$$;

create or replace function private.trumps_log_player_joined()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  select code into v_code from public.trumps_rooms where id=new.room_id;
  insert into private.trumps_activity_log(event_type,room_id,room_code,actor_user_id,details)
  values ('player_joined',new.room_id,v_code,new.user_id,jsonb_build_object('seat',new.seat,'displayName',new.display_name));
  return new;
end;
$$;

create or replace function private.trumps_log_game_started()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  select code into v_code from public.trumps_rooms where id=new.room_id;
  insert into private.trumps_activity_log(event_type,room_id,room_code,details)
  values ('game_started',new.room_id,v_code,jsonb_build_object('handSize',new.hand_size));
  return new;
end;
$$;

create or replace function private.trumps_archive_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_started timestamptz;
  v_game_number integer;
  v_players jsonb;
  v_winning_score integer;
  v_winners text[];
begin
  if old.phase = new.phase or new.phase not in ('hand_complete','game_complete') then return new; end if;
  select code into v_code from public.trumps_rooms where id=new.room_id;
  insert into private.trumps_activity_log(event_type,room_id,room_code,details)
  values ('hand_completed',new.room_id,v_code,jsonb_build_object('handIndex',new.hand_index,'handSize',new.hand_size));
  if new.phase <> 'game_complete' then return new; end if;

  select coalesce(max(occurred_at),(select created_at from public.trumps_rooms where id=new.room_id))
    into v_started from private.trumps_activity_log
    where room_id=new.room_id and event_type='game_started';
  select coalesce(max(game_number),0)+1 into v_game_number
    from private.trumps_game_history where room_id=new.room_id;
  select jsonb_agg(jsonb_build_object(
           'seat',p.seat,'name',p.display_name,'score',coalesce((new.public_state->'totals'->>p.seat)::integer,0)
         ) order by p.seat)
    into v_players from public.trumps_players p where p.room_id=new.room_id;
  select max((value)::integer) into v_winning_score
    from jsonb_array_elements_text(new.public_state->'totals');
  select array_agg(p.display_name order by p.seat) into v_winners
    from public.trumps_players p
    where p.room_id=new.room_id
      and (new.public_state->'totals'->>p.seat)::integer=v_winning_score;

  insert into private.trumps_game_history(
    room_id,room_code,game_number,started_at,completed_at,duration_seconds,
    players,winner_names,winning_score,hand_history
  ) values (
    new.room_id,v_code,v_game_number,v_started,now(),greatest(0,extract(epoch from (now()-v_started))::integer),
    v_players,v_winners,v_winning_score,coalesce(new.public_state->'history','[]'::jsonb)
  );
  insert into private.trumps_activity_log(event_type,room_id,room_code,details)
  values ('game_completed',new.room_id,v_code,jsonb_build_object('gameNumber',v_game_number,'winners',v_winners,'winningScore',v_winning_score));
  return new;
end;
$$;

create or replace function private.trumps_log_room_closed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.trumps_activity_log(event_type,room_id,room_code,actor_user_id,details)
  values ('room_closed',old.id,old.code,old.host_user_id,jsonb_build_object('status',old.status));
  return old;
end;
$$;

drop trigger if exists trumps_activity_room_created on public.trumps_rooms;
create trigger trumps_activity_room_created after insert on public.trumps_rooms
for each row execute function private.trumps_log_room_created();
drop trigger if exists trumps_activity_player_joined on public.trumps_players;
create trigger trumps_activity_player_joined after insert on public.trumps_players
for each row execute function private.trumps_log_player_joined();
drop trigger if exists trumps_activity_game_started on public.trumps_game_state;
create trigger trumps_activity_game_started after insert on public.trumps_game_state
for each row execute function private.trumps_log_game_started();
drop trigger if exists trumps_archive_game_progress on public.trumps_game_state;
create trigger trumps_archive_game_progress after update of phase on public.trumps_game_state
for each row execute function private.trumps_archive_progress();
drop trigger if exists trumps_activity_room_closed on public.trumps_rooms;
create trigger trumps_activity_room_closed before delete on public.trumps_rooms
for each row execute function private.trumps_log_room_closed();

create or replace function public.trumps_admin_history(p_access_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select access_key_hash into v_hash from private.trumps_admin_settings where singleton;
  if v_hash is null or extensions.crypt(coalesce(p_access_key,''),v_hash) <> v_hash then
    raise exception 'Invalid owner key';
  end if;
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'completedGames',(select count(*) from private.trumps_game_history),
      'gamesStarted',(select count(*) from private.trumps_activity_log where event_type='game_started'),
      'roomsCreated',(select count(*) from private.trumps_activity_log where event_type='room_created'),
      'playerJoins',(select count(*) from private.trumps_activity_log where event_type='player_joined')
    ),
    'games',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'roomCode',g.room_code,'gameNumber',g.game_number,
      'startedAt',g.started_at,'completedAt',g.completed_at,'durationSeconds',g.duration_seconds,
      'players',g.players,'winnerNames',g.winner_names,'winningScore',g.winning_score,'hands',g.hand_history
    ) order by g.completed_at desc) from private.trumps_game_history g),'[]'::jsonb),
    'recentActivity',coalesce((select jsonb_agg(jsonb_build_object(
      'type',a.event_type,'roomCode',a.room_code,'at',a.occurred_at,'details',a.details
    ) order by a.occurred_at desc) from (select * from private.trumps_activity_log order by occurred_at desc limit 100) a),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function private.trumps_log_room_created() from public, anon, authenticated;
revoke all on function private.trumps_log_player_joined() from public, anon, authenticated;
revoke all on function private.trumps_log_game_started() from public, anon, authenticated;
revoke all on function private.trumps_archive_progress() from public, anon, authenticated;
revoke all on function private.trumps_log_room_closed() from public, anon, authenticated;
revoke all on function public.trumps_admin_history(text) from public, anon;
grant execute on function public.trumps_admin_history(text) to authenticated;
