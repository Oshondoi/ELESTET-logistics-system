-- Stable internal supply numbers and box barcodes for fulfillment.
-- Barcode format: EL_C{company}_P{batch}_S{supply}_B{box}

alter table public.fulfillment_supplies
  add column if not exists supply_number integer,
  add column if not exists next_box_number integer not null default 1;

do $$
declare
  r record;
  v_linked_number integer;
  v_next integer;
begin
  for r in
    select s.id, s.account_id, s.trip_line_id
    from public.fulfillment_supplies s
    where s.supply_number is null
    order by s.account_id, s.created_at, s.id
  loop
    v_linked_number := null;

    if r.trip_line_id is not null then
      select tl.shipment_number into v_linked_number
      from public.trip_lines tl
      where tl.id = r.trip_line_id
        and tl.account_id = r.account_id
        and not exists (
          select 1
          from public.fulfillment_supplies used
          where used.account_id = r.account_id
            and used.supply_number = tl.shipment_number
        );
    end if;

    if v_linked_number is null then
      select greatest(
        coalesce((select max(s.supply_number) from public.fulfillment_supplies s where s.account_id = r.account_id), 0),
        coalesce((select max(tl.shipment_number) from public.trip_lines tl where tl.account_id = r.account_id), 0)
      ) + 1 into v_next;
    else
      v_next := v_linked_number;
    end if;

    update public.fulfillment_supplies
    set supply_number = v_next
    where id = r.id;
  end loop;
end;
$$;

alter table public.fulfillment_supplies
  alter column supply_number set not null;

create unique index if not exists fulfillment_supplies_account_number_key
  on public.fulfillment_supplies(account_id, supply_number);

create table if not exists public.fulfillment_supply_number_registry (
  account_id uuid not null,
  supply_number integer not null,
  supply_id uuid not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, supply_number)
);

insert into public.fulfillment_supply_number_registry (
  account_id, supply_number, supply_id
)
select s.account_id, s.supply_number, s.id
from public.fulfillment_supplies s
on conflict (account_id, supply_number) do nothing;

do $$
begin
  if exists (
    select 1
    from public.fulfillment_supplies s
    left join public.fulfillment_supply_number_registry r
      on r.account_id = s.account_id
     and r.supply_number = s.supply_number
     and r.supply_id = s.id
    where r.supply_id is null
  ) then
    raise exception 'Реестр номеров поставок не совпадает с активными поставками';
  end if;
end;
$$;

alter table public.fulfillment_supply_number_registry enable row level security;

create or replace function public.assign_fulfillment_supply_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supply_number is null then
    perform pg_advisory_xact_lock(hashtextextended('supply-number:' || new.account_id::text, 0));

    select greatest(
      coalesce((select max(s.supply_number) from public.fulfillment_supplies s where s.account_id = new.account_id), 0),
      coalesce((select max(tl.shipment_number) from public.trip_lines tl where tl.account_id = new.account_id), 0),
      coalesce((select max(r.supply_number) from public.fulfillment_supply_number_registry r where r.account_id = new.account_id), 0)
    ) + 1 into new.supply_number;
  end if;

  if new.supply_number < 1 then
    raise exception 'Номер поставки должен быть положительным';
  end if;

  return new;
end;
$$;

create or replace function public.register_fulfillment_supply_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fulfillment_supply_number_registry (
    account_id, supply_number, supply_id
  ) values (
    new.account_id, new.supply_number, new.id
  );
  return new;
exception
  when unique_violation then
    raise exception 'Системный номер поставки уже использовался ранее и не может быть выдан повторно';
end;
$$;

drop trigger if exists fulfillment_supply_number_trigger on public.fulfillment_supplies;
create trigger fulfillment_supply_number_trigger
before insert on public.fulfillment_supplies
for each row execute function public.assign_fulfillment_supply_number();

drop trigger if exists fulfillment_supply_number_registry_trigger on public.fulfillment_supplies;
create trigger fulfillment_supply_number_registry_trigger
after insert on public.fulfillment_supplies
for each row execute function public.register_fulfillment_supply_number();

alter table public.fulfillment_boxes
  add column if not exists barcode text;

create or replace function public.set_fulfillment_box_barcode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_short_id integer;
  v_batch_short_id integer;
  v_supply_number integer;
  v_account_id uuid;
