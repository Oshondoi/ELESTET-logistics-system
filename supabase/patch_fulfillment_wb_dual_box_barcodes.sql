begin;

alter table public.fulfillment_boxes
  add column if not exists wb_external_barcode text;

comment on column public.fulfillment_boxes.wb_barcode is
  'WB box barcode from the ШК короба column';
comment on column public.fulfillment_boxes.wb_external_barcode is
  'WB printable box barcode from the ШК короба для печати в стороннем сервисе column';

create unique index if not exists fulfillment_boxes_account_wb_external_barcode_key
  on public.fulfillment_boxes (account_id, wb_external_barcode)
  where wb_external_barcode is not null;

-- The existing synchronization trigger clears wb_barcode after a WB supply ID
-- change. This companion trigger clears the second WB identity as well.
create or replace function public.clear_fulfillment_wb_external_codes_on_supply_change()
returns trigger language plpgsql as $$
begin
  if old.wb_supply_id is distinct from new.wb_supply_id then
    update public.fulfillment_boxes
    set wb_external_barcode = null
    where supply_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_wb_external_codes_clear on public.fulfillment_supplies;
create trigger fulfillment_wb_external_codes_clear
after update of wb_supply_id on public.fulfillment_supplies
for each row execute function public.clear_fulfillment_wb_external_codes_on_supply_change();

create or replace function public.set_fulfillment_wb_supply_id(p_supply_id uuid, p_wb_supply_id text)
returns void language plpgsql as $$
declare
  v_old_id text;
  v_new_id text := nullif(btrim(p_wb_supply_id), '');
begin
  select wb_supply_id into v_old_id
  from public.fulfillment_supplies where id = p_supply_id for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if v_new_id is not null and v_new_id !~ '^[0-9]+$' then
    raise exception 'Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…';
  end if;
  if v_old_id is not distinct from v_new_id then return; end if;

  update public.fulfillment_boxes
  set wb_barcode = null,
      wb_external_barcode = null
  where supply_id = p_supply_id;
  update public.fulfillment_supplies set wb_supply_id = v_new_id where id = p_supply_id;
end;
$$;

revoke all on function public.set_fulfillment_wb_supply_id(uuid, text) from public, anon;
grant execute on function public.set_fulfillment_wb_supply_id(uuid, text) to authenticated, service_role;

-- Manual Excel import always supplies the two WB identities together. Both
-- arrays are validated before a single box is changed, so partial imports are
-- impossible. ELESTET barcode, contents, quantities and KIZ relations are not
-- touched.
create or replace function public.assign_fulfillment_wb_box_code_pairs(
  p_supply_id uuid,
  p_codes text[],
  p_external_codes text[]
)
returns void language plpgsql as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box_count integer;
  v_codes text[];
  v_external_codes text[];
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if nullif(btrim(v_supply.wb_supply_id), '') is null then
    raise exception 'Сначала укажите ID поставки WB';
  end if;

  select count(*) into v_box_count
  from public.fulfillment_boxes where supply_id = p_supply_id;
  if v_box_count = 0 then raise exception 'В поставке нет коробов'; end if;
  if cardinality(coalesce(p_codes, '{}'::text[])) <> v_box_count
     or cardinality(coalesce(p_external_codes, '{}'::text[])) <> v_box_count then
    raise exception 'Число пар ШК WB не совпадает с числом коробов ELESTET (%)', v_box_count;
  end if;

  select array_agg(btrim(entry.code) order by entry.position)
  into v_codes
  from unnest(p_codes) with ordinality as entry(code, position);
  select array_agg(btrim(entry.code) order by entry.position)
  into v_external_codes
  from unnest(p_external_codes) with ordinality as entry(code, position);

  if exists (select 1 from unnest(v_codes) as entry(code) where nullif(entry.code, '') is null)
     or exists (select 1 from unnest(v_external_codes) as entry(code) where nullif(entry.code, '') is null)
     or (select count(distinct entry.code) from unnest(v_codes) as entry(code)) <> v_box_count
     or (select count(distinct entry.code) from unnest(v_external_codes) as entry(code)) <> v_box_count then
    raise exception 'Список содержит пустой или повторный ШК WB';
  end if;

  update public.fulfillment_boxes
  set wb_barcode = null,
      wb_external_barcode = null
  where supply_id = p_supply_id;

  with numbered_boxes as (
    select id, row_number() over (order by box_number, id) as position
    from public.fulfillment_boxes
    where supply_id = p_supply_id
  )
  update public.fulfillment_boxes box
  set wb_barcode = v_codes[numbered_boxes.position::integer],
      wb_external_barcode = v_external_codes[numbered_boxes.position::integer]
  from numbered_boxes
  where box.id = numbered_boxes.id;

  if v_supply.trip_line_id is not null then
    update public.trip_lines
    set wb_package_codes = v_codes
    where id = v_supply.trip_line_id and account_id = v_supply.account_id;
  end if;
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[]) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_code_pairs(uuid, text[], text[]) to authenticated, service_role;

