begin;

-- Device identity and the selected scanner are current mutable session state.
-- The separate history table below keeps immutable snapshots of every change.
alter table public.fbs_marking_sessions
  add column if not exists device_named boolean not null default false,
  add column if not exists device_identity_required boolean not null default false,
  add column if not exists active_scanner_model text,
  add column if not exists scanner_test_status text not null default 'untested',
  add column if not exists scanner_tested_at timestamptz;

alter table public.fbs_marking_sessions
  drop constraint if exists fbs_marking_sessions_scanner_test_status_check;
alter table public.fbs_marking_sessions
  add constraint fbs_marking_sessions_scanner_test_status_check
  check (scanner_test_status in ('untested', 'passed', 'failed'));

alter table public.fbs_marking_sessions
  drop constraint if exists fbs_marking_sessions_active_scanner_model_check;
alter table public.fbs_marking_sessions
  add constraint fbs_marking_sessions_active_scanner_model_check
  check (
    active_scanner_model is null
    or active_scanner_model in (
      'АТОЛ SB5100',
      'MERTECH 2310 P2D HR SUPERLEAD',
      'Zebra DS2208',
      'Honeywell Voyager XP 1470g',
      'Datalogic QuickScan QD2590'
    )
  );

create table if not exists public.fbs_marking_history (
  id bigint generated always as identity primary key,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  account_id uuid,
  account_name text,
  store_id uuid,
  store_name text,
  session_id uuid,
  pair_id uuid,
  order_id text,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  device_id text,
  device_name text,
  scanner_model text,
  scanner_test_status text,
  event_data jsonb not null default '{}'::jsonb
);

create index if not exists fbs_marking_history_account_time_idx
  on public.fbs_marking_history(account_id, occurred_at desc);
create index if not exists fbs_marking_history_store_time_idx
  on public.fbs_marking_history(store_id, occurred_at desc);
create index if not exists fbs_marking_history_session_time_idx
  on public.fbs_marking_history(session_id, occurred_at);
create index if not exists fbs_marking_history_pair_time_idx
  on public.fbs_marking_history(pair_id, occurred_at);

alter table public.fbs_marking_history enable row level security;
revoke all on table public.fbs_marking_history from public, anon, authenticated;

