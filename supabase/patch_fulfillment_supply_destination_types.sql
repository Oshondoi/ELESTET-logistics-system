-- Поставки этапа «Короба» могут направляться либо на склад WB по модели FBO,
-- либо на собственный склад фулфилмента с включённым режимом FBS.
-- Название склада остаётся снимком для истории, а UUID хранит точную связь
-- с соответствующим справочником.

alter table public.fulfillment_supplies
  add column if not exists destination_type text not null default 'fbo',
  add column if not exists destination_wms_warehouse_id uuid
    references public.wms_warehouses(id) on delete restrict;

-- A previous run may already have created the inline FK with another delete
-- action. Recreate it deterministically so a warehouse referenced by supply
-- history cannot be deleted and silently lose its exact identity.
alter table public.fulfillment_supplies
  drop constraint if exists fulfillment_supplies_destination_wms_warehouse_id_fkey;

alter table public.fulfillment_supplies
  add constraint fulfillment_supplies_destination_wms_warehouse_id_fkey
  foreign key (destination_wms_warehouse_id)
  references public.wms_warehouses(id)
  on delete restrict;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fulfillment_supplies'::regclass
      and conname = 'fulfillment_supplies_destination_type_check'
  ) then
    alter table public.fulfillment_supplies
      add constraint fulfillment_supplies_destination_type_check
      check (destination_type in ('fbo', 'fbs'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fulfillment_supplies'::regclass
      and conname = 'fulfillment_supplies_destination_reference_check'
  ) then
    alter table public.fulfillment_supplies
      add constraint fulfillment_supplies_destination_reference_check
      check (
        (destination_type = 'fbo' and destination_wms_warehouse_id is null)
        or
        (destination_type = 'fbs' and warehouse_id is null and destination_wms_warehouse_id is not null)
      );
  end if;
end
$$;

create index if not exists fulfillment_supplies_destination_wms_warehouse_idx
  on public.fulfillment_supplies(destination_wms_warehouse_id)
  where destination_wms_warehouse_id is not null;

comment on column public.fulfillment_supplies.destination_type is
  'Модель назначения поставки: fbo — системный склад WB; fbs — внутренний склад ELESTET с включённым FBS.';

comment on column public.fulfillment_supplies.destination_wms_warehouse_id is
  'Точная ссылка на внутренний склад ELESTET для FBS. Для FBO всегда NULL; связанный исторический склад удалить нельзя.';

create or replace function public.validate_fulfillment_supply_destination()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_executor_account_id uuid;
begin
  if new.destination_type <> 'fbs' then
    return new;
  end if;

  select coalesce(stage.partner_account_id, stage.owner_account_id, batch.account_id)
  into v_executor_account_id
  from public.fulfillment_batches batch
  left join public.batch_pipeline_stages stage
    on stage.id = new.pipeline_stage_id
   and stage.batch_id = batch.id
  where batch.id = new.batch_id;

  if not exists (
    select 1
    from public.wms_warehouses warehouse
    where warehouse.id = new.destination_wms_warehouse_id
      and warehouse.account_id = v_executor_account_id
      and warehouse.fbs_enabled = true
  ) then
    raise exception 'Для FBS выберите склад исполнителя с включённым режимом FBS';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_fulfillment_supply_destination_trigger
  on public.fulfillment_supplies;

create trigger validate_fulfillment_supply_destination_trigger
before insert or update of destination_type, destination_wms_warehouse_id, warehouse_id, batch_id, pipeline_stage_id
on public.fulfillment_supplies
for each row
execute function public.validate_fulfillment_supply_destination();
