-- Immutable audit history for Excel imports in Fulfillment, plus server-side
-- authorization that mirrors the UI's fulfillment_manage permission.
begin;

create table if not exists public.fulfillment_excel_action_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  supply_id uuid not null references public.fulfillment_supplies(id) on delete cascade,
  action_type text not null check (action_type in ('box_contents_import', 'wb_box_codes_import')),
  result text not null check (result in ('applied', 'unchanged')),
  source_filename text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fulfillment_excel_action_history_supply_created_idx
  on public.fulfillment_excel_action_history (supply_id, created_at desc);

comment on table public.fulfillment_excel_action_history is
  'Append-only audit log of successful Fulfillment Excel imports; downloads are intentionally excluded';

alter table public.fulfillment_excel_action_history enable row level security;

drop policy if exists "members view fulfillment Excel history" on public.fulfillment_excel_action_history;
create policy "members view fulfillment Excel history"
on public.fulfillment_excel_action_history for select
using (exists (
  select 1
  from public.fulfillment_supplies supply
  where supply.id = fulfillment_excel_action_history.supply_id
    and (
      exists (
        select 1 from public.account_members member
        where member.account_id = supply.account_id
          and member.user_id = auth.uid()
      )
      or (
        supply.pipeline_stage_id is not null
        and public.is_pipeline_stage_executor(supply.pipeline_stage_id)
      )
    )
));

revoke all on table public.fulfillment_excel_action_history from public, anon, authenticated;
grant select on table public.fulfillment_excel_action_history to authenticated, service_role;

-- The registry is mutated only by the strict RPC. Its old broad RLS policy is
-- removed so a member cannot bypass fulfillment_manage through PostgREST.
drop policy if exists "members manage fulfillment wb box codes" on public.fulfillment_wb_box_code_registry;
revoke insert, update, delete on table public.fulfillment_wb_box_code_registry from authenticated;
grant select on table public.fulfillment_wb_box_code_registry to authenticated, service_role;

create or replace function public.fulfillment_user_has_permission(
  p_user_id uuid,
  p_account_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_user_id is null or p_account_id is null then false
    when p_permission not in ('fulfillment_view', 'fulfillment_manage') then false
    else exists (
      select 1
      from public.account_members member
      where member.account_id = p_account_id
        and member.user_id = p_user_id
        and member.role in ('owner', 'admin')
    ) or exists (
      select 1
      from public.role_assignments assignment
      join public.roles role_row
        on role_row.id = assignment.role_id
       and role_row.account_id = assignment.account_id
      join public.account_members member
        on member.account_id = assignment.account_id
       and member.user_id = assignment.user_id
      where assignment.account_id = p_account_id
        and assignment.user_id = p_user_id
        and coalesce((role_row.permissions ->> p_permission)::boolean, false)
    )
  end
$$;

revoke all on function public.fulfillment_user_has_permission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fulfillment_user_has_permission(uuid, uuid, text) to service_role;

create or replace function public.fulfillment_user_can_manage_supply_excel(p_supply_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_executor_account_id uuid;
  v_stage_status text;
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id;
  if not found then return false; end if;

  if v_supply.pipeline_stage_id is null then
    v_executor_account_id := v_supply.account_id;
  else
    select coalesce(stage.partner_account_id, stage.owner_account_id), stage.status::text
    into v_executor_account_id, v_stage_status
    from public.batch_pipeline_stages stage
    where stage.id = v_supply.pipeline_stage_id;
    if v_executor_account_id is null or v_stage_status = 'pending' then return false; end if;
  end if;

  return public.fulfillment_user_has_permission(
    auth.uid(),
    v_executor_account_id,
    'fulfillment_manage'
  );
end;
$$;

revoke all on function public.fulfillment_user_can_manage_supply_excel(uuid) from public, anon, authenticated;
grant execute on function public.fulfillment_user_can_manage_supply_excel(uuid) to service_role;

-- The legacy editable guard only recognized membership in the batch owner's
-- account. Pipeline supplies are owned by that account too, while an
-- outsourced active stage must be editable by its actual executor.
create or replace function public.fulfillment_kiz_assert_editable(p_supply_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id;
  if not found then raise exception 'Поставка не найдена'; end if;

  if auth.role() <> 'service_role' then
    if v_supply.pipeline_stage_id is null then
      perform public.fulfillment_kiz_assert_member(v_supply.account_id);
    elsif not public.is_pipeline_stage_executor(v_supply.pipeline_stage_id) then
      raise exception 'Изменять данные стадии может только её исполнитель';
    end if;
  end if;

  if v_supply.destination_type = 'fbo' and exists (
    select 1
    from public.trip_lines line
    where (line.id = v_supply.trip_line_id or line.fulfillment_supply_id = v_supply.id)
      and line.status = 'Отгружен'
      and line.deleted_at is null
  ) then
    raise exception 'Поставка уже отгружена в FBO. Корректировка КИЗ заблокирована';
  end if;
end;
$$;

revoke all on function public.fulfillment_kiz_assert_editable(uuid) from public, anon, authenticated;
grant execute on function public.fulfillment_kiz_assert_editable(uuid) to service_role;

create or replace function public.fulfillment_excel_contents_snapshot(
  p_supply_id uuid,
  p_box_numbers integer[]
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'box_number', requested.box_number,
      'exists', box.id is not null,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'barcode', item.barcode,
            'qty', item.qty,
            'product_name', item.product_name
          ) order by item.barcode, item.id
        )
        from public.fulfillment_box_items item
        where item.box_id = box.id
      ), '[]'::jsonb)
    ) order by requested.box_number
  ), '[]'::jsonb)
  from unnest(coalesce(p_box_numbers, '{}'::integer[])) as requested(box_number)
  left join public.fulfillment_boxes box
    on box.supply_id = p_supply_id
   and box.box_number = requested.box_number
