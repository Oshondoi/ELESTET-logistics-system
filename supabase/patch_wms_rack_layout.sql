-- WMS rack layout: explicit rack uprights, configurable sides and box slots.
-- Existing cells/items remain valid. Legacy boxes without a slot stay unassigned.

alter table public.wms_zones
  add column if not exists upright_mode text not null default 'interval'
    check (upright_mode in ('interval', 'custom')),
  add column if not exists upright_every integer not null default 3
    check (upright_every between 1 and 26),
  add column if not exists upright_after_cols integer[] not null default '{}'::integer[];

create table if not exists public.wms_zone_sides (
  id         uuid primary key default gen_random_uuid(),
  zone_id    uuid not null references public.wms_zones(id) on delete cascade,
  account_id uuid not null,
  code       text not null,
  name       text not null,
  slot_count integer not null default 8 check (slot_count between 1 and 100),
  position   integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zone_id, code),
  unique (zone_id, position)
);

alter table public.wms_zone_sides
  add column if not exists slot_columns integer not null default 2,
  add column if not exists slot_rows integer not null default 4;

-- Preserve the exact number of existing K-slots while giving them geometry.
-- The normal eight-place layout becomes 2 x 4; unusual legacy counts remain
-- valid as a single column until the user explicitly reconfigures them.
update public.wms_zone_sides
set slot_columns = case when slot_count > 1 and slot_count % 2 = 0 then 2 else 1 end,
    slot_rows = case when slot_count > 1 and slot_count % 2 = 0 then slot_count / 2 else slot_count end
where slot_columns * slot_rows <> slot_count;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wms_zone_sides_slot_geometry_check'
  ) then
    alter table public.wms_zone_sides
      add constraint wms_zone_sides_slot_geometry_check
      check (
        slot_columns between 1 and 100
        and slot_rows between 1 and 100
        and slot_columns * slot_rows = slot_count
        and slot_count between 1 and 100
      );
  end if;
end;
$$;

alter table public.wms_cell_items
  add column if not exists side_id uuid references public.wms_zone_sides(id) on delete restrict,
  add column if not exists slot_number integer check (slot_number is null or slot_number between 1 and 100);

create unique index if not exists wms_cell_items_box_slot_unique
  on public.wms_cell_items(cell_id, side_id, slot_number)
  where item_type = 'box' and side_id is not null and slot_number is not null;

create unique index if not exists wms_cell_items_box_barcode_unique
  on public.wms_cell_items(account_id, barcode)
  where item_type = 'box' and barcode <> '';

create index if not exists wms_zone_sides_zone_idx
  on public.wms_zone_sides(zone_id, position);

create index if not exists wms_cell_items_side_idx
  on public.wms_cell_items(side_id, slot_number)
  where side_id is not null;

alter table public.wms_zone_sides enable row level security;

drop policy if exists "wms_zone_sides_account" on public.wms_zone_sides;
create policy "wms_zone_sides_account" on public.wms_zone_sides for all
  using      (account_id in (select account_id from public.account_members where user_id = auth.uid()))
  with check (account_id in (select account_id from public.account_members where user_id = auth.uid()));

-- Existing zones get the client's current recommended layout: two accessible
-- sides with eight box places on each pallet position.
insert into public.wms_zone_sides (zone_id, account_id, code, name, slot_count, position)
select z.id, z.account_id, defaults.code, defaults.name, defaults.slot_count, defaults.position
from public.wms_zones z
cross join (values
  ('S1'::text, 'Лицевая сторона'::text, 8, 0),
  ('S2'::text, 'Задняя сторона'::text, 8, 1)
) as defaults(code, name, slot_count, position)
where not exists (select 1 from public.wms_zone_sides s where s.zone_id = z.id);

-- Preserve explicit upright boundaries. For existing zones the default is an
-- upright after every three pallet positions (except after the final column).
update public.wms_zones z
set upright_after_cols = coalesce((
  select array_agg(n order by n)
  from generate_series(3, greatest(z.cols - 1, 0), 3) n
), '{}'::integer[])
where cardinality(z.upright_after_cols) = 0;

create or replace function public.validate_wms_zone_resize()
returns trigger
language plpgsql
as $$
begin
  if new.cols < old.cols or new.rows < old.rows then
    if exists (
      select 1
      from public.wms_cells c
      where c.zone_id = old.id
        and (c.row > new.rows or ascii(upper(c.col)) - ascii('A') + 1 > new.cols)
    ) then
      raise exception 'Нельзя уменьшить сетку: за новыми границами есть занятые или настроенные паллетоместа';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_wms_zone_resize on public.wms_zones;
create trigger trg_validate_wms_zone_resize
before update of cols, rows on public.wms_zones
for each row execute function public.validate_wms_zone_resize();

