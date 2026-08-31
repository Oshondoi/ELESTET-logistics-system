-- Physical WMS warehouse assignment for fulfillment reception.
-- A warehouse is an operational parameter of a batch pipeline stage (or of a
-- legacy batch). Reception data remains editable normally until the reception
-- step is completed; later changes are audited as corrections. Stock is still
-- created only when the whole stage/batch is completed.

begin;

alter table public.batch_pipeline_stages
  add column if not exists wms_warehouse_id uuid references public.wms_warehouses(id) on delete restrict,
  add column if not exists wms_warehouse_name text,
  add column if not exists warehouse_corrected_at timestamptz;

alter table public.fulfillment_batches
  add column if not exists wms_warehouse_id uuid references public.wms_warehouses(id) on delete restrict,
  add column if not exists wms_warehouse_name text,
  add column if not exists warehouse_corrected_at timestamptz;

alter table public.fulfillment_stage_stock
  add column if not exists wms_warehouse_id uuid references public.wms_warehouses(id) on delete restrict;

alter table public.fulfillment_reception_history
  add column if not exists is_correction boolean not null default false;

create index if not exists batch_pipeline_stages_wms_warehouse_idx
  on public.batch_pipeline_stages(wms_warehouse_id);
create index if not exists fulfillment_batches_wms_warehouse_idx
  on public.fulfillment_batches(wms_warehouse_id);
create index if not exists fulfillment_stage_stock_wms_warehouse_idx
  on public.fulfillment_stage_stock(wms_warehouse_id, status, barcode);

create table if not exists public.fulfillment_stage_warehouse_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete restrict,
  pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict,
  old_warehouse_id uuid references public.wms_warehouses(id) on delete set null,
  old_warehouse_name text,
  new_warehouse_id uuid references public.wms_warehouses(id) on delete set null,
  new_warehouse_name text,
  is_correction boolean not null default false,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists fulfillment_stage_warehouse_history_stage_idx
  on public.fulfillment_stage_warehouse_history(batch_id, pipeline_stage_id, changed_at desc);

alter table public.fulfillment_stage_warehouse_history enable row level security;
drop policy if exists fulfillment_stage_warehouse_history_select on public.fulfillment_stage_warehouse_history;
create policy fulfillment_stage_warehouse_history_select
  on public.fulfillment_stage_warehouse_history
  for select using (
    exists (
      select 1
      from public.fulfillment_batches batch
      join public.account_members member on member.account_id = batch.account_id
      where batch.id = fulfillment_stage_warehouse_history.batch_id
        and member.user_id = auth.uid()
    )
    or public._is_batch_partner(batch_id)
  );

grant select on public.fulfillment_stage_warehouse_history to authenticated;

create or replace function public.fulfillment_reception_is_completed(
  p_batch_id uuid,
  p_pipeline_stage_id uuid default null
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.fulfillment_stage_logs log
      where log.batch_id = p_batch_id
        and log.stage = 'reception'
        and (
          (p_pipeline_stage_id is null and log.pipeline_stage_id is null)
          or log.pipeline_stage_id = p_pipeline_stage_id
        )
    )
    or (
      p_pipeline_stage_id is not null
      and exists (
        select 1
        from public.batch_pipeline_stages stage
        where stage.id = p_pipeline_stage_id
          and (stage.current_stage <> 'reception' or stage.status = 'done')
      )
    )
    or (
      p_pipeline_stage_id is null
      and exists (
        select 1
        from public.fulfillment_batches batch
        where batch.id = p_batch_id
          and (batch.current_stage <> 'reception' or batch.status = 'done')
          and not exists (
            select 1 from public.batch_pipeline_stages stage where stage.batch_id = batch.id
          )
      )
    )
$$;

create or replace function public.prepare_pipeline_stage_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_executor uuid;
  v_name text;
