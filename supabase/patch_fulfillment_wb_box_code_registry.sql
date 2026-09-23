-- Excel is the canonical source of WB box-code identity. The registry keeps
-- that identity by supply + box number even while a physical box row is
-- deleted, and restores it when the same numbered box is recreated.
begin;

create table if not exists public.fulfillment_wb_box_code_registry (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  supply_id uuid not null references public.fulfillment_supplies(id) on delete cascade,
  box_number integer not null check (box_number > 0),
  wb_barcode text not null check (char_length(btrim(wb_barcode)) between 1 and 512),
  wb_external_barcode text not null check (char_length(btrim(wb_external_barcode)) between 1 and 512),
  source_filename text,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (supply_id, box_number),
  unique (account_id, wb_barcode),
  unique (account_id, wb_external_barcode)
);

comment on table public.fulfillment_wb_box_code_registry is
  'Canonical Excel WB box-code pairs, retained by supply and box number across box deletion/recreation';

create index if not exists fulfillment_wb_box_code_registry_supply_idx
  on public.fulfillment_wb_box_code_registry (supply_id, box_number);

alter table public.fulfillment_wb_box_code_registry enable row level security;

drop policy if exists "members view fulfillment wb box codes" on public.fulfillment_wb_box_code_registry;
create policy "members view fulfillment wb box codes"
on public.fulfillment_wb_box_code_registry for select
using (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_wb_box_code_registry.account_id
    and member.user_id = auth.uid()
));

drop policy if exists "members manage fulfillment wb box codes" on public.fulfillment_wb_box_code_registry;
create policy "members manage fulfillment wb box codes"
on public.fulfillment_wb_box_code_registry for all
using (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_wb_box_code_registry.account_id
    and member.user_id = auth.uid()
))
with check (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_wb_box_code_registry.account_id
    and member.user_id = auth.uid()
));

-- Preserve verified pairs that were imported before the registry existed.
insert into public.fulfillment_wb_box_code_registry (
  account_id,
  supply_id,
  box_number,
  wb_barcode,
  wb_external_barcode,
  source_filename
)
select
  box.account_id,
  box.supply_id,
  box.box_number,
  btrim(box.wb_barcode),
  btrim(box.wb_external_barcode),
  'Перенесено из существующей привязки'
from public.fulfillment_boxes box
where nullif(btrim(box.wb_barcode), '') is not null
  and nullif(btrim(box.wb_external_barcode), '') is not null
on conflict (supply_id, box_number) do update
set wb_barcode = excluded.wb_barcode,
    wb_external_barcode = excluded.wb_external_barcode,
    updated_at = timezone('utc', now());

create or replace function public.restore_fulfillment_wb_box_codes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select registry.wb_barcode, registry.wb_external_barcode
  into new.wb_barcode, new.wb_external_barcode
  from public.fulfillment_wb_box_code_registry registry
  where registry.supply_id = new.supply_id
    and registry.account_id = new.account_id
    and registry.box_number = new.box_number;
  return new;
end;
$$;

drop trigger if exists fulfillment_box_restore_wb_codes_trigger on public.fulfillment_boxes;
create trigger fulfillment_box_restore_wb_codes_trigger
before insert on public.fulfillment_boxes
for each row execute function public.restore_fulfillment_wb_box_codes();

create or replace function public.enforce_fulfillment_wb_box_code_registry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registry public.fulfillment_wb_box_code_registry%rowtype;
begin
  if new.wb_barcode is not distinct from old.wb_barcode
     and new.wb_external_barcode is not distinct from old.wb_external_barcode then
    return new;
  end if;

  select * into v_registry
  from public.fulfillment_wb_box_code_registry registry
  where registry.supply_id = new.supply_id
    and registry.account_id = new.account_id
    and registry.box_number = new.box_number;

  if found then
    if new.wb_barcode is distinct from v_registry.wb_barcode
       or new.wb_external_barcode is distinct from v_registry.wb_external_barcode then
      raise exception 'ШК WB можно изменить только атомарной загрузкой Excel';
    end if;
  elsif new.wb_barcode is not null or new.wb_external_barcode is not null then
    raise exception 'ШК WB можно привязать только загрузкой Excel';
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_box_enforce_wb_registry_trigger on public.fulfillment_boxes;
create trigger fulfillment_box_enforce_wb_registry_trigger
before update of wb_barcode, wb_external_barcode on public.fulfillment_boxes
for each row execute function public.enforce_fulfillment_wb_box_code_registry();