create or replace function public.validate_wms_side_resize()
returns trigger
language plpgsql
as $$
begin
  new.slot_count := new.slot_columns * new.slot_rows;
  if new.slot_count < 1 or new.slot_count > 100 then
    raise exception 'На одной стороне паллеты может быть от 1 до 100 мест коробов';
  end if;
  if tg_op = 'UPDATE' and new.slot_count < old.slot_count and exists (
    select 1
    from public.wms_cell_items i
    where i.side_id = old.id and i.slot_number > new.slot_count
  ) then
    raise exception 'Нельзя уменьшить количество мест: в удаляемых местах находятся короба';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_wms_side_resize on public.wms_zone_sides;
create trigger trg_validate_wms_side_resize
before insert or update of slot_count, slot_columns, slot_rows on public.wms_zone_sides
for each row execute function public.validate_wms_side_resize();

create or replace function public.validate_wms_side_limit()
returns trigger
language plpgsql
as $$
begin
  if new.position not between 0 and 1 then
    raise exception 'У стеллажа может быть максимум две стороны';
  end if;
  if (tg_op = 'INSERT' or new.zone_id is distinct from old.zone_id) and (
    select count(*) from public.wms_zone_sides
    where zone_id = new.zone_id and id is distinct from new.id
  ) >= 2 then
    raise exception 'У стеллажа может быть максимум две стороны';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_wms_side_limit on public.wms_zone_sides;
create trigger trg_validate_wms_side_limit
before insert or update of zone_id, position on public.wms_zone_sides
for each row execute function public.validate_wms_side_limit();

create or replace function public.validate_wms_box_slot()
returns trigger
language plpgsql
as $$
declare
  v_zone_id uuid;
  v_side_zone_id uuid;
  v_slot_count integer;
begin
  if new.item_type <> 'box' then
    new.side_id := null;
    new.slot_number := null;
    return new;
  end if;

  if (new.side_id is null) <> (new.slot_number is null) then
    raise exception 'Сторона и номер места короба должны быть указаны вместе';
  end if;

  -- Null is allowed only for backward-compatible legacy boxes.
  if new.side_id is null then
    return new;
  end if;

  select c.zone_id into v_zone_id
  from public.wms_cells c where c.id = new.cell_id;

  select s.zone_id, s.slot_count into v_side_zone_id, v_slot_count
  from public.wms_zone_sides s where s.id = new.side_id;

  if v_side_zone_id is distinct from v_zone_id then
    raise exception 'Выбранная сторона относится к другому стеллажу';
  end if;
  if new.slot_number < 1 or new.slot_number > v_slot_count then
    raise exception 'Номер места выходит за границы выбранной стороны';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_wms_box_slot on public.wms_cell_items;
create trigger trg_validate_wms_box_slot
before insert or update of item_type, cell_id, side_id, slot_number on public.wms_cell_items
for each row execute function public.validate_wms_box_slot();

create or replace function public.save_wms_zone_layout(
  p_zone_id uuid,
  p_warehouse_id uuid,
  p_account_id uuid,
  p_name text,
  p_cols integer,
  p_rows integer,
  p_upright_mode text,
  p_upright_every integer,
  p_upright_after_cols integer[],
  p_sides jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_zone_id uuid;
  v_side jsonb;
  v_side_id uuid;
  v_requested_ids uuid[];
begin
  if not exists (
    select 1 from public.account_members
    where user_id = auth.uid() and account_id = p_account_id
  ) then
    raise exception 'Нет доступа к компании';
  end if;
  if not exists (
    select 1 from public.wms_warehouses
    where id = p_warehouse_id and account_id = p_account_id
  ) then
    raise exception 'Склад не найден или относится к другой компании';
  end if;
  if jsonb_typeof(p_sides) <> 'array' or jsonb_array_length(p_sides) = 0 then
    raise exception 'У стеллажа должна быть хотя бы одна сторона';
  end if;
  if jsonb_array_length(p_sides) > 2 then
    raise exception 'У стеллажа может быть максимум две стороны';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_upright_after_cols, '{}'::integer[])) boundary
    where boundary < 1 or boundary >= p_cols
  ) then
    raise exception 'Стойка может находиться только между паллетоместами';
  end if;

  if p_zone_id is null then
    insert into public.wms_zones (
      warehouse_id, account_id, name, cols, rows,
      upright_mode, upright_every, upright_after_cols
    ) values (
      p_warehouse_id, p_account_id, p_name, p_cols, p_rows,
      p_upright_mode, p_upright_every, p_upright_after_cols
    ) returning id into v_zone_id;
  else
    update public.wms_zones
    set name = p_name,
        cols = p_cols,
        rows = p_rows,
        upright_mode = p_upright_mode,
        upright_every = p_upright_every,
        upright_after_cols = p_upright_after_cols,
        updated_at = now()
    where id = p_zone_id and account_id = p_account_id
    returning id into v_zone_id;
    if v_zone_id is null then raise exception 'Стеллаж не найден'; end if;
  end if;

  select coalesce(array_agg((entry->>'id')::uuid), '{}'::uuid[])
  into v_requested_ids
  from jsonb_array_elements(p_sides) entry
  where nullif(entry->>'id', '') is not null;

  if exists (
    select 1 from unnest(v_requested_ids) requested_id
    where not exists (
      select 1 from public.wms_zone_sides s
      where s.id = requested_id and s.zone_id = v_zone_id
    )
  ) then
    raise exception 'Одна из сторон относится к другому стеллажу';
  end if;

  -- Delete first so a remaining side can safely take the removed position.
  delete from public.wms_zone_sides
  where zone_id = v_zone_id and not (id = any(v_requested_ids));

  for v_side in select value from jsonb_array_elements(p_sides)
  loop
    v_side_id := nullif(v_side->>'id', '')::uuid;
    if v_side_id is null then
      insert into public.wms_zone_sides (
        zone_id, account_id, code, name, slot_count, slot_columns, slot_rows, position
      ) values (
        v_zone_id, p_account_id, v_side->>'code', v_side->>'name',
        (v_side->>'slot_columns')::integer * (v_side->>'slot_rows')::integer,
        (v_side->>'slot_columns')::integer, (v_side->>'slot_rows')::integer,
        (v_side->>'position')::integer
      );
    else
      update public.wms_zone_sides
      set code = v_side->>'code',
          name = v_side->>'name',
          slot_count = (v_side->>'slot_columns')::integer * (v_side->>'slot_rows')::integer,
          slot_columns = (v_side->>'slot_columns')::integer,
          slot_rows = (v_side->>'slot_rows')::integer,
          position = (v_side->>'position')::integer,
          updated_at = now()
      where id = v_side_id and zone_id = v_zone_id;
    end if;
  end loop;

  return v_zone_id;