begin
  if current_setting('app.pipeline_internal', true) = 'on' then return new; end if;
  if new.wms_warehouse_id is not distinct from old.wms_warehouse_id then
    new.wms_warehouse_name := old.wms_warehouse_name;
    return new;
  end if;

  if not public.is_pipeline_stage_executor(old.id) then
    raise exception 'Изменять склад стадии может только её исполнитель';
  end if;

  if new.wms_warehouse_id is null then
    if public.fulfillment_reception_is_completed(old.batch_id, old.id) then
      raise exception 'У завершённой приёмки склад нельзя очистить. Выберите другой склад';
    end if;
    new.wms_warehouse_name := null;
  else
    v_executor := coalesce(old.partner_account_id, old.owner_account_id);
    select warehouse.name into v_name
    from public.wms_warehouses warehouse
    where warehouse.id = new.wms_warehouse_id
      and warehouse.account_id = v_executor;
    if v_name is null then
      raise exception 'Выбранный склад не принадлежит исполнителю стадии';
    end if;
    new.wms_warehouse_name := v_name;
  end if;

  if public.fulfillment_reception_is_completed(old.batch_id, old.id) then
    new.warehouse_corrected_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_pipeline_stage_wms_warehouse_trigger on public.batch_pipeline_stages;
create trigger prepare_pipeline_stage_wms_warehouse_trigger
before update of wms_warehouse_id, wms_warehouse_name on public.batch_pipeline_stages
for each row execute function public.prepare_pipeline_stage_wms_warehouse();

create or replace function public.prepare_legacy_batch_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_name text;
begin
  if new.wms_warehouse_id is not distinct from old.wms_warehouse_id then
    new.wms_warehouse_name := old.wms_warehouse_name;
    return new;
  end if;

  if new.wms_warehouse_id is null then
    if public.fulfillment_reception_is_completed(old.id, null) then
      raise exception 'У завершённой приёмки склад нельзя очистить. Выберите другой склад';
    end if;
    new.wms_warehouse_name := null;
  else
    select warehouse.name into v_name
    from public.wms_warehouses warehouse
    where warehouse.id = new.wms_warehouse_id
      and warehouse.account_id = old.account_id;
    if v_name is null then
      raise exception 'Выбранный склад не принадлежит компании партии';
    end if;
    new.wms_warehouse_name := v_name;
  end if;

  if public.fulfillment_reception_is_completed(old.id, null) then
    new.warehouse_corrected_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_legacy_batch_wms_warehouse_trigger on public.fulfillment_batches;
create trigger prepare_legacy_batch_wms_warehouse_trigger
before update of wms_warehouse_id, wms_warehouse_name on public.fulfillment_batches
for each row execute function public.prepare_legacy_batch_wms_warehouse();

create or replace function public.audit_pipeline_stage_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if current_setting('app.pipeline_internal', true) = 'on' then return new; end if;
  if old.wms_warehouse_id is not distinct from new.wms_warehouse_id then return new; end if;
  insert into public.fulfillment_stage_warehouse_history (
    batch_id, pipeline_stage_id,
    old_warehouse_id, old_warehouse_name,
    new_warehouse_id, new_warehouse_name,
    is_correction, changed_by
  ) values (
    new.batch_id, new.id,
    old.wms_warehouse_id, old.wms_warehouse_name,
    new.wms_warehouse_id, new.wms_warehouse_name,
    public.fulfillment_reception_is_completed(new.batch_id, new.id), auth.uid()
  );

  update public.fulfillment_stage_stock stock
  set wms_warehouse_id = new.wms_warehouse_id,
      warehouse_name = new.wms_warehouse_name,
      updated_at = now()
  where stock.pipeline_stage_id = new.id;
  return new;
end;
$$;

drop trigger if exists audit_pipeline_stage_wms_warehouse_trigger on public.batch_pipeline_stages;
create trigger audit_pipeline_stage_wms_warehouse_trigger
after update of wms_warehouse_id on public.batch_pipeline_stages
for each row execute function public.audit_pipeline_stage_wms_warehouse();