$$;

revoke all on function public.fulfillment_excel_contents_snapshot(uuid, integer[]) from public, anon, authenticated;
grant execute on function public.fulfillment_excel_contents_snapshot(uuid, integer[]) to service_role;

-- The original mutating function stays internal. The wrapper below is the
-- only authenticated entry point and records the audit row atomically.
revoke execute on function public.replace_fulfillment_box_contents_from_excel(uuid,jsonb,text,text,text,text,text,text)
  from authenticated;
grant execute on function public.replace_fulfillment_box_contents_from_excel(uuid,jsonb,text,text,text,text,text,text)
  to service_role;

create or replace function public.replace_fulfillment_box_contents_from_excel_with_history(
  p_supply_id uuid,
  p_rows jsonb,
  p_filename text default null,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box_numbers integer[];
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Некорректные данные Excel';
  end if;

  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;

  if auth.role() <> 'service_role'
     and not public.fulfillment_user_can_manage_supply_excel(p_supply_id) then
    raise exception 'Нет права управлять этой поставкой';
  end if;

  select array_agg(distinct imported.box_number order by imported.box_number)
  into v_box_numbers
  from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number integer)
  where imported.box_number is not null and imported.box_number > 0;

  v_before := public.fulfillment_excel_contents_snapshot(p_supply_id, v_box_numbers);
  v_result := public.replace_fulfillment_box_contents_from_excel(
    p_supply_id,
    p_rows,
    p_filename,
    p_actor_name,
    p_actor_email,
    p_device_id,
    p_device_name,
    p_scanner_model
  );
  v_after := public.fulfillment_excel_contents_snapshot(p_supply_id, v_box_numbers);

  insert into public.fulfillment_excel_action_history (
    account_id, supply_id, action_type, result, source_filename,
    actor_user_id, actor_name, actor_email, details
  ) values (
    v_supply.account_id,
    p_supply_id,
    'box_contents_import',
    'applied',
    nullif(left(btrim(coalesce(p_filename, '')), 255), ''),
    auth.uid(),
    coalesce(
      (select nullif(left(btrim(profile.full_name), 160), '') from public.profiles profile where profile.user_id = auth.uid()),
      nullif(left(btrim(coalesce(p_actor_name, '')), 160), '')
    ),
    coalesce(
      (select nullif(left(btrim(user_row.email::text), 320), '') from auth.users user_row where user_row.id = auth.uid()),
      nullif(left(btrim(coalesce(p_actor_email, '')), 320), '')
    ),
    jsonb_build_object(
      'summary', v_result,
      'before', v_before,
      'after', v_after,
      'device', jsonb_build_object(
        'id', nullif(left(btrim(coalesce(p_device_id, '')), 200), ''),
        'name', nullif(left(btrim(coalesce(p_device_name, '')), 200), ''),
        'scanner_model', nullif(left(btrim(coalesce(p_scanner_model, '')), 200), '')
      )
    )
  );

  return v_result;
