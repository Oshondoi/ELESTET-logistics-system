-- Safe recovery and explicit deletion of interrupted FBS marking work.

create or replace function public.recover_fbs_marking_session(
  p_target_session_id uuid,
  p_source_session_id uuid,
  p_device_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.fbs_marking_sessions%rowtype;
  v_source public.fbs_marking_sessions%rowtype;
  v_moved integer := 0;
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
  if v_source.id is null or v_source.id = v_target.id
     or v_source.store_id <> v_target.store_id or v_source.account_id <> v_target.account_id
     or v_source.status not in ('active', 'partial') then
    raise exception 'Прерванная сессия не найдена';
  end if;
  if v_source.last_seen_at > now() - interval '2 minutes' then
    raise exception 'Другое устройство ещё активно';
  end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_source.account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к сессии'; end if;

  update public.fbs_marking_pairs
  set session_id = v_target.id, updated_at = now()
  where session_id = v_source.id and status in ('draft', 'error');
  get diagnostics v_moved = row_count;

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

create or replace function public.discard_fbs_marking_session(
  p_source_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.fbs_marking_sessions%rowtype;
  v_deleted integer := 0;
begin
  select * into v_source
  from public.fbs_marking_sessions
  where id = p_source_session_id
  for update;

  if v_source.id is null or v_source.status not in ('active', 'partial') then
    raise exception 'Прерванная сессия не найдена';
  end if;
  if v_source.last_seen_at > now() - interval '2 minutes' then
    raise exception 'Другое устройство ещё активно';
  end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_source.account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к сессии'; end if;

  -- Sent rows remain as an audit trail. The existing AFTER DELETE trigger
  -- releases warehouse reservations for every deleted draft/error pair.
  delete from public.fbs_marking_pairs
  where session_id = v_source.id and status in ('draft', 'error');
  get diagnostics v_deleted = row_count;

  update public.fbs_marking_sessions
  set status = 'cancelled', pending_order_id = null, pending_wb_qr = null,
      pending_product_barcode = null, pending_locked_until = null,
      active_box_id = null, completed_at = now(), updated_at = now()
  where id = v_source.id;

  return v_deleted;
end;
$$;

revoke all on function public.recover_fbs_marking_session(uuid, uuid, text) from public, anon;
grant execute on function public.recover_fbs_marking_session(uuid, uuid, text) to authenticated;
revoke all on function public.discard_fbs_marking_session(uuid) from public, anon;
grant execute on function public.discard_fbs_marking_session(uuid) to authenticated;
