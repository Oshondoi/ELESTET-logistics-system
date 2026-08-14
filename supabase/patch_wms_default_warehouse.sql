-- Every company has at least one WMS warehouse.
-- Existing companies are backfilled; new companies receive one automatically.

create or replace function public.create_default_wms_warehouse_for_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.wms_warehouses (account_id, name, description)
  values (new.id, 'Основной склад', '');
  return new;
end;
$$;

drop trigger if exists trg_create_default_wms_warehouse on public.accounts;
create trigger trg_create_default_wms_warehouse
after insert on public.accounts
for each row execute function public.create_default_wms_warehouse_for_account();

insert into public.wms_warehouses (account_id, name, description)
select account.id, 'Основной склад', ''
from public.accounts account
where not exists (
  select 1
  from public.wms_warehouses warehouse
  where warehouse.account_id = account.id
);

create or replace function public.prevent_last_wms_warehouse_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Do not interfere with the cascading hard deletion of the whole company.
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if (
    select count(*)
    from public.wms_warehouses warehouse
    where warehouse.account_id = old.account_id
  ) <= 1 then
    raise exception 'Нельзя удалить единственный склад компании';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_last_wms_warehouse_delete on public.wms_warehouses;
create trigger trg_prevent_last_wms_warehouse_delete
before delete on public.wms_warehouses
for each row execute function public.prevent_last_wms_warehouse_delete();