-- Only trusted database triggers/functions can append events. There is
-- deliberately no user-facing INSERT/UPDATE/DELETE policy.
create or replace function public.fbs_append_marking_history(
  p_event_type text,
  p_context jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_account_id uuid;
  v_store_id uuid;
  v_session_id uuid;
  v_pair_id uuid;
  v_actor_user_id uuid;
  v_actor_name text;
  v_actor_email text;
begin
  v_session_id := nullif(p_context ->> 'session_id', '')::uuid;
  if v_session_id is not null then
    select * into v_session
    from public.fbs_marking_sessions
    where id = v_session_id;
  end if;

  v_account_id := coalesce(
    nullif(p_context ->> 'account_id', '')::uuid,
    v_session.account_id
  );
  v_store_id := coalesce(
    nullif(p_context ->> 'store_id', '')::uuid,
    v_session.store_id
  );
  v_pair_id := nullif(p_context ->> 'pair_id', '')::uuid;
  v_actor_user_id := coalesce(
    nullif(p_context ->> 'actor_user_id', '')::uuid,
    auth.uid(),
    v_session.created_by
  );

  select nullif(trim(profile.full_name), '')
  into v_actor_name
  from public.profiles profile
  where profile.user_id = v_actor_user_id;

  select user_row.email::text
  into v_actor_email
  from auth.users user_row
  where user_row.id = v_actor_user_id;

  insert into public.fbs_marking_history (
    event_type, account_id, account_name, store_id, store_name,
    session_id, pair_id, order_id,
    actor_user_id, actor_name, actor_email,
    device_id, device_name, scanner_model, scanner_test_status,
    event_data
  )
  values (
    left(coalesce(nullif(trim(p_event_type), ''), 'unknown'), 80),
    v_account_id,
    (select account.name from public.accounts account where account.id = v_account_id),
    v_store_id,
    (select store.name from public.stores store where store.id = v_store_id),
    v_session_id,
    v_pair_id,
    nullif(p_context ->> 'order_id', ''),
    v_actor_user_id,
    v_actor_name,
    v_actor_email,
    coalesce(nullif(p_context ->> 'device_id', ''), v_session.device_id),
    coalesce(nullif(p_context ->> 'device_name', ''), v_session.device_name),
    case
      when p_context ? 'scanner_model' then nullif(p_context ->> 'scanner_model', '')
      else v_session.active_scanner_model
    end,
    coalesce(nullif(p_context ->> 'scanner_test_status', ''), v_session.scanner_test_status, 'untested'),
    coalesce(p_context -> 'event_data', '{}'::jsonb)
  );
end;
$$;

revoke all on function public.fbs_append_marking_history(text, jsonb)
  from public, anon, authenticated;

-- Service-side writers (the WB Edge Function) can provide only immutable
-- identifiers. This trigger fills the human-readable snapshots at insert time.
create or replace function public.enrich_fbs_marking_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
begin
  if new.session_id is not null then
    select * into v_session
    from public.fbs_marking_sessions
    where id = new.session_id;
  end if;

  new.account_id := coalesce(new.account_id, v_session.account_id);
  new.store_id := coalesce(new.store_id, v_session.store_id);
  new.actor_user_id := coalesce(new.actor_user_id, auth.uid(), v_session.created_by);
  new.device_id := coalesce(new.device_id, v_session.device_id);
  new.device_name := coalesce(new.device_name, v_session.device_name);
  new.scanner_model := coalesce(new.scanner_model, v_session.active_scanner_model);
  new.scanner_test_status := coalesce(new.scanner_test_status, v_session.scanner_test_status, 'untested');
  new.account_name := coalesce(
    new.account_name,
    (select account.name from public.accounts account where account.id = new.account_id)
  );
  new.store_name := coalesce(
    new.store_name,
    (select store.name from public.stores store where store.id = new.store_id)
  );
  new.actor_name := coalesce(
    new.actor_name,
    (select nullif(trim(profile.full_name), '') from public.profiles profile where profile.user_id = new.actor_user_id)
  );
  new.actor_email := coalesce(
    new.actor_email,
    (select user_row.email::text from auth.users user_row where user_row.id = new.actor_user_id)
  );
  return new;
end;
$$;

drop trigger if exists aaa_enrich_fbs_marking_history_trigger on public.fbs_marking_history;
create trigger aaa_enrich_fbs_marking_history_trigger
before insert on public.fbs_marking_history
for each row execute function public.enrich_fbs_marking_history();

revoke all on function public.enrich_fbs_marking_history()
  from public, anon, authenticated;

create or replace function public.fbs_marking_history_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'История сканирования КИЗ неизменяема';
end;
$$;

drop trigger if exists protect_fbs_marking_history_update on public.fbs_marking_history;
create trigger protect_fbs_marking_history_update
before update or delete on public.fbs_marking_history
for each row execute function public.fbs_marking_history_is_immutable();

revoke all on function public.fbs_marking_history_is_immutable()
  from public, anon, authenticated;

create or replace function public.audit_fbs_marking_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb;
begin
  v_context := jsonb_build_object(
    'account_id', new.account_id,
    'store_id', new.store_id,
    'session_id', new.id,
    'actor_user_id', coalesce(auth.uid(), new.created_by),
    'device_id', new.device_id,
    'device_name', new.device_name,
    'scanner_model', new.active_scanner_model,
    'scanner_test_status', new.scanner_test_status
  );

  if tg_op = 'INSERT' then
    perform public.fbs_append_marking_history(
      'session_started',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'device_named', new.device_named,
        'device_identity_required', new.device_identity_required,
        'started_at', new.started_at
      ))
    );
    return new;
  end if;

  if new.device_named and not old.device_named then
    perform public.fbs_append_marking_history(
      'device_named',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_name', old.device_name,
        'new_name', new.device_name
      ))
    );
  elsif new.device_named and old.device_named and new.device_name is distinct from old.device_name then
    perform public.fbs_append_marking_history(
      'device_renamed',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_name', old.device_name,
        'new_name', new.device_name
      ))
    );
  elsif not new.device_named and old.device_named then
    perform public.fbs_append_marking_history(
      'device_name_cleared',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_name', old.device_name
      ))
    );
  end if;

  if new.active_scanner_model is distinct from old.active_scanner_model then
    perform public.fbs_append_marking_history(
      case
        when old.active_scanner_model is null then 'scanner_selected'
        when new.active_scanner_model is null then 'scanner_cleared'
        else 'scanner_changed'
      end,
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_model', old.active_scanner_model,
        'new_model', new.active_scanner_model
      ))
    );
  end if;

  if new.scanner_test_status is distinct from old.scanner_test_status
     or new.scanner_tested_at is distinct from old.scanner_tested_at then
    perform public.fbs_append_marking_history(
      'scanner_test_status_changed',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_status', old.scanner_test_status,
        'new_status', new.scanner_test_status,
        'tested_at', new.scanner_tested_at
      ))
    );
  end if;

  if new.status is distinct from old.status then
    perform public.fbs_append_marking_history(
      case
        when new.status = 'submitting' then 'session_submission_started'
        when new.status = 'completed' then 'session_completed'
        when new.status = 'partial' then 'session_partial'
        when new.status = 'cancelled' then 'session_cancelled'
        else 'session_status_changed'
      end,
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_status', old.status,
        'new_status', new.status,
        'completed_at', new.completed_at
      ))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_fbs_marking_session_trigger on public.fbs_marking_sessions;