end;
$$;

grant execute on function public.save_wms_zone_layout(
  uuid, uuid, uuid, text, integer, integer, text, integer, integer[], jsonb
) to authenticated;

-- One transaction moves a box to an empty K-place or swaps two occupied
-- places. The box identity, barcode/QR and contents never change.
create or replace function public.move_or_swap_wms_box(
  p_box_id uuid,
  p_target_cell_id uuid,
  p_target_side_id uuid,
  p_target_slot_number integer
)
returns jsonb
language plpgsql
as $$
declare
  v_source public.wms_cell_items%rowtype;
  v_target public.wms_cell_items%rowtype;
  v_target_zone_id uuid;
  v_target_side_zone_id uuid;
  v_target_slot_count integer;
begin
  select * into v_source
  from public.wms_cell_items
  where id = p_box_id and item_type = 'box'
  for update;

  if v_source.id is null then raise exception 'Короб не найден'; end if;
  if not exists (
    select 1 from public.account_members
    where user_id = auth.uid() and account_id = v_source.account_id
  ) then
    raise exception 'Нет доступа к компании';
  end if;

  select c.zone_id into v_target_zone_id
  from public.wms_cells c
  where c.id = p_target_cell_id and c.account_id = v_source.account_id;

  select s.zone_id, s.slot_count into v_target_side_zone_id, v_target_slot_count
  from public.wms_zone_sides s
  where s.id = p_target_side_id and s.account_id = v_source.account_id;

  if v_target_zone_id is null or v_target_side_zone_id is distinct from v_target_zone_id then
    raise exception 'Выбранное место относится к другому стеллажу или компании';
  end if;
  if p_target_slot_number < 1 or p_target_slot_number > v_target_slot_count then
    raise exception 'Номер места выходит за границы выбранной стороны';
  end if;

  if v_source.cell_id = p_target_cell_id
     and v_source.side_id = p_target_side_id
     and v_source.slot_number = p_target_slot_number then
    return jsonb_build_object('action', 'none', 'box_id', v_source.id);
  end if;

  select * into v_target
  from public.wms_cell_items
  where cell_id = p_target_cell_id
    and side_id = p_target_side_id
    and slot_number = p_target_slot_number
    and item_type = 'box'
    and id <> v_source.id
  for update;

  if v_target.id is null then
    update public.wms_cell_items
    set cell_id = p_target_cell_id,
        side_id = p_target_side_id,
        slot_number = p_target_slot_number,
        updated_at = now()
    where id = v_source.id;
    return jsonb_build_object('action', 'move', 'box_id', v_source.id);
  end if;

  if v_source.side_id is null or v_source.slot_number is null then
    raise exception 'Для короба без назначенного места сначала выберите свободное место';
  end if;

  -- Temporarily free the source slot to satisfy the unique slot constraint.
  update public.wms_cell_items
  set side_id = null, slot_number = null, updated_at = now()
  where id = v_source.id;

  update public.wms_cell_items
  set cell_id = v_source.cell_id,
      side_id = v_source.side_id,
      slot_number = v_source.slot_number,
      updated_at = now()
  where id = v_target.id;

  update public.wms_cell_items
  set cell_id = p_target_cell_id,
      side_id = p_target_side_id,
      slot_number = p_target_slot_number,
      updated_at = now()
  where id = v_source.id;

  return jsonb_build_object(
    'action', 'swap',
    'box_id', v_source.id,
    'target_box_id', v_target.id
  );
end;
$$;

grant execute on function public.move_or_swap_wms_box(uuid, uuid, uuid, integer)
to authenticated;
