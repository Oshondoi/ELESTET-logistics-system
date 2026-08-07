-- Один баркод должен занимать ровно одну строку внутри одного короба.
-- Сначала безопасно объединяем накопленные дубли, затем запрещаем новые
-- и добавляем атомарное увеличение количества для быстрых сканов.

with duplicate_groups as (
  select
    box_id,
    barcode,
    (array_agg(id order by created_at, id))[1] as keep_id,
    sum(qty)::integer as total_qty,
    (array_agg(item_id order by created_at) filter (where item_id is not null))[1] as item_id,
    (array_agg(product_name order by created_at) filter (where product_name is not null))[1] as product_name
  from public.fulfillment_box_items
  group by box_id, barcode
  having count(*) > 1
)
update public.fulfillment_box_items bi
set
  qty = dg.total_qty,
  item_id = coalesce(bi.item_id, dg.item_id),
  product_name = coalesce(bi.product_name, dg.product_name)
from duplicate_groups dg
where bi.id = dg.keep_id;

with duplicate_groups as (
  select box_id, barcode, (array_agg(id order by created_at, id))[1] as keep_id
  from public.fulfillment_box_items
  group by box_id, barcode
  having count(*) > 1
)
delete from public.fulfillment_box_items bi
using duplicate_groups dg
where bi.box_id = dg.box_id
  and bi.barcode = dg.barcode
  and bi.id <> dg.keep_id;

create unique index if not exists fulfillment_box_items_box_barcode_uidx
  on public.fulfillment_box_items(box_id, barcode);

create or replace function public.increment_fulfillment_box_item(
  p_box_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_product_name text,
  p_qty integer
)
returns public.fulfillment_box_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_result public.fulfillment_box_items%rowtype;
  v_barcode text := trim(p_barcode);
begin
  if v_barcode = '' then
    raise exception 'Баркод не указан';
  end if;
  if p_qty < 1 then
    raise exception 'Количество должно быть не меньше 1';
  end if;

  select * into v_box
  from public.fulfillment_boxes
  where id = p_box_id;

  if not found then
    raise exception 'Короб не найден';
  end if;

  if not exists (
    select 1
    from public.account_members am
    where am.account_id = v_box.account_id
      and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к коробу';
  end if;

  insert into public.fulfillment_box_items (
    box_id,
    account_id,
    barcode,
    item_id,
    product_name,
    qty
  )
  values (
    v_box.id,
    v_box.account_id,
    v_barcode,
    p_item_id,
    p_product_name,
    p_qty
  )
  on conflict (box_id, barcode) do update
  set
    qty = fulfillment_box_items.qty + excluded.qty,
    item_id = coalesce(fulfillment_box_items.item_id, excluded.item_id),
    product_name = coalesce(fulfillment_box_items.product_name, excluded.product_name)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.increment_fulfillment_box_item(uuid, text, uuid, text, integer) from public;
grant execute on function public.increment_fulfillment_box_item(uuid, text, uuid, text, integer) to authenticated;
