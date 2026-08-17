-- User-controlled vertical numbering for rack tiers and pallet K-slots.
-- Existing layouts keep the historical top-to-bottom direction.

alter table public.wms_zones
  add column if not exists row_number_direction text not null default 'top_to_bottom';

alter table public.wms_zone_sides
  add column if not exists slot_number_direction text not null default 'top_to_bottom';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wms_zones_row_number_direction_check'
  ) then
    alter table public.wms_zones
      add constraint wms_zones_row_number_direction_check
      check (row_number_direction in ('top_to_bottom', 'bottom_to_top'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wms_zone_sides_slot_number_direction_check'
  ) then
    alter table public.wms_zone_sides
      add constraint wms_zone_sides_slot_number_direction_check
      check (slot_number_direction in ('top_to_bottom', 'bottom_to_top'));
  end if;
end;
$$;

-- Keep the existing RPC signature for old browser builds. The zone direction is
-- carried in every side object, so saving the entire layout remains atomic.
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
  v_row_number_direction text := coalesce(p_sides->0->>'row_number_direction', 'top_to_bottom');
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
  if v_row_number_direction not in ('top_to_bottom', 'bottom_to_top') then
    raise exception 'Некорректное направление нумерации ярусов';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sides) side
    where coalesce(side->>'slot_number_direction', 'top_to_bottom')
      not in ('top_to_bottom', 'bottom_to_top')
  ) then
    raise exception 'Некорректное направление нумерации K-мест';
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
      upright_mode, upright_every, upright_after_cols, row_number_direction
    ) values (
      p_warehouse_id, p_account_id, p_name, p_cols, p_rows,
      p_upright_mode, p_upright_every, p_upright_after_cols, v_row_number_direction
    ) returning id into v_zone_id;
  else
    update public.wms_zones
    set name = p_name,
        cols = p_cols,
        rows = p_rows,
        upright_mode = p_upright_mode,
        upright_every = p_upright_every,
        upright_after_cols = p_upright_after_cols,
        row_number_direction = v_row_number_direction,
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

  delete from public.wms_zone_sides
  where zone_id = v_zone_id and not (id = any(v_requested_ids));

  for v_side in select value from jsonb_array_elements(p_sides)
  loop
    v_side_id := nullif(v_side->>'id', '')::uuid;
    if v_side_id is null then
      insert into public.wms_zone_sides (
        zone_id, account_id, code, name, slot_count, slot_columns, slot_rows,
        slot_number_direction, position
      ) values (
        v_zone_id, p_account_id, v_side->>'code', v_side->>'name',
        (v_side->>'slot_columns')::integer * (v_side->>'slot_rows')::integer,
        (v_side->>'slot_columns')::integer, (v_side->>'slot_rows')::integer,
        coalesce(v_side->>'slot_number_direction', 'top_to_bottom'),
        (v_side->>'position')::integer
      );
    else
      update public.wms_zone_sides
      set code = v_side->>'code',
          name = v_side->>'name',
          slot_count = (v_side->>'slot_columns')::integer * (v_side->>'slot_rows')::integer,
          slot_columns = (v_side->>'slot_columns')::integer,
          slot_rows = (v_side->>'slot_rows')::integer,
          slot_number_direction = coalesce(v_side->>'slot_number_direction', 'top_to_bottom'),
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