begin
  select a.short_id, fb.short_id, fs.supply_number, fs.account_id
  into v_account_short_id, v_batch_short_id, v_supply_number, v_account_id
  from public.fulfillment_supplies fs
  join public.fulfillment_batches fb on fb.id = fs.batch_id
  join public.accounts a on a.id = fs.account_id
  where fs.id = new.supply_id;

  if v_account_short_id is null or v_batch_short_id is null or v_supply_number is null then
    raise exception 'Невозможно сформировать ШК короба: отсутствует ID компании, партии или поставки';
  end if;

  if new.account_id is distinct from v_account_id then
    raise exception 'Компания короба не совпадает с компанией поставки';
  end if;

  if new.box_number < 1 then
    raise exception 'Номер короба должен быть положительным';
  end if;

  new.barcode := format(
    'EL_C%s_P%s_S%s_B%s',
    v_account_short_id,
    v_batch_short_id,
    v_supply_number,
    new.box_number
  );

  if length(new.barcode) > 30 then
    raise exception 'ШК короба превышает лимит 30 символов: %', new.barcode;
  end if;

  return new;
end;
$$;

drop trigger if exists fulfillment_box_barcode_trigger on public.fulfillment_boxes;
create trigger fulfillment_box_barcode_trigger
before insert on public.fulfillment_boxes
for each row execute function public.set_fulfillment_box_barcode();

update public.fulfillment_boxes b
set barcode = format(
  'EL_C%s_P%s_S%s_B%s',
  a.short_id,
  fb.short_id,
  fs.supply_number,
  b.box_number
)
from public.fulfillment_supplies fs
join public.fulfillment_batches fb on fb.id = fs.batch_id
join public.accounts a on a.id = fs.account_id
where b.supply_id = fs.id
  and b.barcode is null;

do $$
begin
  if exists (select 1 from public.fulfillment_boxes where barcode is null) then
    raise exception 'Не всем коробам удалось сформировать ШК';
  end if;
  if exists (select 1 from public.fulfillment_boxes where length(barcode) > 30) then
    raise exception 'Один или несколько ШК коробов превышают 30 символов';
  end if;
end;
$$;

alter table public.fulfillment_boxes
  alter column barcode set not null;

create unique index if not exists fulfillment_boxes_barcode_key
  on public.fulfillment_boxes(barcode);

