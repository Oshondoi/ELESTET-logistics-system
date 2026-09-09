-- Data-driven scanner catalog for FBS KIZ scanning.
-- Existing clients keep using configure_fbs_marking_device(text model), while
-- new scanner models can be created and published from the platform admin UI.

begin;

create table if not exists public.fbs_scanner_models (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  display_name text not null unique,
  connection_type text not null default 'keyboard',
  status text not null default 'draft',
  serial_options jsonb not null default '{}'::jsonb,
  scan_options jsonb not null default '{}'::jsonb,
  setup_barcodes jsonb not null default '[]'::jsonb,
  restore_barcodes jsonb not null default '[]'::jsonb,
  instructions text not null default '',
  warning_text text not null default '',
  profile_version integer not null default 1,
  sort_order integer not null default 100,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fbs_scanner_models_connection_type_check
    check (connection_type in ('keyboard', 'web_serial')),
  constraint fbs_scanner_models_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint fbs_scanner_models_brand_length_check
    check (char_length(trim(brand)) between 1 and 80),
  constraint fbs_scanner_models_model_length_check
    check (char_length(trim(model)) between 1 and 120),
  constraint fbs_scanner_models_display_name_length_check
    check (char_length(trim(display_name)) between 2 and 200),
  constraint fbs_scanner_models_profile_version_check
    check (profile_version > 0),
  constraint fbs_scanner_models_serial_options_check
    check (jsonb_typeof(serial_options) = 'object'),
  constraint fbs_scanner_models_scan_options_check
    check (jsonb_typeof(scan_options) = 'object'),
  constraint fbs_scanner_models_setup_barcodes_check
    check (jsonb_typeof(setup_barcodes) = 'array'),
  constraint fbs_scanner_models_restore_barcodes_check
    check (jsonb_typeof(restore_barcodes) = 'array')
);

create unique index if not exists fbs_scanner_models_display_name_lower_uidx
  on public.fbs_scanner_models (lower(display_name));
create index if not exists fbs_scanner_models_status_sort_idx
  on public.fbs_scanner_models (status, sort_order, display_name);

create table if not exists public.fbs_scanner_model_history (
  id bigint generated always as identity primary key,
  scanner_model_id uuid not null references public.fbs_scanner_models(id) on delete restrict,
  action text not null,
  profile_version integer not null,
  actor_user_id uuid,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists fbs_scanner_model_history_model_idx
  on public.fbs_scanner_model_history (scanner_model_id, created_at desc);

alter table public.fbs_scanner_models enable row level security;
alter table public.fbs_scanner_model_history enable row level security;
revoke all on table public.fbs_scanner_models, public.fbs_scanner_model_history from anon, authenticated;

insert into public.fbs_scanner_models (
  brand, model, display_name, connection_type, status, sort_order
)
select seed.brand, seed.model, seed.display_name, 'keyboard', 'active', seed.sort_order
from (values
  ('АТОЛ', 'SB5100', 'АТОЛ SB5100', 10),
  ('MERTECH', '2310 P2D HR SUPERLEAD', 'MERTECH 2310 P2D HR SUPERLEAD', 20),
  ('Zebra', 'DS2208', 'Zebra DS2208', 30),
  ('Honeywell', 'Voyager XP 1470g', 'Honeywell Voyager XP 1470g', 40),
  ('Datalogic', 'QuickScan QD2590', 'Datalogic QuickScan QD2590', 50)
) as seed(brand, model, display_name, sort_order)
where not exists (
  select 1 from public.fbs_scanner_models current_model
  where lower(current_model.display_name) = lower(seed.display_name)
);

insert into public.fbs_scanner_models (
  brand,
  model,
  display_name,
  connection_type,
  status,
  serial_options,
  scan_options,
  setup_barcodes,
  restore_barcodes,
  instructions,
  warning_text,
  sort_order
)
select
  'Winson',
  'WNI-S744/Y',
  'Winson WNI-S744/Y',
  'web_serial',
  'active',
  '{"baudRate":9600,"dataBits":8,"stopBits":1,"parity":"none","flowControl":"none"}'::jsonb,
  '{"maxPacketLength":4096,"packetTerminator":"cr_lf"}'::jsonb,
  '[
    {"label":"1. Войти в настройки","value":"@SET","format":"CODE128"},
    {"label":"2. Включить USB VCP (виртуальный COM)","value":"WN-W-L1001","format":"CODE128"},
    {"label":"3. Сохранить настройки","value":"@END","format":"CODE128"}
  ]'::jsonb,
  '[
    {"label":"1. Войти в настройки","value":"@SET","format":"CODE128"},
    {"label":"2. Включить обычный USB","value":"WN-W-L1000","format":"CODE128"},
    {"label":"3. Сохранить настройки","value":"@END","format":"CODE128"}
  ]'::jsonb,
  'Подключите USB-приёмник к компьютеру. Затем отсканируйте коды строго сверху вниз.',
  'Если COM-порт не появился в Windows, может потребоваться USB VCP-драйвер производителя.',
  60
