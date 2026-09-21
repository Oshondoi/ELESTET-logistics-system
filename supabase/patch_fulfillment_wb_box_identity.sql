-- FBW/FBO WB supply ID is entered in fulfillment or logistics; both views share it.
-- A WB package code belongs to one physical fulfillment box, never to its row number.
begin;

alter table public.fulfillment_supplies add column if not exists wb_supply_id text;
alter table public.fulfillment_boxes add column if not exists wb_barcode text;

create unique index if not exists fulfillment_boxes_account_wb_barcode_key
  on public.fulfillment_boxes (account_id, wb_barcode)
  where wb_barcode is not null;

update public.fulfillment_supplies s
set wb_supply_id = tl.wb_supply_id
from public.trip_lines tl
where tl.id = s.trip_line_id
  and tl.account_id = s.account_id
  and s.wb_supply_id is null
  and tl.wb_supply_id is not null;

create or replace function public.sync_fulfillment_wb_supply_id()
returns trigger language plpgsql as $$
declare
  v_supply_id uuid;
  v_line_id uuid;
  v_account_id uuid;
  v_wb_id text;
  v_can_inherit boolean := false;
begin
  if tg_table_name = 'fulfillment_supplies' then
    v_supply_id := new.id;
    v_line_id := new.trip_line_id;
    v_account_id := new.account_id;
    v_wb_id := nullif(btrim(new.wb_supply_id), '');
    if v_wb_id is not null and v_wb_id !~ '^[0-9]+$' then
      raise exception 'Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…';
    end if;
    if tg_op = 'UPDATE' then
      if old.wb_supply_id is distinct from new.wb_supply_id then
        update public.fulfillment_boxes set wb_barcode = null where supply_id = v_supply_id;
      end if;
    end if;
    if v_line_id is not null then
      if tg_op = 'INSERT' then
        v_can_inherit := true;
      else
        v_can_inherit := old.wb_supply_id is null;
      end if;
      if v_wb_id is null and v_can_inherit then
        select nullif(btrim(wb_supply_id), '') into v_wb_id
        from public.trip_lines where id = v_line_id and account_id = v_account_id;
        if v_wb_id is not null then
          update public.fulfillment_supplies set wb_supply_id = v_wb_id where id = v_supply_id;
          return new;
        end if;
      end if;
      update public.trip_lines
      set wb_supply_id = v_wb_id,
          wb_package_codes = '{}'::text[]
      where id = v_line_id
        and account_id = v_account_id
        and wb_supply_id is distinct from v_wb_id;
    end if;
  else
    v_supply_id := new.fulfillment_supply_id;
    if v_supply_id is null then
      select id into v_supply_id
      from public.fulfillment_supplies
      where trip_line_id = new.id and account_id = new.account_id
      limit 1;
    end if;
    if v_supply_id is null then return new; end if;
    v_wb_id := nullif(btrim(new.wb_supply_id), '');
    if v_wb_id is not null and v_wb_id !~ '^[0-9]+$' then
      raise exception 'Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…';
    end if;
    if tg_op = 'UPDATE' then
      if old.wb_supply_id is distinct from new.wb_supply_id then
        update public.fulfillment_boxes set wb_barcode = null where supply_id = v_supply_id;
        update public.trip_lines set wb_package_codes = '{}'::text[] where id = new.id;
      end if;
    end if;
    if tg_op = 'INSERT' then
      v_can_inherit := true;
    else
      v_can_inherit := old.wb_supply_id is null;
    end if;
    if v_wb_id is null and v_can_inherit then
      select nullif(btrim(wb_supply_id), '') into v_wb_id
      from public.fulfillment_supplies where id = v_supply_id and account_id = new.account_id;
      if v_wb_id is not null then
        update public.trip_lines set wb_supply_id = v_wb_id where id = new.id;
        return new;
      end if;
    end if;
    update public.fulfillment_supplies
    set wb_supply_id = v_wb_id
    where id = v_supply_id
      and account_id = new.account_id
      and wb_supply_id is distinct from v_wb_id;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_wb_supply_sync on public.fulfillment_supplies;
create trigger fulfillment_wb_supply_sync
after insert or update of trip_line_id, wb_supply_id on public.fulfillment_supplies
for each row execute function public.sync_fulfillment_wb_supply_id();

drop trigger if exists trip_line_wb_supply_sync on public.trip_lines;
create trigger trip_line_wb_supply_sync
after insert or update of fulfillment_supply_id, wb_supply_id on public.trip_lines
for each row execute function public.sync_fulfillment_wb_supply_id();

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
  -- A different WB supply means previous box codes can no longer be trusted.
  update public.fulfillment_boxes set wb_barcode = null where supply_id = p_supply_id;
  update public.fulfillment_supplies set wb_supply_id = v_new_id where id = p_supply_id;
end;
$$;

revoke all on function public.set_fulfillment_wb_supply_id(uuid, text) from public, anon;
grant execute on function public.set_fulfillment_wb_supply_id(uuid, text) to authenticated;

-- One supply-level action assigns the WB codes in the same order as the
-- WB API response order to physical boxes by box_number.
-- A single transaction prevents a partially updated supply.
create or replace function public.assign_fulfillment_wb_box_codes(p_supply_id uuid, p_codes text[])
returns void language plpgsql as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box_count integer;
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if nullif(btrim(v_supply.wb_supply_id), '') is null then raise exception 'Сначала укажите ID поставки WB'; end if;

  select count(*) into v_box_count
  from public.fulfillment_boxes where supply_id = p_supply_id;
  if v_box_count = 0 then raise exception 'В поставке нет коробов'; end if;
  if cardinality(coalesce(p_codes, '{}'::text[])) <> v_box_count then
    raise exception 'Число ШК WB (%) не совпадает с числом коробов ELESTET (%)',
      cardinality(coalesce(p_codes, '{}'::text[])), v_box_count;
  end if;
  if exists (select 1 from unnest(p_codes) as entry(code) where nullif(btrim(entry.code), '') is null)
    or (select count(distinct entry.code) from unnest(p_codes) as entry(code)) <> v_box_count then
    raise exception 'Список ШК WB содержит пустой или повторный код';
  end if;

  update public.fulfillment_boxes set wb_barcode = null where supply_id = p_supply_id;
  with numbered_boxes as (
    select id, row_number() over (order by box_number, id) as position
    from public.fulfillment_boxes where supply_id = p_supply_id
  )
  update public.fulfillment_boxes box
  set wb_barcode = p_codes[numbered_boxes.position::integer]
  from numbered_boxes
  where box.id = numbered_boxes.id;

  if v_supply.trip_line_id is not null then
    update public.trip_lines
    set wb_package_codes = p_codes
    where id = v_supply.trip_line_id and account_id = v_supply.account_id;
  end if;
end;
$$;

revoke all on function public.assign_fulfillment_wb_box_codes(uuid, text[]) from public, anon;
grant execute on function public.assign_fulfillment_wb_box_codes(uuid, text[]) to authenticated;

commit;