-- WB API currently exposes one packageCode field. Classifying its format lets
-- synchronization update only the matching WB identity and preserve the other.
create or replace function public.assign_fulfillment_wb_box_codes_by_kind(
  p_supply_id uuid,
  p_codes text[],
  p_kind text
)
returns void language plpgsql as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box_count integer;
  v_codes text[];
begin
  if p_kind not in ('ordinary', 'external', 'legacy') then
    raise exception 'Неизвестный вид ШК WB';
  end if;

  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if nullif(btrim(v_supply.wb_supply_id), '') is null then
    raise exception 'Сначала укажите ID поставки WB';
  end if;

  select count(*) into v_box_count
  from public.fulfillment_boxes where supply_id = p_supply_id;
  if v_box_count = 0 then raise exception 'В поставке нет коробов'; end if;
  if cardinality(coalesce(p_codes, '{}'::text[])) <> v_box_count then
    raise exception 'Число ШК WB (%) не совпадает с числом коробов ELESTET (%)',
      cardinality(coalesce(p_codes, '{}'::text[])), v_box_count;
  end if;

  select array_agg(btrim(entry.code) order by entry.position)
  into v_codes
  from unnest(p_codes) with ordinality as entry(code, position);
  if exists (select 1 from unnest(v_codes) as entry(code) where nullif(entry.code, '') is null)
     or (select count(distinct entry.code) from unnest(v_codes) as entry(code)) <> v_box_count then
    raise exception 'Список ШК WB содержит пустой или повторный код';
  end if;

  if p_kind in ('ordinary', 'legacy') then
    update public.fulfillment_boxes set wb_barcode = null where supply_id = p_supply_id;
  end if;
  if p_kind in ('external', 'legacy') then
    update public.fulfillment_boxes set wb_external_barcode = null where supply_id = p_supply_id;
  end if;

  with numbered_boxes as (
    select id, row_number() over (order by box_number, id) as position
    from public.fulfillment_boxes
    where supply_id = p_supply_id
  )
  update public.fulfillment_boxes box
  set wb_barcode = case when p_kind in ('ordinary', 'legacy')
      then v_codes[numbered_boxes.position::integer] else box.wb_barcode end,
      wb_external_barcode = case when p_kind in ('external', 'legacy')
      then v_codes[numbered_boxes.position::integer] else box.wb_external_barcode end
  from numbered_boxes
  where box.id = numbered_boxes.id;

  if p_kind in ('ordinary', 'legacy') and v_supply.trip_line_id is not null then
    update public.trip_lines
    set wb_package_codes = v_codes
    where id = v_supply.trip_line_id and account_id = v_supply.account_id;
  end if;
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_codes_by_kind(uuid, text[], text) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_codes_by_kind(uuid, text[], text) to authenticated, service_role;

commit;