create table if not exists public.fulfillment_box_barcode_registry (
  barcode text primary key,
  account_id uuid not null,
  supply_id uuid not null,
  box_number integer not null,
  box_id uuid unique references public.fulfillment_boxes(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (supply_id, box_number)
);

insert into public.fulfillment_box_barcode_registry (
  barcode, account_id, supply_id, box_number, box_id
)
select b.barcode, b.account_id, b.supply_id, b.box_number, b.id
from public.fulfillment_boxes b
on conflict (barcode) do nothing;

do $$
begin
  if exists (
    select 1
    from public.fulfillment_boxes b
    left join public.fulfillment_box_barcode_registry r
      on r.barcode = b.barcode
     and r.account_id = b.account_id
     and r.supply_id = b.supply_id
     and r.box_number = b.box_number
     and r.box_id = b.id
    where r.barcode is null
  ) then
    raise exception 'Реестр ШК коробов не совпадает с активными коробами';
  end if;
end;
$$;

update public.fulfillment_supplies s
set next_box_number = greatest(
  s.next_box_number,
  coalesce((
    select max(r.box_number) + 1
    from public.fulfillment_box_barcode_registry r
    where r.supply_id = s.id
  ), 1)
);

alter table public.fulfillment_box_barcode_registry enable row level security;

create or replace function public.register_fulfillment_box_barcode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fulfillment_box_barcode_registry (
    barcode, account_id, supply_id, box_number, box_id
  ) values (
    new.barcode, new.account_id, new.supply_id, new.box_number, new.id
  );

  update public.fulfillment_supplies
  set next_box_number = greatest(next_box_number, new.box_number + 1)
  where id = new.supply_id;

  return new;
exception
  when unique_violation then
    raise exception 'ШК или номер короба уже использовался ранее и не может быть выдан повторно';
end;
$$;

drop trigger if exists fulfillment_box_barcode_registry_trigger on public.fulfillment_boxes;
create trigger fulfillment_box_barcode_registry_trigger
after insert on public.fulfillment_boxes
for each row execute function public.register_fulfillment_box_barcode();

create or replace function public.protect_fulfillment_supply_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supply_number is distinct from old.supply_number then
    raise exception 'Системный номер поставки нельзя изменять';
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_supply_number_immutable_trigger on public.fulfillment_supplies;
create trigger fulfillment_supply_number_immutable_trigger
before update of supply_number on public.fulfillment_supplies
for each row execute function public.protect_fulfillment_supply_number();

create or replace function public.protect_fulfillment_box_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.supply_id is distinct from old.supply_id
     or new.account_id is distinct from old.account_id
     or new.box_number is distinct from old.box_number
     or new.barcode is distinct from old.barcode then
    raise exception 'Системный номер, поставку и ШК существующего короба нельзя изменять';
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_box_barcode_immutable_trigger on public.fulfillment_boxes;
create trigger fulfillment_box_barcode_immutable_trigger
before update of supply_id, account_id, box_number, barcode on public.fulfillment_boxes
for each row execute function public.protect_fulfillment_box_identity();

create or replace function public.align_trip_line_with_fulfillment_supply()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
begin
  if new.fulfillment_supply_id is null then
    if tg_op = 'INSERT' then
      perform pg_advisory_xact_lock(hashtextextended('supply-number:' || new.account_id::text, 0));
      if exists (
        select 1 from public.fulfillment_supplies s
        where s.account_id = new.account_id
          and s.supply_number = new.shipment_number
      ) or exists (
        select 1 from public.fulfillment_supply_number_registry r
        where r.account_id = new.account_id
          and r.supply_number = new.shipment_number
      ) then
        select greatest(
          coalesce((select max(tl.shipment_number) from public.trip_lines tl where tl.account_id = new.account_id), 0),
          coalesce((select max(s.supply_number) from public.fulfillment_supplies s where s.account_id = new.account_id), 0),
          coalesce((select max(r.supply_number) from public.fulfillment_supply_number_registry r where r.account_id = new.account_id), 0)
        ) + 1 into new.shipment_number;
      end if;
    end if;
    return new;
  end if;

  select * into v_supply
  from public.fulfillment_supplies
  where id = new.fulfillment_supply_id;

  if not found then
    raise exception 'Поставка фулфилмента не найдена';
  end if;
  if new.account_id is distinct from v_supply.account_id then
    raise exception 'Компания поставки не совпадает с компанией строки логистики';
  end if;

  new.shipment_number := v_supply.supply_number;
  new.fulfillment_batch_id := v_supply.batch_id;
  return new;
end;
$$;

drop trigger if exists trip_line_fulfillment_supply_number_trigger on public.trip_lines;
create trigger trip_line_fulfillment_supply_number_trigger
before insert or update of fulfillment_supply_id on public.trip_lines
for each row execute function public.align_trip_line_with_fulfillment_supply();

drop function if exists public.add_trip_line(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text
);

drop function if exists public.add_trip_line(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text, uuid
);

create function public.add_trip_line(
  p_trip_id uuid,
  p_account_id uuid,
  p_store_id uuid,
  p_destination_warehouse text,
  p_box_qty integer default 0,
  p_units_qty integer default 0,
  p_units_total integer default 0,
  p_arrived_box_qty integer default 0,
  p_planned_marketplace_delivery_date date default null,
  p_arrival_date date default null,
  p_reception_date date default null,
  p_shipped_date date default null,
  p_weight numeric default null,
  p_status text default 'Ожидает отправки',
  p_payment_status text default 'Не оплачено',
  p_comment text default '',
  p_fulfillment_supply_id uuid default null
)
returns public.trip_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_batch_id uuid;
  v_next_shipment_number integer;
  v_created_line public.trip_lines;
begin
  perform pg_advisory_xact_lock(hashtextextended('supply-number:' || p_account_id::text, 0));

  if p_fulfillment_supply_id is not null then
    select * into v_supply
    from public.fulfillment_supplies
    where id = p_fulfillment_supply_id
      and account_id = p_account_id
    for update;

    if not found then
      raise exception 'Поставка фулфилмента не найдена';
    end if;

    if v_supply.trip_line_id is not null then
      select * into v_created_line
      from public.trip_lines
      where id = v_supply.trip_line_id;
      if found then
        return v_created_line;
      end if;
    end if;

    v_next_shipment_number := v_supply.supply_number;
    v_batch_id := v_supply.batch_id;
  else
    select greatest(
      coalesce((select max(tl.shipment_number) from public.trip_lines tl where tl.account_id = p_account_id), 0),
      coalesce((select max(s.supply_number) from public.fulfillment_supplies s where s.account_id = p_account_id), 0),
      coalesce((select max(r.supply_number) from public.fulfillment_supply_number_registry r where r.account_id = p_account_id), 0)
    ) + 1 into v_next_shipment_number;
  end if;

  insert into public.trip_lines (
    trip_id, account_id, store_id, shipment_number,
    destination_warehouse, box_qty, units_qty, units_total,
    arrived_box_qty, planned_marketplace_delivery_date,
    arrival_date, reception_date, shipped_date, weight,
    status, payment_status, comment,
    fulfillment_batch_id, fulfillment_supply_id
  ) values (
    p_trip_id, p_account_id, p_store_id, v_next_shipment_number,
    p_destination_warehouse, p_box_qty, p_units_qty, p_units_total,
    p_arrived_box_qty, p_planned_marketplace_delivery_date,
    p_arrival_date, p_reception_date, p_shipped_date, p_weight,
    p_status, p_payment_status, coalesce(p_comment, ''),
    v_batch_id, p_fulfillment_supply_id
  )
  returning * into v_created_line;

  if p_fulfillment_supply_id is not null then
    update public.fulfillment_supplies
    set trip_id = p_trip_id,
        trip_line_id = v_created_line.id
    where id = p_fulfillment_supply_id;
  end if;

  return v_created_line;
end;
$$;

revoke all on function public.add_trip_line(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text, uuid
) from public;
grant execute on function public.add_trip_line(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text, uuid
) to authenticated;

create or replace function public.sync_ready_box_supply(
  p_item_id uuid,
  p_target_count integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.fulfillment_items%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_supply_id uuid;
  v_current_count integer;
  v_change_count integer;
  v_start_number integer;
  v_blocked_numbers text;
begin
  if p_target_count < 1 then
    raise exception 'Количество готовых коробов должно быть не меньше 1';
  end if;

  select * into v_item
  from public.fulfillment_items
  where id = p_item_id
  for update;

  if not found or v_item.product_name is distinct from 'Готовые короба' then
    raise exception 'Позиция готовых коробов не найдена';
  end if;

  select * into v_batch
  from public.fulfillment_batches
  where id = v_item.batch_id;

  if not exists (
    select 1 from public.account_members am
    where am.account_id = v_batch.account_id
      and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к партии';
  end if;

  select s.id into v_supply_id
  from public.fulfillment_supplies s
  where s.source_item_id = v_item.id
  limit 1
  for update;

  if v_supply_id is null then
    select s.id into v_supply_id
    from public.fulfillment_supplies s
    where s.batch_id = v_item.batch_id
      and s.warehouse_name = coalesce(v_item.notes, '')
      and s.source_item_id is null
    order by s.created_at, s.id
    limit 1
    for update skip locked;

    if v_supply_id is null then
      insert into public.fulfillment_supplies (
        batch_id, account_id, warehouse_id, warehouse_name,
        trip_id, trip_line_id, created_by, source_item_id
      ) values (
        v_item.batch_id,
        v_batch.account_id,
        (
          select w.id
          from public.warehouses w
          where w.name = coalesce(v_item.notes, '')
            and (w.account_id = v_batch.account_id or w.account_id is null)
          order by (w.account_id = v_batch.account_id) desc
          limit 1
        ),
        coalesce(v_item.notes, ''),
        null, null, auth.uid(), v_item.id
      ) returning id into v_supply_id;
    else
      update public.fulfillment_supplies
      set source_item_id = v_item.id
      where id = v_supply_id;
    end if;
  end if;

  select count(*)::integer into v_current_count
  from public.fulfillment_boxes
  where supply_id = v_supply_id;

  if p_target_count < v_current_count then
    v_change_count := v_current_count - p_target_count;

    with boxes_to_remove as (
      select b.id, b.box_number
      from public.fulfillment_boxes b
      where b.supply_id = v_supply_id
      order by b.box_number desc
      limit v_change_count
    )
    select string_agg('BOX' || r.box_number::text, ', ' order by r.box_number)
    into v_blocked_numbers
    from boxes_to_remove r
    where exists (
      select 1 from public.fulfillment_box_items bi where bi.box_id = r.id
    );

    if v_blocked_numbers is not null then
      raise exception 'Нельзя уменьшить количество. Содержат товары: %', v_blocked_numbers;
    end if;

    with boxes_to_remove as (
      select b.id
      from public.fulfillment_boxes b
      where b.supply_id = v_supply_id
      order by b.box_number desc
      limit v_change_count
    )
    delete from public.fulfillment_boxes b
    using boxes_to_remove r
    where b.id = r.id;
  elsif p_target_count > v_current_count then
    v_change_count := p_target_count - v_current_count;
    select s.next_box_number into v_start_number
    from public.fulfillment_supplies s
    where s.id = v_supply_id
    for update;

    insert into public.fulfillment_boxes (supply_id, account_id, box_number, status)
    select v_supply_id, v_batch.account_id, n, 'open'
    from generate_series(v_start_number, v_start_number + v_change_count - 1) as n;
  end if;

  update public.fulfillment_items
  set boxes = p_target_count
  where id = v_item.id;

  return v_supply_id;
end;
$$;

revoke all on function public.sync_ready_box_supply(uuid, integer) from public;
grant execute on function public.sync_ready_box_supply(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