end;
$$;

revoke all on function public.replace_fulfillment_box_contents_from_excel_with_history(uuid,jsonb,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.replace_fulfillment_box_contents_from_excel_with_history(uuid,jsonb,text,text,text,text,text,text)
  to authenticated, service_role;

-- Recreate the strict WB apply function with the same validation and mapping
-- rules, but authorize the actual stage executor with fulfillment_manage.
create or replace function public.apply_fulfillment_wb_box_code_pairs(
  p_supply_id uuid,
  p_pairs jsonb,
  p_filename text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box_numbers integer[];
  v_existing_box_numbers integer[];
  v_codes text[];
  v_external_codes text[];
  v_count integer;
  v_unchanged boolean;
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;

  if auth.role() <> 'service_role'
     and not public.fulfillment_user_can_manage_supply_excel(p_supply_id) then
    raise exception 'Нет права управлять этой поставкой';
  end if;
  if nullif(btrim(v_supply.wb_supply_id), '') is null then
    raise exception 'Сначала укажите ID поставки WB';
  end if;
  if jsonb_typeof(coalesce(p_pairs, 'null'::jsonb)) <> 'array' then
    raise exception 'Некорректный список ШК WB';
  end if;

  select
    array_agg(pair.box_number order by pair.box_number),
    array_agg(btrim(pair.code) order by pair.box_number),
    array_agg(btrim(pair.external_code) order by pair.box_number),
    count(*)::integer
  into v_box_numbers, v_codes, v_external_codes, v_count
  from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text);

  if coalesce(v_count, 0) = 0 then raise exception 'В файле нет ШК коробов WB'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text)
    where pair.box_number is null or pair.box_number < 1
      or nullif(btrim(pair.code), '') is null
      or nullif(btrim(pair.external_code), '') is null
      or char_length(btrim(pair.code)) > 512
      or char_length(btrim(pair.external_code)) > 512
  ) then
    raise exception 'Список содержит некорректный или пустой ШК WB';
  end if;
  if (select count(distinct value) from unnest(v_box_numbers) value) <> v_count
    or (select count(distinct value) from unnest(v_codes) value) <> v_count
    or (select count(distinct value) from unnest(v_external_codes) value) <> v_count then
    raise exception 'Список содержит повторный номер короба или ШК WB';
  end if;

  select array_agg(box.box_number order by box.box_number)
  into v_existing_box_numbers
  from public.fulfillment_boxes box
  where box.supply_id = p_supply_id;

  if coalesce(v_existing_box_numbers, '{}'::integer[]) <> coalesce(v_box_numbers, '{}'::integer[]) then
    raise exception 'Номера коробов Excel не совпадают с коробами поставки ELESTET';
  end if;

  select not exists (
    select 1
    from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text)
    left join public.fulfillment_wb_box_code_registry registry
      on registry.supply_id = p_supply_id
     and registry.box_number = pair.box_number
    where registry.id is null
       or registry.wb_barcode is distinct from btrim(pair.code)
       or registry.wb_external_barcode is distinct from btrim(pair.external_code)
  ) and (
    select count(*) from public.fulfillment_wb_box_code_registry registry
    where registry.supply_id = p_supply_id
  ) = v_count
  into v_unchanged;

  if v_unchanged then
    return jsonb_build_object('applied', 0, 'unchanged', true, 'total', v_count);
  end if;

  delete from public.fulfillment_wb_box_code_registry where supply_id = p_supply_id;
  update public.fulfillment_boxes
  set wb_barcode = null, wb_external_barcode = null
  where supply_id = p_supply_id;

  insert into public.fulfillment_wb_box_code_registry (
    account_id, supply_id, box_number, wb_barcode, wb_external_barcode,
    source_filename, imported_by
  )
  select
    v_supply.account_id, p_supply_id, pair.box_number,
    btrim(pair.code), btrim(pair.external_code),
    nullif(left(btrim(coalesce(p_filename, '')), 255), ''), auth.uid()
  from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text);

  update public.fulfillment_boxes box
  set wb_barcode = registry.wb_barcode,
      wb_external_barcode = registry.wb_external_barcode
  from public.fulfillment_wb_box_code_registry registry
  where box.supply_id = p_supply_id
    and registry.supply_id = box.supply_id
    and registry.box_number = box.box_number;

  if v_supply.trip_line_id is not null then
    update public.trip_lines
    set wb_package_codes = v_codes
    where id = v_supply.trip_line_id and account_id = v_supply.account_id;
  end if;

  return jsonb_build_object('applied', v_count, 'unchanged', false, 'total', v_count);
