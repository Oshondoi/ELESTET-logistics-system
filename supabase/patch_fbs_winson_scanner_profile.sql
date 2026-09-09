-- Add the first client-confirmed scanner model to the controlled FBS catalog.

begin;

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
      'Datalogic QuickScan QD2590',
      'Winson WNI-S744/Y'
    )
  );

-- The RPC keeps its own allowlist, so it must be updated together with the
-- table constraint. Otherwise the UI receives "Unknown scanner model" before
-- the row ever reaches the constraint above.
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
    'Datalogic QuickScan QD2590',
    'Winson WNI-S744/Y'
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

commit;
