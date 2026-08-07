-- Готовые короба: стабильная связь с позицией приёмки и атомарная синхронизация.
-- Колонка fulfillment_boxes.status намеренно сохраняется для совместимости.

alter table public.fulfillment_supplies
  add column if not exists source_item_id uuid
  references public.fulfillment_items(id) on delete set null;

create unique index if not exists fulfillment_supplies_source_item_uidx
  on public.fulfillment_supplies(source_item_id)
  where source_item_id is not null;

-- Привязать старые поставки к готовым коробам там, где соответствие однозначно
-- по партии и складу. Лишние старые дубли автоматически не удаляются.
with ready_items as (
  select
    i.id as item_id,
    i.batch_id,
    i.notes as warehouse_name,
    row_number() over (
      partition by i.batch_id, i.notes
      order by i.created_at, i.id
    ) as rn
  from public.fulfillment_items i
  where i.product_name = 'Готовые короба'
), candidate_supplies as (
  select
    s.id as supply_id,
    s.batch_id,
    s.warehouse_name,
    row_number() over (
      partition by s.batch_id, s.warehouse_name
      order by s.created_at, s.id
    ) as rn
  from public.fulfillment_supplies s
  where s.source_item_id is null
)
update public.fulfillment_supplies s
set source_item_id = ri.item_id
from ready_items ri
join candidate_supplies cs
  on cs.batch_id = ri.batch_id
 and cs.warehouse_name = ri.warehouse_name
 and cs.rn = ri.rn
where s.id = cs.supply_id
  and s.source_item_id is null;

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
    select 1
    from public.account_members am
    where am.account_id = v_batch.account_id
      and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к партии';
  end if;

  select s.id into v_supply_id
  from public.fulfillment_supplies s
  where s.source_item_id = v_item.id
  limit 1;

  if v_supply_id is null then
    -- Подхватываем старую непривязанную поставку, если она есть.
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
        batch_id,
        account_id,
        warehouse_id,
        warehouse_name,
        trip_id,
        trip_line_id,
        created_by,
        source_item_id
      )
      values (
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
        null,
        null,
        auth.uid(),
        v_item.id
      )
      returning id into v_supply_id;
    else
      update public.fulfillment_supplies
      set source_item_id = v_item.id
      where id = v_supply_id;
    end if;
  end if;

  -- Уменьшение допустимо только когда все удаляемые последние короба пусты.
  select string_agg('BOX' || b.box_number::text, ', ' order by b.box_number)
  into v_blocked_numbers
  from public.fulfillment_boxes b
  where b.supply_id = v_supply_id
    and b.box_number > p_target_count
    and exists (
      select 1
      from public.fulfillment_box_items bi
      where bi.box_id = b.id
    );

  if v_blocked_numbers is not null then
    raise exception 'Нельзя уменьшить количество. Содержат товары: %', v_blocked_numbers;
  end if;

  delete from public.fulfillment_boxes b
  where b.supply_id = v_supply_id
    and b.box_number > p_target_count;

  insert into public.fulfillment_boxes (
    supply_id,
    account_id,
    box_number,
    status
  )
  select
    v_supply_id,
    v_batch.account_id,
    n,
    'open'
  from generate_series(1, p_target_count) as n
  on conflict (supply_id, box_number) do nothing;

  update public.fulfillment_items
  set boxes = p_target_count
  where id = v_item.id;

  return v_supply_id;
end;
$$;

revoke all on function public.sync_ready_box_supply(uuid, integer) from public;
grant execute on function public.sync_ready_box_supply(uuid, integer) to authenticated;
