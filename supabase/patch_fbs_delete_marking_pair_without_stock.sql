-- A marking pair may be scanned with box control disabled. In that case there
-- is no stock allocation to release, and deleting the draft pair must still
-- succeed. Release stock only when an active reservation actually exists.

begin;

create or replace function public.release_deleted_fbs_marking_pair_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('draft', 'error')
     and exists (
       select 1
       from public.fbs_stock_allocations allocation
       where allocation.store_id = old.store_id
         and allocation.wb_order_id = old.order_id
         and allocation.status = 'reserved'
     ) then
    perform public.release_fbs_order_box_reservation(old.store_id, old.order_id);
  end if;
  return old;
end;
$$;

commit;