create trigger audit_fbs_marking_session_trigger
after insert or update on public.fbs_marking_sessions
for each row execute function public.audit_fbs_marking_session();

revoke all on function public.audit_fbs_marking_session()
  from public, anon, authenticated;

create or replace function public.audit_fbs_marking_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fbs_marking_pairs%rowtype;
  v_session public.fbs_marking_sessions%rowtype;
  v_old_session public.fbs_marking_sessions%rowtype;
  v_context jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select * into v_session
  from public.fbs_marking_sessions
  where id = v_row.session_id;

  v_context := jsonb_build_object(
    'account_id', v_row.account_id,
    'store_id', v_row.store_id,
    'session_id', v_row.session_id,
    'pair_id', v_row.id,
    'order_id', v_row.order_id,
    'actor_user_id', coalesce(auth.uid(), v_session.created_by, v_row.created_by),
    'device_id', v_session.device_id,
    'device_name', v_session.device_name,
    'scanner_model', v_session.active_scanner_model,
    'scanner_test_status', v_session.scanner_test_status
  );

  if tg_op = 'INSERT' then
    perform public.fbs_append_marking_history(
      'pair_created',
      v_context || jsonb_build_object('event_data', jsonb_build_object('pair', to_jsonb(new)))
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.fbs_append_marking_history(
      'pair_deleted',
      v_context || jsonb_build_object('event_data', jsonb_build_object('pair', to_jsonb(old)))
    );
    return old;
  end if;

  if new.session_id is distinct from old.session_id then
    select * into v_old_session
    from public.fbs_marking_sessions
    where id = old.session_id;
    perform public.fbs_append_marking_history(
      'pair_recovered',
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'source_session_id', old.session_id,
        'source_user_id', v_old_session.created_by,
        'source_device_id', v_old_session.device_id,
        'source_device_name', v_old_session.device_name,
        'target_session_id', new.session_id,
        'target_user_id', v_session.created_by,
        'target_device_id', v_session.device_id,
        'target_device_name', v_session.device_name,
        'pair', to_jsonb(new)
      ))
    );
  end if;

  if new.status is distinct from old.status then
    perform public.fbs_append_marking_history(
      case
        when new.status = 'sent' then 'pair_sent_to_wb'
        when new.status = 'error' then 'pair_send_failed'
        else 'pair_status_changed'
      end,
      v_context || jsonb_build_object('event_data', jsonb_build_object(
        'old_status', old.status,
        'new_status', new.status,
        'error', new.error,
        'sent_at', new.sent_at,
        'pair', to_jsonb(new)
      ))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_fbs_marking_pair_trigger on public.fbs_marking_pairs;
create trigger audit_fbs_marking_pair_trigger
after insert or update or delete on public.fbs_marking_pairs
for each row execute function public.audit_fbs_marking_pair();

revoke all on function public.audit_fbs_marking_pair()
  from public, anon, authenticated;

-- Rolling-deploy safeguard: old cached clients do not set
-- device_identity_required and continue to work until they reload. The new UI
-- enables the requirement immediately and all server-side work is then gated.
create or replace function public.guard_named_fbs_marking_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.device_identity_required and not new.device_named
     and new.status <> 'cancelled'
     and (
       new.pending_order_id is distinct from old.pending_order_id
       or new.pending_wb_qr is distinct from old.pending_wb_qr
       or new.pending_product_barcode is distinct from old.pending_product_barcode
       or new.pending_locked_until is distinct from old.pending_locked_until
       or new.box_scan_enabled is distinct from old.box_scan_enabled
       or new.barcode_scan_enabled is distinct from old.barcode_scan_enabled
       or new.active_box_id is distinct from old.active_box_id
       or (new.status = 'submitting' and old.status is distinct from new.status)
     ) then
    raise exception 'Сначала присвойте имя устройству';
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_named_fbs_marking_session_trigger on public.fbs_marking_sessions;
create trigger aaa_guard_named_fbs_marking_session_trigger
before update on public.fbs_marking_sessions
for each row execute function public.guard_named_fbs_marking_session();

create or replace function public.guard_named_fbs_marking_pair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_session from public.fbs_marking_sessions where id = new.session_id;
  elsif tg_op = 'UPDATE' then
    select * into v_session from public.fbs_marking_sessions where id = new.session_id;
  else
    return old;
  end if;

  if v_session.device_identity_required and not v_session.device_named then
    raise exception 'Сначала присвойте имя устройству';
  end if;
  return new;
end;
$$;

drop trigger if exists aaa_guard_named_fbs_marking_pair_trigger on public.fbs_marking_pairs;
create trigger aaa_guard_named_fbs_marking_pair_trigger
before insert or update on public.fbs_marking_pairs
for each row execute function public.guard_named_fbs_marking_pair();

revoke all on function public.guard_named_fbs_marking_session(), public.guard_named_fbs_marking_pair()
  from public, anon, authenticated;

create or replace function public.configure_fbs_marking_device(
  p_session_id uuid,
  p_device_id text,
  p_device_name text,
  p_device_named boolean,
  p_scanner_model text,
  p_scanner_test_status text default 'untested'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_name text := left(trim(coalesce(p_device_name, '')), 80);
  v_model text := nullif(trim(coalesce(p_scanner_model, '')), '');
  v_status text := coalesce(nullif(trim(p_scanner_test_status), ''), 'untested');
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id
    and created_by = auth.uid()
    and device_id = p_device_id
  for update;

  if v_session.id is null then
    raise exception 'Сессия этого устройства не найдена';
  end if;
  if not public.fbs_can_access_store(v_session.store_id, 'fbs_assembly') then
    raise exception 'Нет доступа к сканированию этого магазина';
  end if;
  if coalesce(p_device_named, false) and (
    char_length(v_name) not between 2 and 80
    or v_name = 'Устройство'
    or v_name ~* '^Браузер [0-9a-f]{6}$'
  ) then
    raise exception 'Введите понятное имя устройства: от 2 до 80 символов';
  end if;
  if v_model is not null and v_model not in (
    'АТОЛ SB5100',
    'MERTECH 2310 P2D HR SUPERLEAD',
    'Zebra DS2208',
    'Honeywell Voyager XP 1470g',
    'Datalogic QuickScan QD2590'
  ) then
    raise exception 'Неизвестная модель сканера';
  end if;
  if v_status not in ('untested', 'passed', 'failed') then
    raise exception 'Некорректный результат теста сканера';
  end if;

  update public.fbs_marking_sessions
  set device_name = case
        when coalesce(p_device_named, false) then v_name
        else 'Устройство'
      end,
      device_named = coalesce(p_device_named, false),
      device_identity_required = true,
      active_scanner_model = v_model,
      scanner_test_status = case when v_model is null then 'untested' else v_status end,
      scanner_tested_at = case
        when v_model is null or v_status = 'untested' then null
        when scanner_test_status is distinct from v_status then now()
        else scanner_tested_at
      end,
      pending_order_id = case
        when coalesce(p_device_named, false) and pending_locked_until <= now() then null
        else pending_order_id
      end,
      pending_wb_qr = case
        when coalesce(p_device_named, false) and pending_locked_until <= now() then null
        else pending_wb_qr
      end,
      pending_product_barcode = case
        when coalesce(p_device_named, false) and pending_locked_until <= now() then null
        else pending_product_barcode
      end,
      pending_locked_until = case
        when coalesce(p_device_named, false) and pending_locked_until <= now() then null
        else pending_locked_until
      end,
      last_seen_at = case when status in ('active', 'partial') then now() else last_seen_at end,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session);
end;
$$;

revoke all on function public.configure_fbs_marking_device(uuid, text, text, boolean, text, text)
  from public, anon;
grant execute on function public.configure_fbs_marking_device(uuid, text, text, boolean, text, text)
  to authenticated;

-- Keep the existing four-argument API for cached clients. Existing sessions
-- are no longer silently renamed to "Browser ..." every time they open.
create or replace function public.start_fbs_marking_session(
  p_account_id uuid,
  p_store_id uuid,
  p_device_id text,
  p_device_name text default 'Устройство'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.fbs_marking_sessions%rowtype;
  v_name text := left(coalesce(nullif(trim(p_device_name), ''), 'Устройство'), 80);
  v_named boolean;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then
    raise exception 'Invalid device identifier';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_assembly')
  ) then raise exception 'No permission to scan this store'; end if;

  v_named := char_length(v_name) between 2 and 80
    and v_name <> 'Устройство'
    and v_name !~* '^Браузер [0-9a-f]{6}$';

  select * into v_session
  from public.fbs_marking_sessions
  where store_id = p_store_id and created_by = v_user_id and device_id = p_device_id
    and status in ('active', 'submitting', 'partial')
  order by started_at desc limit 1 for update;

  if v_session.id is null then
    insert into public.fbs_marking_sessions(
      account_id, store_id, created_by, device_id, device_name, device_named
    )
    values (p_account_id, p_store_id, v_user_id, p_device_id, v_name, v_named)
    returning * into v_session;
  else
    update public.fbs_marking_sessions
    set last_seen_at = now(), updated_at = now(),
        pending_order_id = case
          when not (device_identity_required and not device_named) and pending_locked_until <= now() then null
          else pending_order_id
        end,
        pending_wb_qr = case
          when not (device_identity_required and not device_named) and pending_locked_until <= now() then null
          else pending_wb_qr
        end,
        pending_product_barcode = case
          when not (device_identity_required and not device_named) and pending_locked_until <= now() then null
          else pending_product_barcode
        end,
        pending_locked_until = case
          when not (device_identity_required and not device_named) and pending_locked_until <= now() then null
          else pending_locked_until
        end
    where id = v_session.id returning * into v_session;
  end if;
  return to_jsonb(v_session);
end;
$$;

revoke all on function public.start_fbs_marking_session(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.start_fbs_marking_session(uuid, uuid, text, text)
  to authenticated;

create or replace function public.recover_fbs_marking_session(
  p_target_session_id uuid,
  p_source_session_id uuid,
  p_device_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.fbs_marking_sessions%rowtype;
  v_source public.fbs_marking_sessions%rowtype;
  v_moved integer := 0;
  v_source_actor_name text;
  v_source_actor_email text;
begin
  perform 1 from public.fbs_marking_sessions
  where id in (p_target_session_id, p_source_session_id)
  order by id for update;

  select * into v_target from public.fbs_marking_sessions where id = p_target_session_id;
  select * into v_source from public.fbs_marking_sessions where id = p_source_session_id;
  if v_target.id is null or v_target.created_by <> auth.uid() or v_target.device_id <> p_device_id
     or v_target.status not in ('active', 'partial') then
    raise exception 'Активная сессия текущего устройства не найдена';
  end if;
  if v_target.device_identity_required and not v_target.device_named then
    raise exception 'Сначала присвойте имя устройству';
  end if;
  if v_source.id is null or v_source.id = v_target.id
     or v_source.store_id <> v_target.store_id or v_source.account_id <> v_target.account_id
     or v_source.status not in ('active', 'partial') then
    raise exception 'Прерванная сессия не найдена';
  end if;
  if v_source.last_seen_at > now() - interval '2 minutes' then
    raise exception 'Другое устройство ещё активно';
  end if;
  if not public.fbs_can_access_store(v_source.store_id, 'fbs_assembly') then
    raise exception 'Нет доступа к сессии';
  end if;

  update public.fbs_marking_pairs
  set session_id = v_target.id, updated_at = now()
  where session_id = v_source.id and status in ('draft', 'error');
  get diagnostics v_moved = row_count;

  select nullif(trim(profile.full_name), '') into v_source_actor_name
  from public.profiles profile where profile.user_id = v_source.created_by;
  select user_row.email::text into v_source_actor_email
  from auth.users user_row where user_row.id = v_source.created_by;

  perform public.fbs_append_marking_history(
    'session_recovered',
    jsonb_build_object(
      'account_id', v_target.account_id,
      'store_id', v_target.store_id,
      'session_id', v_target.id,
      'actor_user_id', auth.uid(),
      'device_id', v_target.device_id,
      'device_name', v_target.device_name,
      'scanner_model', v_target.active_scanner_model,
      'scanner_test_status', v_target.scanner_test_status,
      'event_data', jsonb_build_object(
        'source_session_id', v_source.id,
        'source_user_id', v_source.created_by,
        'source_user_name', v_source_actor_name,
        'source_user_email', v_source_actor_email,
        'source_device_id', v_source.device_id,
        'source_device_name', v_source.device_name,
        'source_started_at', v_source.started_at,
        'source_last_seen_at', v_source.last_seen_at,
        'target_session_id', v_target.id,
        'target_user_id', v_target.created_by,
        'target_device_id', v_target.device_id,
        'target_device_name', v_target.device_name,
        'pair_count', v_moved
      )
    )
  );

  update public.fbs_marking_sessions
  set status = 'cancelled', pending_order_id = null, pending_wb_qr = null,
      pending_product_barcode = null, pending_locked_until = null,
      active_box_id = null, completed_at = now(), updated_at = now()
  where id = v_source.id;
  update public.fbs_marking_sessions
  set last_seen_at = now(), updated_at = now()
  where id = v_target.id;
  return v_moved;
end;
$$;

revoke all on function public.recover_fbs_marking_session(uuid, uuid, text)
  from public, anon;
grant execute on function public.recover_fbs_marking_session(uuid, uuid, text)
  to authenticated;

create or replace function public.discard_fbs_marking_session(
  p_source_session_id uuid,
  p_target_session_id uuid,
  p_device_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.fbs_marking_sessions%rowtype;
  v_source public.fbs_marking_sessions%rowtype;
  v_deleted integer := 0;
  v_source_actor_name text;
  v_source_actor_email text;
begin
  perform 1 from public.fbs_marking_sessions
  where id in (p_target_session_id, p_source_session_id)
  order by id for update;

  select * into v_target from public.fbs_marking_sessions where id = p_target_session_id;
  select * into v_source from public.fbs_marking_sessions where id = p_source_session_id;

  if v_target.id is null or v_target.created_by <> auth.uid() or v_target.device_id <> p_device_id
     or v_target.status not in ('active', 'partial') then
    raise exception 'Активная сессия текущего устройства не найдена';
  end if;
  if v_target.device_identity_required and not v_target.device_named then
    raise exception 'Сначала присвойте имя устройству';
  end if;
  if v_source.id is null or v_source.id = v_target.id
     or v_source.store_id <> v_target.store_id or v_source.account_id <> v_target.account_id
     or v_source.status not in ('active', 'partial') then
    raise exception 'Прерванная сессия не найдена';
  end if;
  if v_source.last_seen_at > now() - interval '2 minutes' then
    raise exception 'Другое устройство ещё активно';
  end if;
  if not public.fbs_can_access_store(v_source.store_id, 'fbs_assembly') then
    raise exception 'Нет доступа к сессии';
  end if;

  select count(*)::integer into v_deleted
  from public.fbs_marking_pairs
  where session_id = v_source.id and status in ('draft', 'error');

  select nullif(trim(profile.full_name), '') into v_source_actor_name
  from public.profiles profile where profile.user_id = v_source.created_by;
  select user_row.email::text into v_source_actor_email
  from auth.users user_row where user_row.id = v_source.created_by;

  perform public.fbs_append_marking_history(
    'session_discarded',
    jsonb_build_object(
      'account_id', v_target.account_id,
      'store_id', v_target.store_id,
      'session_id', v_target.id,
      'actor_user_id', auth.uid(),
      'device_id', v_target.device_id,
      'device_name', v_target.device_name,
      'scanner_model', v_target.active_scanner_model,
      'scanner_test_status', v_target.scanner_test_status,
      'event_data', jsonb_build_object(
        'source_session_id', v_source.id,
        'source_user_id', v_source.created_by,
        'source_user_name', v_source_actor_name,
        'source_user_email', v_source_actor_email,
        'source_device_id', v_source.device_id,
        'source_device_name', v_source.device_name,
        'source_started_at', v_source.started_at,
        'source_last_seen_at', v_source.last_seen_at,
        'actor_session_id', v_target.id,
        'actor_device_id', v_target.device_id,
        'actor_device_name', v_target.device_name,
        'pair_count', v_deleted
      )
    )
  );

  delete from public.fbs_marking_pairs
  where session_id = v_source.id and status in ('draft', 'error');

  update public.fbs_marking_sessions
  set status = 'cancelled', pending_order_id = null, pending_wb_qr = null,
      pending_product_barcode = null, pending_locked_until = null,
      active_box_id = null, completed_at = now(), updated_at = now()
  where id = v_source.id;

  return v_deleted;
end;
$$;

revoke all on function public.discard_fbs_marking_session(uuid, uuid, text)
  from public, anon;
grant execute on function public.discard_fbs_marking_session(uuid, uuid, text)
  to authenticated;

commit;
