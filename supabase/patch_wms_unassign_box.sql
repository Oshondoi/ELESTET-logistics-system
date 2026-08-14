-- Removes only a fulfillment box WMS address.
-- The fulfillment box, its contents, supply and batch remain untouched.

create or replace function public.unassign_wms_fulfillment_box(
  p_item_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item public.wms_cell_items%rowtype;
  v_cell_released boolean := false;
begin
  select * into v_item
  from public.wms_cell_items
  where id = p_item_id
  for update;

  if v_item.id is null then
    raise exception 'Размещение короба не найдено';
  end if;
  if v_item.item_type <> 'box' or v_item.fulfillment_box_id is null then
    raise exception 'Убрать адрес можно только у существующего короба фулфилмента';
  end if;
  if not exists (
    select 1
    from public.account_members am
    where am.account_id = v_item.account_id
      and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к компании';
  end if;

  delete from public.wms_cell_items
  where id = v_item.id;

  -- An occupied pallet place is virtual. If it contains nothing after the
  -- unassignment, remove the WMS cell row so the pallet becomes free again.
  if not exists (
    select 1
    from public.wms_cell_items wi
    where wi.cell_id = v_item.cell_id
  ) then
    delete from public.wms_cells c
    where c.id = v_item.cell_id
      and c.status = 'occupied';
    v_cell_released := found;
  end if;

  return jsonb_build_object(
    'action', 'unassign',
    'item_id', v_item.id,
    'fulfillment_box_id', v_item.fulfillment_box_id,
    'cell_released', v_cell_released
  );
end;
$$;

revoke all on function public.unassign_wms_fulfillment_box(uuid) from public;
grant execute on function public.unassign_wms_fulfillment_box(uuid) to authenticated;