-- Apply explicit box-number pairs atomically. Array position or API response
-- order is deliberately not accepted by this RPC.
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

  if auth.role() <> 'service_role' and not exists (
    select 1 from public.account_members member
    where member.account_id = v_supply.account_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к этой компании';
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
  from jsonb_to_recordset(p_pairs) as pair(
    box_number integer,
    code text,
    external_code text
  );

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

  -- Remove the old registry first so boxes may be cleared by the enforcement
  -- trigger. Clearing then permits two codes to exchange box numbers without
  -- violating active-box unique indexes during the transaction.
  delete from public.fulfillment_wb_box_code_registry
  where supply_id = p_supply_id;

  update public.fulfillment_boxes
  set wb_barcode = null,
      wb_external_barcode = null
  where supply_id = p_supply_id;

  insert into public.fulfillment_wb_box_code_registry (
    account_id,
    supply_id,
    box_number,
    wb_barcode,
    wb_external_barcode,
    source_filename,
    imported_by
  )
  select
    v_supply.account_id,
    p_supply_id,
    pair.box_number,
    btrim(pair.code),
    btrim(pair.external_code),
    nullif(left(btrim(coalesce(p_filename, '')), 255), ''),
    auth.uid()
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
    where id = v_supply.trip_line_id
      and account_id = v_supply.account_id;
  end if;

  return jsonb_build_object('applied', v_count, 'unchanged', false, 'total', v_count);
end;
$$;

revoke all on function public.apply_fulfillment_wb_box_code_pairs(uuid, jsonb, text) from public, anon;
grant execute on function public.apply_fulfillment_wb_box_code_pairs(uuid, jsonb, text) to authenticated, service_role;

-- Backward compatibility for a briefly deployed Excel client. Positions are
-- converted to explicit box numbers and still pass the strict exact-set check.
create or replace function public.assign_fulfillment_wb_box_code_pairs(
  p_supply_id uuid,
  p_codes text[],
  p_external_codes text[]
)
returns void
language plpgsql
as $$
declare
  v_pairs jsonb;
begin
  if cardinality(coalesce(p_codes, '{}'::text[])) <> cardinality(coalesce(p_external_codes, '{}'::text[])) then
    raise exception 'Число обычных и печатных ШК WB не совпадает';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'box_number', code.position,
    'code', code.value,
    'external_code', p_external_codes[code.position]
  ) order by code.position), '[]'::jsonb)
  into v_pairs
  from unnest(coalesce(p_codes, '{}'::text[])) with ordinality as code(value, position);
  perform public.apply_fulfillment_wb_box_code_pairs(p_supply_id, v_pairs, null);
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[]) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[]) to authenticated, service_role;

-- API package ordering is not an identity source. Keep the function signature
-- so old clients fail safely instead of silently remapping boxes.
create or replace function public.assign_fulfillment_wb_box_codes_by_kind(
  p_supply_id uuid,
  p_codes text[],
  p_kind text
)
returns void
language plpgsql
as $$
begin
  raise exception 'Привязка ШК коробов через API отключена. Загрузите Excel WB.';
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_codes_by_kind(uuid, text[], text) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_codes_by_kind(uuid, text[], text) to authenticated, service_role;

create or replace function public.assign_fulfillment_wb_box_codes(
  p_supply_id uuid,
  p_codes text[]
)
returns void
language plpgsql
as $$
begin
  raise exception 'Привязка ШК коробов через API отключена. Загрузите Excel WB.';
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_codes(uuid, text[]) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_codes(uuid, text[]) to authenticated, service_role;

-- A different WB supply ID invalidates the Excel identity and cached metadata.
create or replace function public.set_fulfillment_wb_supply_id(p_supply_id uuid, p_wb_supply_id text)
returns void
language plpgsql
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_new_id text := nullif(btrim(p_wb_supply_id), '');
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if v_new_id is not null and v_new_id !~ '^[0-9]+$' then
    raise exception 'Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…';
  end if;
  if v_supply.wb_supply_id is not distinct from v_new_id then return; end if;

  delete from public.fulfillment_wb_box_code_registry where supply_id = p_supply_id;
  update public.fulfillment_boxes
  set wb_barcode = null,
      wb_external_barcode = null
  where supply_id = p_supply_id;

  update public.fulfillment_supplies
  set wb_supply_id = v_new_id,
      wb_warehouse_id = null,
      wb_warehouse_name = null,
      wb_planned_delivery_date = null,
      wb_cargo_type = null,
      wb_synced_at = null
  where id = p_supply_id;

  update public.trip_lines
  set wb_status_id = null,
      wb_cargo_type = null,
      wb_created_at = null,
      planned_marketplace_delivery_date = null,
      wb_acceptance_date = null,
      wb_updated_at = null,
      wb_acceptance_coefficient = null,
      wb_acceptance_cost = null,
      wb_reject_reason = null,
      wb_quantity = null,
      wb_ready_for_sale_quantity = null,
      wb_accepted_quantity = null,
      wb_unloading_quantity = null,
      wb_depersonalized_quantity = null,
      wb_warehouse_id = null,
      wb_warehouse_name = null,
      wb_actual_warehouse_id = null,
      wb_actual_warehouse_name = null,
      wb_transit_warehouse_id = null,
      wb_transit_warehouse_name = null,
      wb_package_codes = '{}'::text[],
      wb_goods_snapshot = '[]'::jsonb,
      wb_packages_snapshot = '[]'::jsonb,
      wb_synced_at = null
  where account_id = v_supply.account_id
    and (id = v_supply.trip_line_id or fulfillment_supply_id = p_supply_id);
end;
$$;

revoke all on function public.set_fulfillment_wb_supply_id(uuid, text) from public, anon;
grant execute on function public.set_fulfillment_wb_supply_id(uuid, text) to authenticated, service_role;

commit;