where not exists (
  select 1 from public.fbs_scanner_models current_model
  where lower(current_model.display_name) = lower('Winson WNI-S744/Y')
);

alter table public.fbs_marking_sessions
  add column if not exists active_scanner_profile_version integer;

alter table public.fbs_marking_sessions
  drop constraint if exists fbs_marking_sessions_active_scanner_model_check;

update public.fbs_marking_sessions session
set active_scanner_profile_version = model.profile_version
from public.fbs_scanner_models model
where session.active_scanner_model = model.display_name
  and session.active_scanner_profile_version is null;

create or replace function public.get_fbs_scanner_models()
returns table (
  id uuid,
  brand text,
  model text,
  display_name text,
  connection_type text,
  serial_options jsonb,
  scan_options jsonb,
  setup_barcodes jsonb,
  restore_barcodes jsonb,
  instructions text,
  warning_text text,
  profile_version integer,
  sort_order integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    scanner.id,
    scanner.brand,
    scanner.model,
    scanner.display_name,
    scanner.connection_type,
    scanner.serial_options,
    scanner.scan_options,
    scanner.setup_barcodes,
    scanner.restore_barcodes,
    scanner.instructions,
    scanner.warning_text,
    scanner.profile_version,
    scanner.sort_order,
    scanner.updated_at
  from public.fbs_scanner_models scanner
  where auth.uid() is not null
    and scanner.status = 'active'
  order by scanner.sort_order, scanner.display_name;
$$;

revoke all on function public.get_fbs_scanner_models() from public, anon;
grant execute on function public.get_fbs_scanner_models() to authenticated;

create or replace function public.admin_get_fbs_scanner_models()
returns table (
  id uuid,
  brand text,
  model text,
  display_name text,
  connection_type text,
  status text,
  serial_options jsonb,
  scan_options jsonb,
  setup_barcodes jsonb,
  restore_barcodes jsonb,
  instructions text,
  warning_text text,
  profile_version integer,
  sort_order integer,
  usage_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.platform_role in ('admin', 'superadmin')
  ) then
    raise exception 'Нет доступа к каталогу сканеров';
  end if;

  return query
  select
    scanner.id,
    scanner.brand,
    scanner.model,
    scanner.display_name,
    scanner.connection_type,
    scanner.status,
    scanner.serial_options,
    scanner.scan_options,
    scanner.setup_barcodes,
    scanner.restore_barcodes,
    scanner.instructions,
    scanner.warning_text,
    scanner.profile_version,
    scanner.sort_order,
    (select count(*) from public.fbs_marking_sessions session where session.active_scanner_model = scanner.display_name),
    scanner.created_at,
    scanner.updated_at
  from public.fbs_scanner_models scanner
  order by scanner.sort_order, scanner.display_name;
end;
$$;

revoke all on function public.admin_get_fbs_scanner_models() from public, anon;
grant execute on function public.admin_get_fbs_scanner_models() to authenticated;

create or replace function public.admin_upsert_fbs_scanner_model(
  p_id uuid,
  p_brand text,
  p_model text,
  p_connection_type text,
  p_status text,
  p_serial_options jsonb,
  p_scan_options jsonb,
  p_setup_barcodes jsonb,
  p_restore_barcodes jsonb,
  p_instructions text,
  p_warning_text text,
  p_sort_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand text := left(trim(coalesce(p_brand, '')), 80);
  v_model_name text := left(trim(coalesce(p_model, '')), 120);
  v_display_name text;
  v_existing public.fbs_scanner_models%rowtype;
  v_saved public.fbs_scanner_models%rowtype;
  v_action text;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.platform_role in ('admin', 'superadmin')
  ) then
    raise exception 'Нет доступа к изменению каталога сканеров';
  end if;

  if char_length(v_brand) < 1 or char_length(v_model_name) < 1 then
    raise exception 'Укажите бренд и модель сканера';
  end if;
  if p_connection_type not in ('keyboard', 'web_serial') then
    raise exception 'Неизвестный способ подключения сканера';
  end if;
  if p_status not in ('draft', 'active') then
    raise exception 'Сканер можно сохранить как черновик или опубликовать';
  end if;
  if jsonb_typeof(coalesce(p_serial_options, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_scan_options, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_setup_barcodes, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_restore_barcodes, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный профиль сканера';
  end if;
  if jsonb_array_length(coalesce(p_setup_barcodes, '[]'::jsonb)) > 30
    or jsonb_array_length(coalesce(p_restore_barcodes, '[]'::jsonb)) > 30 then
    raise exception 'Для одного профиля разрешено не больше 30 настроечных кодов';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_setup_barcodes, '[]'::jsonb) || coalesce(p_restore_barcodes, '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item ->> 'label'), '') is null
      or nullif(item ->> 'value', '') is null
      or char_length(item ->> 'label') > 200
      or char_length(item ->> 'value') > 512
      or coalesce(item ->> 'format', 'CODE128') not in ('CODE128', 'QR')
  ) then
    raise exception 'У каждого настроечного кода должны быть название и значение';
  end if;

  v_display_name := v_brand || ' ' || v_model_name;

  if p_id is not null then
    select * into v_existing
    from public.fbs_scanner_models
    where id = p_id
    for update;
    if v_existing.id is null then
      raise exception 'Модель сканера не найдена';
    end if;
    if v_existing.status <> 'draft'
      and (v_existing.brand <> v_brand or v_existing.model <> v_model_name) then
      raise exception 'Бренд и модель опубликованного сканера менять нельзя. Архивируйте его и создайте новую запись';
    end if;
  end if;

  if exists (
    select 1 from public.fbs_scanner_models duplicate
    where lower(duplicate.display_name) = lower(v_display_name)
      and duplicate.id is distinct from p_id
  ) then
    raise exception 'Такая модель сканера уже существует';
  end if;

  if p_id is null then
    insert into public.fbs_scanner_models (
      brand, model, display_name, connection_type, status,
      serial_options, scan_options, setup_barcodes, restore_barcodes,
      instructions, warning_text, sort_order, created_by, updated_by
    ) values (
      v_brand, v_model_name, v_display_name, p_connection_type, p_status,
      coalesce(p_serial_options, '{}'::jsonb), coalesce(p_scan_options, '{}'::jsonb),
      coalesce(p_setup_barcodes, '[]'::jsonb), coalesce(p_restore_barcodes, '[]'::jsonb),
      left(coalesce(p_instructions, ''), 4000), left(coalesce(p_warning_text, ''), 2000),
      coalesce(p_sort_order, 100), auth.uid(), auth.uid()
    )
    returning * into v_saved;
    v_action := case when p_status = 'active' then 'created_and_published' else 'created_draft' end;
  else
    update public.fbs_scanner_models
    set brand = v_brand,
        model = v_model_name,
        display_name = v_display_name,
        connection_type = p_connection_type,
        status = p_status,
        serial_options = coalesce(p_serial_options, '{}'::jsonb),
        scan_options = coalesce(p_scan_options, '{}'::jsonb),
        setup_barcodes = coalesce(p_setup_barcodes, '[]'::jsonb),
        restore_barcodes = coalesce(p_restore_barcodes, '[]'::jsonb),
        instructions = left(coalesce(p_instructions, ''), 4000),
        warning_text = left(coalesce(p_warning_text, ''), 2000),
        sort_order = coalesce(p_sort_order, 100),
        profile_version = profile_version + 1,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_id
    returning * into v_saved;
    v_action := case
      when v_existing.status <> 'active' and p_status = 'active' then 'published'
      else 'updated'
    end;
  end if;

  insert into public.fbs_scanner_model_history (
    scanner_model_id, action, profile_version, actor_user_id, snapshot
  ) values (
    v_saved.id, v_action, v_saved.profile_version, auth.uid(), to_jsonb(v_saved)
  );

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.admin_upsert_fbs_scanner_model(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, integer)
  from public, anon;
grant execute on function public.admin_upsert_fbs_scanner_model(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, integer)
  to authenticated;

create or replace function public.admin_archive_fbs_scanner_model(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved public.fbs_scanner_models%rowtype;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.platform_role in ('admin', 'superadmin')
  ) then
    raise exception 'Нет доступа к изменению каталога сканеров';
  end if;

  update public.fbs_scanner_models
  set status = 'archived',
      profile_version = profile_version + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_id
  returning * into v_saved;

  if v_saved.id is null then
    raise exception 'Модель сканера не найдена';
  end if;

  insert into public.fbs_scanner_model_history (
    scanner_model_id, action, profile_version, actor_user_id, snapshot
  ) values (
    v_saved.id, 'archived', v_saved.profile_version, auth.uid(), to_jsonb(v_saved)
  );
end;
$$;

revoke all on function public.admin_archive_fbs_scanner_model(uuid) from public, anon;
grant execute on function public.admin_archive_fbs_scanner_model(uuid) to authenticated;

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
  v_scanner public.fbs_scanner_models%rowtype;
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

  if v_model is not null then
    select * into v_scanner
    from public.fbs_scanner_models scanner
    where scanner.display_name = v_model
      and scanner.status in ('active', 'archived');
    if v_scanner.id is null then
      raise exception 'Неизвестная модель сканера';
    end if;
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
      active_scanner_profile_version = case when v_model is null then null else v_scanner.profile_version end,
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

notify pgrst, 'reload schema';