create or replace function public.audit_legacy_batch_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if current_setting('app.pipeline_internal', true) = 'on' then return new; end if;
  if old.wms_warehouse_id is not distinct from new.wms_warehouse_id then return new; end if;
  insert into public.fulfillment_stage_warehouse_history (
    batch_id, pipeline_stage_id,
    old_warehouse_id, old_warehouse_name,
    new_warehouse_id, new_warehouse_name,
    is_correction, changed_by
  ) values (
    new.id, null,
    old.wms_warehouse_id, old.wms_warehouse_name,
    new.wms_warehouse_id, new.wms_warehouse_name,
    public.fulfillment_reception_is_completed(new.id, null), auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_legacy_batch_wms_warehouse_trigger on public.fulfillment_batches;
create trigger audit_legacy_batch_wms_warehouse_trigger
after update of wms_warehouse_id on public.fulfillment_batches
for each row execute function public.audit_legacy_batch_wms_warehouse();

-- A warehouse may be chosen after products were entered, but it must be known
-- when reception itself is completed.
create or replace function public.require_reception_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_warehouse_id uuid;
begin
  if new.stage <> 'reception' then return new; end if;
  if new.pipeline_stage_id is not null then
    select stage.wms_warehouse_id into v_warehouse_id
    from public.batch_pipeline_stages stage
    where stage.id = new.pipeline_stage_id;
  else
    select batch.wms_warehouse_id into v_warehouse_id
    from public.fulfillment_batches batch
    where batch.id = new.batch_id;
  end if;
  if v_warehouse_id is null then
    raise exception 'Перед завершением приёмки выберите склад';
  end if;
  return new;
end;
$$;

drop trigger if exists require_reception_wms_warehouse_trigger on public.fulfillment_stage_logs;
create trigger require_reception_wms_warehouse_trigger
before insert on public.fulfillment_stage_logs
for each row execute function public.require_reception_wms_warehouse();

-- Reception rows are normal editable records until reception completion.
-- Afterwards insertion/update/exclusion is a correction; physical deletion is
-- forbidden so the previous state remains recoverable in history.
create or replace function public.guard_pipeline_stage_item_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage_id uuid;
  v_batch_id uuid;
  v_reception_completed boolean;
begin
  if tg_op = 'INSERT' and new.pipeline_stage_id is null
     and exists (select 1 from public.batch_pipeline_stages stage where stage.batch_id = new.batch_id) then
    select stage.id into new.pipeline_stage_id
    from public.batch_pipeline_stages stage
    where stage.batch_id = new.batch_id
      and stage.status = 'active'
      and public.is_pipeline_stage_executor(stage.id)
    order by stage.order_index
    limit 1;
    if new.pipeline_stage_id is null then
      raise exception 'Изменять данные активной стадии может только её исполнитель';
    end if;
  end if;

  v_stage_id := case when tg_op = 'DELETE' then old.pipeline_stage_id else new.pipeline_stage_id end;
  v_batch_id := case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  if current_setting('app.pipeline_internal', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_stage_id is not null and not public.is_pipeline_stage_executor(v_stage_id) then
    raise exception 'Изменять данные стадии может только её исполнитель';
  end if;

  if tg_op = 'UPDATE' and old.pipeline_stage_id is distinct from new.pipeline_stage_id then
    raise exception 'Нельзя переносить товарную строку между стадиями';
  end if;

  v_reception_completed := public.fulfillment_reception_is_completed(v_batch_id, v_stage_id)
    or (v_stage_id is not null and exists (
      select 1 from public.batch_pipeline_stages stage where stage.id = v_stage_id and stage.status = 'done'
    ))
    or (v_stage_id is null and exists (
      select 1 from public.fulfillment_batches batch where batch.id = v_batch_id and batch.status = 'done'
    ));

  if tg_op = 'DELETE' and v_reception_completed then
    raise exception 'Завершённые данные нельзя удалять. Используйте корректировку';
  end if;
  if tg_op <> 'DELETE' and v_reception_completed then
    new.corrected_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.audit_fulfillment_reception_item()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_is_correction boolean;
begin
  v_new := jsonb_build_object(
    'barcode', new.barcode,
    'product_name', new.product_name,
    'size', new.size,
    'color', new.color,
    'article', new.article,
    'qty_declared', new.qty_declared,
    'qty_good', new.qty_received,
    'qty_defect', new.qty_defect,
    'boxes', new.boxes,
    'warehouse', new.notes,
    'is_excluded', new.is_excluded
  );

  if tg_op = 'INSERT' then
    v_action := case when new.source_item_id is null then 'created' else 'declared_from_previous' end;
  else
    v_old := jsonb_build_object(
      'barcode', old.barcode,
      'product_name', old.product_name,
      'size', old.size,
      'color', old.color,
      'article', old.article,
      'qty_declared', old.qty_declared,
      'qty_good', old.qty_received,
      'qty_defect', old.qty_defect,
      'boxes', old.boxes,
      'warehouse', old.notes,
      'is_excluded', old.is_excluded
    );
    if v_old = v_new then return new; end if;
    v_action := case
      when old.is_excluded = false and new.is_excluded = true then 'excluded'
      when old.is_excluded = true and new.is_excluded = false then 'restored'
      else 'updated'
    end;
  end if;

  v_is_correction := public.fulfillment_reception_is_completed(new.batch_id, new.pipeline_stage_id)
    or new.corrected_at is not null;
  insert into public.fulfillment_reception_history (
    batch_id, pipeline_stage_id, item_id, lineage_id,
    action, old_values, new_values, is_correction, changed_by
  ) values (
    new.batch_id, new.pipeline_stage_id, new.id, new.lineage_id,
    v_action, v_old, v_new, v_is_correction, auth.uid()
  );
  return new;
end;
$$;

update public.fulfillment_reception_history history
set is_correction = true
where not history.is_correction
  and exists (
    select 1
    from public.fulfillment_stage_logs log
    where log.batch_id = history.batch_id
      and log.stage = 'reception'
      and log.completed_at <= history.changed_at
      and (
        (history.pipeline_stage_id is null and log.pipeline_stage_id is null)
        or log.pipeline_stage_id = history.pipeline_stage_id
      )
  );

drop trigger if exists sync_completed_stage_stock_correction_trigger on public.fulfillment_items;
create trigger sync_completed_stage_stock_correction_trigger
after insert or update on public.fulfillment_items
for each row execute function public.sync_completed_stage_stock_correction();

-- Stock rows always inherit the physical warehouse of their completed stage.
create or replace function public.align_fulfillment_stage_stock_wms_warehouse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.pipeline_stage_id is not null then
    select stage.wms_warehouse_id, stage.wms_warehouse_name
    into new.wms_warehouse_id, new.warehouse_name
    from public.batch_pipeline_stages stage
    where stage.id = new.pipeline_stage_id;
  else
    select batch.wms_warehouse_id, batch.wms_warehouse_name
    into new.wms_warehouse_id, new.warehouse_name
    from public.fulfillment_batches batch
    where batch.id = new.batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists align_fulfillment_stage_stock_wms_warehouse_trigger on public.fulfillment_stage_stock;
create trigger align_fulfillment_stage_stock_wms_warehouse_trigger
before insert or update of pipeline_stage_id, batch_id, wms_warehouse_id, warehouse_name
on public.fulfillment_stage_stock
for each row execute function public.align_fulfillment_stage_stock_wms_warehouse();

-- Safe backfill: assign only when the executor/company has exactly one WMS
-- warehouse. Ambiguous historical records remain unassigned for manual correction.
select set_config('app.pipeline_internal', 'on', true);

update public.batch_pipeline_stages stage
set wms_warehouse_id = warehouse.id,
    wms_warehouse_name = warehouse.name
from public.wms_warehouses warehouse
where stage.wms_warehouse_id is null
  and warehouse.account_id = coalesce(stage.partner_account_id, stage.owner_account_id)
  and 1 = (
    select count(*) from public.wms_warehouses candidate
    where candidate.account_id = warehouse.account_id
  );

update public.fulfillment_batches batch
set wms_warehouse_id = warehouse.id,
    wms_warehouse_name = warehouse.name
from public.wms_warehouses warehouse
where batch.wms_warehouse_id is null
  and warehouse.account_id = batch.account_id
  and not exists (
    select 1 from public.batch_pipeline_stages stage where stage.batch_id = batch.id
  )
  and 1 = (
    select count(*) from public.wms_warehouses candidate
    where candidate.account_id = warehouse.account_id
  );

update public.fulfillment_stage_stock stock
set wms_warehouse_id = stage.wms_warehouse_id,
    warehouse_name = stage.wms_warehouse_name,
    updated_at = now()
from public.batch_pipeline_stages stage
where stock.pipeline_stage_id = stage.id
  and stage.wms_warehouse_id is not null;

select set_config('app.pipeline_internal', 'off', true);

create or replace function public.get_wms_warehouse_products(p_warehouse_id uuid)
returns table (
  source_kind text,
  batch_id uuid,
  batch_short_id integer,
  batch_name text,
  pipeline_stage_id uuid,
  pipeline_stage_name text,
  item_id uuid,
  barcode text,
  product_name text,
  article text,
  size text,
  color text,
  quality text,
  quantity integer,
  store_id uuid,
  store_name text,
  store_legal_name text,
  completed_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
declare v_account_id uuid;
begin
  select warehouse.account_id into v_account_id
  from public.wms_warehouses warehouse
  where warehouse.id = p_warehouse_id;
  if v_account_id is null then raise exception 'Склад не найден'; end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_account_id and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к товарам этого склада';
  end if;

  return query
  with pipeline_stock as (
    select
      'pipeline'::text as source_kind,
      batch.id as batch_id,
      batch.short_id as batch_short_id,
      batch.name as batch_name,
      stage.id as pipeline_stage_id,
      stage.name as pipeline_stage_name,
      item.id as item_id,
      stock.barcode,
      item.product_name,
      item.article,
      item.size,
      item.color,
      stock.quality,
      stock.quantity,
      store.id as store_id,
      store.name as store_name,
      coalesce(nullif(store.supplier, ''), nullif(store.supplier_full, '')) as store_legal_name,
      stage.completed_at
    from public.fulfillment_stage_stock stock
    join public.batch_pipeline_stages stage on stage.id = stock.pipeline_stage_id
    join public.fulfillment_batches batch on batch.id = stock.batch_id and batch.deleted_at is null
    left join public.fulfillment_items item on item.id = stock.item_id
    left join public.stores store on store.id = batch.store_id
    where stock.wms_warehouse_id = p_warehouse_id
      and stock.status = 'active'
      and stock.quantity > 0
  ), legacy_stock as (
    select
      'legacy'::text as source_kind,
      batch.id as batch_id,
      batch.short_id as batch_short_id,
      batch.name as batch_name,
      null::uuid as pipeline_stage_id,
      null::text as pipeline_stage_name,
      item.id as item_id,
      item.barcode,
      item.product_name,
      item.article,
      item.size,
      item.color,
      quantity_row.quality,
      quantity_row.quantity,
      store.id as store_id,
      store.name as store_name,
      coalesce(nullif(store.supplier, ''), nullif(store.supplier_full, '')) as store_legal_name,
      batch.updated_at as completed_at
    from public.fulfillment_batches batch
    join public.fulfillment_items item
      on item.batch_id = batch.id
     and item.pipeline_stage_id is null
     and not item.is_excluded
    cross join lateral (
      values ('good'::text, item.qty_received), ('defect'::text, item.qty_defect)
    ) as quantity_row(quality, quantity)
    left join public.stores store on store.id = batch.store_id
    where batch.wms_warehouse_id = p_warehouse_id
      and batch.status = 'done'
      and batch.deleted_at is null
      and quantity_row.quantity > 0
      and not exists (
        select 1 from public.batch_pipeline_stages stage where stage.batch_id = batch.id
      )
  )
  select combined.*
  from (
    select * from pipeline_stock
    union all
    select * from legacy_stock
  ) combined
  order by combined.store_legal_name nulls last, combined.store_name nulls last,
    combined.product_name nulls last, combined.barcode, combined.quality;
end;
$$;

revoke all on function public.get_wms_warehouse_products(uuid) from public;
grant execute on function public.get_wms_warehouse_products(uuid) to authenticated;

commit;