end;
$$;

revoke all on function public.apply_fulfillment_wb_box_code_pairs(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_fulfillment_wb_box_code_pairs(uuid, jsonb, text)
  to service_role;

revoke execute on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[])
  from authenticated;
grant execute on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[])
  to service_role;

create or replace function public.apply_fulfillment_wb_box_code_pairs_with_history(
  p_supply_id uuid,
  p_pairs jsonb,
  p_filename text default null,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(coalesce(p_pairs, 'null'::jsonb)) <> 'array' then
    raise exception 'Некорректный список ШК WB';
  end if;

  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;

  if auth.role() <> 'service_role'
     and not public.fulfillment_user_can_manage_supply_excel(p_supply_id) then
    raise exception 'Нет права управлять этой поставкой';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'box_number', pair.box_number,
    'wb_barcode', box.wb_barcode,
    'wb_external_barcode', box.wb_external_barcode
  ) order by pair.box_number), '[]'::jsonb)
  into v_before
  from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text)
  left join public.fulfillment_boxes box
    on box.supply_id = p_supply_id and box.box_number = pair.box_number;

  v_result := public.apply_fulfillment_wb_box_code_pairs(p_supply_id, p_pairs, p_filename);

  select coalesce(jsonb_agg(jsonb_build_object(
    'box_number', pair.box_number,
    'wb_barcode', box.wb_barcode,
    'wb_external_barcode', box.wb_external_barcode
  ) order by pair.box_number), '[]'::jsonb)
  into v_after
  from jsonb_to_recordset(p_pairs) as pair(box_number integer, code text, external_code text)
  left join public.fulfillment_boxes box
    on box.supply_id = p_supply_id and box.box_number = pair.box_number;

  insert into public.fulfillment_excel_action_history (
    account_id, supply_id, action_type, result, source_filename,
    actor_user_id, actor_name, actor_email, details
  ) values (
    v_supply.account_id,
    p_supply_id,
    'wb_box_codes_import',
    case when coalesce((v_result ->> 'unchanged')::boolean, false) then 'unchanged' else 'applied' end,
    nullif(left(btrim(coalesce(p_filename, '')), 255), ''),
    auth.uid(),
    coalesce(
      (select nullif(left(btrim(profile.full_name), 160), '') from public.profiles profile where profile.user_id = auth.uid()),
      nullif(left(btrim(coalesce(p_actor_name, '')), 160), '')
    ),
    coalesce(
      (select nullif(left(btrim(user_row.email::text), 320), '') from auth.users user_row where user_row.id = auth.uid()),
      nullif(left(btrim(coalesce(p_actor_email, '')), 320), '')
    ),
    jsonb_build_object(
      'summary', v_result,
      'before', v_before,
      'after', v_after,
      'device', jsonb_build_object(
        'id', nullif(left(btrim(coalesce(p_device_id, '')), 200), ''),
        'name', nullif(left(btrim(coalesce(p_device_name, '')), 200), ''),
        'scanner_model', nullif(left(btrim(coalesce(p_scanner_model, '')), 200), '')
      )
    )
  );

  return v_result;
end;
$$;

revoke all on function public.apply_fulfillment_wb_box_code_pairs_with_history(uuid,jsonb,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.apply_fulfillment_wb_box_code_pairs_with_history(uuid,jsonb,text,text,text,text,text,text)
  to authenticated, service_role;

commit;
