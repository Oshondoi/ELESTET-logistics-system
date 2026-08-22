begin;

create table if not exists public.fbs_marking_preferences (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  box_scan_enabled boolean not null default true,
  barcode_scan_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.fbs_marking_preferences enable row level security;

drop policy if exists "fbs marking preferences: account members read" on public.fbs_marking_preferences;
create policy "fbs marking preferences: account members read"
  on public.fbs_marking_preferences for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_marking_preferences.account_id
      and member.user_id = auth.uid()
  ));

create or replace function public.apply_fbs_marking_preferences(
  p_session_id uuid,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_preferences public.fbs_marking_preferences%rowtype;
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;

  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;

  insert into public.fbs_marking_preferences(account_id, updated_by)
  values (v_session.account_id, auth.uid())
  on conflict (account_id) do nothing;

  select * into v_preferences
  from public.fbs_marking_preferences
  where account_id = v_session.account_id;

  if v_session.pending_order_id is null and v_session.pending_product_barcode is null then
    update public.fbs_marking_sessions
    set box_scan_enabled = v_preferences.box_scan_enabled,
        barcode_scan_enabled = v_preferences.barcode_scan_enabled,
        active_box_id = case when v_preferences.box_scan_enabled then active_box_id else null end,
        last_seen_at = now(),
        updated_at = now()
    where id = v_session.id
    returning * into v_session;
  end if;

  return to_jsonb(v_session);
end;
$$;

create or replace function public.set_fbs_marking_barcode_mode(
  p_session_id uuid,
  p_device_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Настройку нельзя менять внутри незавершённой пары';
  end if;

  insert into public.fbs_marking_preferences(account_id, barcode_scan_enabled, updated_by, updated_at)
  values (v_session.account_id, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (account_id) do update
  set barcode_scan_enabled = excluded.barcode_scan_enabled,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  update public.fbs_marking_sessions
  set barcode_scan_enabled = coalesce(p_enabled, false),
      last_seen_at = now(), updated_at = now()
  where id = v_session.id
  returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.set_fbs_marking_box_mode(
  p_session_id uuid,
  p_device_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Настройку нельзя менять внутри незавершённой пары';
  end if;

  insert into public.fbs_marking_preferences(account_id, box_scan_enabled, updated_by, updated_at)
  values (v_session.account_id, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (account_id) do update
  set box_scan_enabled = excluded.box_scan_enabled,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  update public.fbs_marking_sessions
  set box_scan_enabled = coalesce(p_enabled, false),
      active_box_id = case when coalesce(p_enabled, false) then active_box_id else null end,
      last_seen_at = now(), updated_at = now()
  where id = v_session.id
  returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

revoke all on function public.apply_fbs_marking_preferences(uuid, text) from public, anon;
grant execute on function public.apply_fbs_marking_preferences(uuid, text) to authenticated;
revoke all on function public.set_fbs_marking_barcode_mode(uuid, text, boolean) from public, anon;
grant execute on function public.set_fbs_marking_barcode_mode(uuid, text, boolean) to authenticated;
revoke all on function public.set_fbs_marking_box_mode(uuid, text, boolean) from public, anon;
grant execute on function public.set_fbs_marking_box_mode(uuid, text, boolean) to authenticated;

commit;
