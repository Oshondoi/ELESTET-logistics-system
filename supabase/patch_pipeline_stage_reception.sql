-- Pipeline stage reception, corrections and safe handoff.
-- Keeps legacy non-pipeline batches on fulfillment_items with pipeline_stage_id IS NULL.

alter table public.fulfillment_items
  add column if not exists qty_defect integer not null default 0,
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict,
  add column if not exists lineage_id uuid not null default gen_random_uuid(),
  add column if not exists source_item_id uuid references public.fulfillment_items(id) on delete set null,
  add column if not exists is_excluded boolean not null default false,
  add column if not exists corrected_at timestamptz;

alter table public.fulfillment_items
  drop constraint if exists fulfillment_items_qty_defect_check;
alter table public.fulfillment_items
  add constraint fulfillment_items_qty_defect_check check (qty_defect >= 0);

create index if not exists fulfillment_items_pipeline_stage_idx
  on public.fulfillment_items(pipeline_stage_id, sort_order, created_at);
create index if not exists fulfillment_items_lineage_idx
  on public.fulfillment_items(batch_id, lineage_id);
create unique index if not exists fulfillment_items_stage_lineage_uidx
  on public.fulfillment_items(pipeline_stage_id, lineage_id)
  where pipeline_stage_id is not null;

-- Existing pipeline rows predate stage ownership. Keep an in-progress client
-- working by attaching those rows to the currently active stage (or the last
-- completed stage for an already completed pipeline) without changing values.
update public.fulfillment_items item
set pipeline_stage_id = (
  select stage.id
  from public.batch_pipeline_stages stage
  where stage.batch_id = item.batch_id
  order by
    case when stage.status = 'active' then 0 when stage.status = 'done' then 1 else 2 end,
    stage.order_index desc
  limit 1
)
where item.pipeline_stage_id is null
  and exists (
    select 1 from public.batch_pipeline_stages stage where stage.batch_id = item.batch_id
  );

alter table public.fulfillment_stage_logs
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete set null;
alter table public.batch_pipeline_stages
  add column if not exists otk_discrepancy integer not null default 0;

alter table public.fulfillment_otk_logs
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict;
alter table public.fulfillment_marking_logs
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict;
alter table public.fulfillment_packaging_logs
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict;
alter table public.fulfillment_supplies
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict;
alter table public.batch_consumables
  add column if not exists pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict;

-- Legacy pipeline work belonged to the single globally active workflow. Attach
-- it to the same stage selected for the migrated reception rows.
update public.fulfillment_otk_logs row_value set pipeline_stage_id = (
  select stage.id from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id
  order by case when stage.status='active' then 0 when stage.status='done' then 1 else 2 end,stage.order_index desc limit 1
) where row_value.pipeline_stage_id is null and exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id);
update public.fulfillment_marking_logs row_value set pipeline_stage_id = (
  select stage.id from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id
  order by case when stage.status='active' then 0 when stage.status='done' then 1 else 2 end,stage.order_index desc limit 1
) where row_value.pipeline_stage_id is null and exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id);
update public.fulfillment_packaging_logs row_value set pipeline_stage_id = (
  select stage.id from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id
  order by case when stage.status='active' then 0 when stage.status='done' then 1 else 2 end,stage.order_index desc limit 1
) where row_value.pipeline_stage_id is null and exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id);
update public.fulfillment_supplies row_value set pipeline_stage_id = coalesce(
  (select source_item.pipeline_stage_id from public.fulfillment_items source_item where source_item.id=row_value.source_item_id),
  (select stage.id from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id
   order by case when stage.status='active' then 0 when stage.status='done' then 1 else 2 end,stage.order_index desc limit 1)
) where row_value.pipeline_stage_id is null and exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id);
update public.batch_consumables row_value set pipeline_stage_id = (
  select stage.id from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id
  order by case when stage.status='active' then 0 when stage.status='done' then 1 else 2 end,stage.order_index desc limit 1
) where row_value.pipeline_stage_id is null and exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=row_value.batch_id);

create index if not exists fulfillment_otk_logs_pipeline_stage_idx on public.fulfillment_otk_logs(pipeline_stage_id, created_at);
create index if not exists fulfillment_marking_logs_pipeline_stage_idx on public.fulfillment_marking_logs(pipeline_stage_id, created_at);
create index if not exists fulfillment_packaging_logs_pipeline_stage_idx on public.fulfillment_packaging_logs(pipeline_stage_id, created_at);
create index if not exists fulfillment_supplies_pipeline_stage_idx on public.fulfillment_supplies(pipeline_stage_id, created_at);
create index if not exists batch_consumables_pipeline_stage_idx on public.batch_consumables(pipeline_stage_id, created_at);

alter table public.batch_consumables drop constraint if exists batch_consumables_batch_id_consumable_id_key;
alter table public.batch_consumables drop constraint if exists batch_consumables_pipeline_stage_consumable_key;
alter table public.batch_consumables add constraint batch_consumables_pipeline_stage_consumable_key unique (pipeline_stage_id, consumable_id);
create unique index if not exists batch_consumables_legacy_uidx on public.batch_consumables(batch_id, consumable_id) where pipeline_stage_id is null;

create table if not exists public.fulfillment_reception_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete restrict,
  pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict,
  item_id uuid references public.fulfillment_items(id) on delete set null,
  lineage_id uuid not null,
  action text not null check (action in ('created', 'updated', 'excluded', 'restored', 'declared_from_previous')),
  old_values jsonb,
  new_values jsonb not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists fulfillment_reception_history_stage_idx
  on public.fulfillment_reception_history(pipeline_stage_id, changed_at desc);
create index if not exists fulfillment_reception_history_lineage_idx
  on public.fulfillment_reception_history(batch_id, lineage_id, changed_at desc);

alter table public.fulfillment_reception_history enable row level security;
drop policy if exists fulfillment_reception_history_select on public.fulfillment_reception_history;
create policy fulfillment_reception_history_select on public.fulfillment_reception_history
  for select using (
    exists (
      select 1
      from public.fulfillment_batches batch
      join public.account_members member on member.account_id = batch.account_id
      where batch.id = fulfillment_reception_history.batch_id
        and member.user_id = auth.uid()
    )
    or public._is_batch_partner(batch_id)
  );

create table if not exists public.fulfillment_stage_stock (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete restrict,
  pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  item_id uuid references public.fulfillment_items(id) on delete set null,
  lineage_id uuid not null,
  barcode text not null default '',
  warehouse_name text,
  quality text not null check (quality in ('good', 'defect')),
  quantity integer not null check (quantity >= 0),
  status text not null check (status in ('active', 'transferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_stage_id, lineage_id, quality)
);

create index if not exists fulfillment_stage_stock_account_idx
  on public.fulfillment_stage_stock(account_id, status, barcode);
alter table public.fulfillment_stage_stock enable row level security;
drop policy if exists fulfillment_stage_stock_member_select on public.fulfillment_stage_stock;
create policy fulfillment_stage_stock_member_select on public.fulfillment_stage_stock
  for select using (
    exists (
      select 1 from public.account_members member
      where member.account_id = fulfillment_stage_stock.account_id
        and member.user_id = auth.uid()
    )
  );

create or replace function public.pipeline_stage_executor_account(p_stage public.batch_pipeline_stages)
returns uuid
language sql immutable
as $$
  select coalesce(p_stage.partner_account_id, p_stage.owner_account_id)
$$;

create or replace function public.is_pipeline_stage_executor(p_stage_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.batch_pipeline_stages stage
    join public.account_members member
      on member.account_id = coalesce(stage.partner_account_id, stage.owner_account_id)
    where stage.id = p_stage_id
      and member.user_id = auth.uid()
  )
$$;

create or replace function public.guard_pipeline_stage_item_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage_id uuid;
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
  if current_setting('app.pipeline_internal', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_stage_id is null then
    if tg_op = 'DELETE' and exists (
      select 1 from public.fulfillment_batches batch
      where batch.id = old.batch_id and batch.status = 'done'
    ) then
      raise exception 'Завершённые данные нельзя удалять. Используйте корректировку';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not public.is_pipeline_stage_executor(v_stage_id) then
    raise exception 'Изменять данные стадии может только её исполнитель';
  end if;

  if tg_op = 'DELETE' and exists (
    select 1 from public.batch_pipeline_stages stage
    where stage.id = v_stage_id and stage.status = 'done'
  ) then
    raise exception 'Завершённые данные нельзя удалять. Используйте корректировку';
  end if;

  if tg_op = 'UPDATE' and old.pipeline_stage_id is distinct from new.pipeline_stage_id then
    raise exception 'Нельзя переносить товарную строку между стадиями';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1 from public.batch_pipeline_stages stage
    where stage.id = v_stage_id and stage.status = 'done'
  ) then
    new.corrected_at := now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_pipeline_stage_item_change_trigger on public.fulfillment_items;
create trigger guard_pipeline_stage_item_change_trigger
before insert or update or delete on public.fulfillment_items
for each row execute function public.guard_pipeline_stage_item_change();

create or replace function public.guard_pipeline_stage_owned_row()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_stage_id uuid;
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
  v_stage_id := case when tg_op='DELETE' then old.pipeline_stage_id else new.pipeline_stage_id end;
  if current_setting('app.pipeline_internal', true)='on' or v_stage_id is null then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if not public.is_pipeline_stage_executor(v_stage_id) then
    raise exception 'Изменять данные стадии может только её исполнитель';
  end if;
  if tg_op='UPDATE' and old.pipeline_stage_id is distinct from new.pipeline_stage_id then
    raise exception 'Нельзя переносить запись между стадиями';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_pipeline_stage_otk_log_trigger on public.fulfillment_otk_logs;
create trigger guard_pipeline_stage_otk_log_trigger before insert or update or delete on public.fulfillment_otk_logs for each row execute function public.guard_pipeline_stage_owned_row();
drop trigger if exists guard_pipeline_stage_marking_log_trigger on public.fulfillment_marking_logs;
create trigger guard_pipeline_stage_marking_log_trigger before insert or update or delete on public.fulfillment_marking_logs for each row execute function public.guard_pipeline_stage_owned_row();
drop trigger if exists guard_pipeline_stage_packaging_log_trigger on public.fulfillment_packaging_logs;
create trigger guard_pipeline_stage_packaging_log_trigger before insert or update or delete on public.fulfillment_packaging_logs for each row execute function public.guard_pipeline_stage_owned_row();
drop trigger if exists guard_pipeline_stage_supply_trigger on public.fulfillment_supplies;
create trigger guard_pipeline_stage_supply_trigger before insert or update or delete on public.fulfillment_supplies for each row execute function public.guard_pipeline_stage_owned_row();
drop trigger if exists guard_pipeline_stage_consumable_trigger on public.batch_consumables;
create trigger guard_pipeline_stage_consumable_trigger before insert or update or delete on public.batch_consumables for each row execute function public.guard_pipeline_stage_owned_row();

-- Совместимость с опубликованным до этой миграции frontend: он ещё не передаёт
-- pipeline_stage_id и использует account_id исполнителя. Нормализация должна
-- сработать раньше триггера выдачи номера поставки и генерации QR.
create or replace function public.align_pipeline_supply_owner_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage public.batch_pipeline_stages%rowtype;
  v_owner uuid;
begin
  if new.pipeline_stage_id is null then
    select stage.* into v_stage
    from public.batch_pipeline_stages stage
    where stage.batch_id = new.batch_id
      and stage.status = 'active'
      and public.is_pipeline_stage_executor(stage.id)
    order by stage.order_index
    limit 1;
    if v_stage.id is null then return new; end if;
    new.pipeline_stage_id := v_stage.id;
  else
    select * into v_stage from public.batch_pipeline_stages where id = new.pipeline_stage_id;
  end if;

  if v_stage.id is not null then
    if v_stage.batch_id <> new.batch_id or not public.is_pipeline_stage_executor(v_stage.id) then
      raise exception 'Нет доступа к стадии поставки';
    end if;
    select batch.account_id into v_owner from public.fulfillment_batches batch where batch.id = v_stage.batch_id;
    new.account_id := v_owner;
  end if;
  return new;
end;
$$;

drop trigger if exists "00_align_pipeline_supply_owner_trigger" on public.fulfillment_supplies;
create trigger "00_align_pipeline_supply_owner_trigger"
before insert on public.fulfillment_supplies
for each row execute function public.align_pipeline_supply_owner_before_insert();

create or replace function public.align_pipeline_box_owner_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_supply public.fulfillment_supplies%rowtype;
begin
  select * into v_supply from public.fulfillment_supplies where id = new.supply_id;
  if v_supply.pipeline_stage_id is not null then
    if not public.is_pipeline_stage_executor(v_supply.pipeline_stage_id) then
      raise exception 'Нет доступа к стадии короба';
    end if;
    new.account_id := v_supply.account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists "00_align_pipeline_box_owner_trigger" on public.fulfillment_boxes;
create trigger "00_align_pipeline_box_owner_trigger"
before insert on public.fulfillment_boxes
for each row execute function public.align_pipeline_box_owner_before_insert();

create or replace function public.audit_fulfillment_reception_item()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
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

  insert into public.fulfillment_reception_history (
    batch_id, pipeline_stage_id, item_id, lineage_id,
    action, old_values, new_values, changed_by
  ) values (
    new.batch_id, new.pipeline_stage_id, new.id, new.lineage_id,
    v_action, v_old, v_new, auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_fulfillment_reception_item_trigger on public.fulfillment_items;
create trigger audit_fulfillment_reception_item_trigger
after insert or update on public.fulfillment_items
for each row execute function public.audit_fulfillment_reception_item();

create or replace function public.propagate_pipeline_declared_correction()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_current public.batch_pipeline_stages%rowtype;
  v_next public.batch_pipeline_stages%rowtype;
begin
  if new.pipeline_stage_id is null then
    return new;
  end if;

  select * into v_current from public.batch_pipeline_stages where id = new.pipeline_stage_id;
  if v_current.status <> 'done' then return new; end if;

  select * into v_next
  from public.batch_pipeline_stages
  where batch_id = v_current.batch_id and order_index > v_current.order_index
  order by order_index
  limit 1;

  if v_next.id is not null then
    perform set_config('app.pipeline_internal', 'on', true);
    insert into public.fulfillment_items (
      batch_id, pipeline_stage_id, lineage_id, source_item_id,
      barcode, product_name, size, color, article,
      qty_declared, qty_received, qty_defect,
      qty_otk, qty_marked, qty_packed, boxes, notes, sort_order
    ) values (
      new.batch_id, v_next.id, new.lineage_id, new.id,
      new.barcode, new.product_name, new.size, new.color, new.article,
      case when new.is_excluded then 0 else new.qty_received end, 0, 0,
      null, null, null, new.boxes, new.notes, new.sort_order
    )
    on conflict (pipeline_stage_id, lineage_id) where pipeline_stage_id is not null
    do update set
      qty_declared = excluded.qty_declared,
      barcode = excluded.barcode,
      product_name = excluded.product_name,
      size = excluded.size,
      color = excluded.color,
      article = excluded.article,
      boxes = excluded.boxes,
      notes = excluded.notes;
    perform set_config('app.pipeline_internal', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists propagate_pipeline_declared_correction_trigger on public.fulfillment_items;
create trigger propagate_pipeline_declared_correction_trigger
after insert or update on public.fulfillment_items
for each row execute function public.propagate_pipeline_declared_correction();

create or replace function public.sync_completed_stage_stock_correction()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage public.batch_pipeline_stages%rowtype;
  v_has_next boolean;
  v_executor uuid;
begin
  if new.pipeline_stage_id is null then return new; end if;
  select * into v_stage from public.batch_pipeline_stages where id = new.pipeline_stage_id;
  if v_stage.status <> 'done' then return new; end if;
  select exists (
    select 1 from public.batch_pipeline_stages stage
    where stage.batch_id = v_stage.batch_id and stage.order_index > v_stage.order_index
  ) into v_has_next;
  v_executor := public.pipeline_stage_executor_account(v_stage);

  insert into public.fulfillment_stage_stock (
    batch_id, pipeline_stage_id, account_id, item_id, lineage_id,
    barcode, warehouse_name, quality, quantity, status
  ) values
    (new.batch_id, v_stage.id, v_executor, new.id, new.lineage_id,
     new.barcode, new.notes, 'good', case when new.is_excluded then 0 else new.qty_received end,
     case when v_has_next then 'transferred' else 'active' end),
    (new.batch_id, v_stage.id, v_executor, new.id, new.lineage_id,
     new.barcode, new.notes, 'defect', case when new.is_excluded then 0 else new.qty_defect end, 'active')
  on conflict (pipeline_stage_id, lineage_id, quality) do update
  set quantity = excluded.quantity,
      status = excluded.status,
      warehouse_name = excluded.warehouse_name,
      barcode = excluded.barcode,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_completed_stage_stock_correction_trigger on public.fulfillment_items;
create trigger sync_completed_stage_stock_correction_trigger
after update on public.fulfillment_items
for each row execute function public.sync_completed_stage_stock_correction();

create or replace function public.next_pipeline_fulfillment_step(p_stage public.batch_pipeline_stages)
returns text
language plpgsql immutable
as $$
declare
  v_order text[] := array['reception', 'otk', 'packaging', 'marking', 'packing', 'logistics', 'done'];
  v_index integer;
  v_candidate text;
begin
  v_index := array_position(v_order, p_stage.current_stage);
  if v_index is null then return 'done'; end if;
  for v_candidate in select unnest(v_order[v_index + 1:array_length(v_order, 1)]) loop
    if v_candidate = 'done'
       or (v_candidate = 'otk' and p_stage.stage_otk)
       or (v_candidate = 'packaging' and p_stage.stage_packaging)
       or (v_candidate = 'marking' and p_stage.stage_marking)
       or (v_candidate = 'packing' and p_stage.stage_packing)
       or (v_candidate = 'logistics' and p_stage.stage_logistics) then
      return v_candidate;
    end if;
  end loop;
  return 'done';
end;
$$;

create or replace function public.advance_batch_pipeline_step(p_stage_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage public.batch_pipeline_stages%rowtype;
  v_next text;
begin
  select * into v_stage from public.batch_pipeline_stages where id = p_stage_id for update;
  if v_stage.id is null then return jsonb_build_object('error', 'Стадия не найдена'); end if;
  if v_stage.status <> 'active' then return jsonb_build_object('error', 'Стадия не активна'); end if;
  if not public.is_pipeline_stage_executor(v_stage.id) then return jsonb_build_object('error', 'Нет доступа'); end if;
  v_next := public.next_pipeline_fulfillment_step(v_stage);
  insert into public.fulfillment_stage_logs(batch_id, pipeline_stage_id, stage, completed_by)
  values (v_stage.batch_id, v_stage.id, v_stage.current_stage, auth.uid());
  update public.batch_pipeline_stages
  set current_stage = v_next, updated_at = now()
  where id = v_stage.id;
  return jsonb_build_object('ok', true, 'current_stage', v_next);
end;
$$;

create or replace function public.complete_batch_pipeline_stage(p_stage_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage public.batch_pipeline_stages%rowtype;
  v_next public.batch_pipeline_stages%rowtype;
  v_executor uuid;
  v_item public.fulfillment_items%rowtype;
begin
  select * into v_stage from public.batch_pipeline_stages where id = p_stage_id for update;
  if v_stage.id is null then return jsonb_build_object('error', 'Стадия не найдена'); end if;
  if v_stage.status <> 'active' then return jsonb_build_object('error', 'Стадия не активна'); end if;
  if v_stage.current_stage <> 'done' then return jsonb_build_object('error', 'Сначала завершите все этапы стадии'); end if;
  if not public.is_pipeline_stage_executor(v_stage.id) then return jsonb_build_object('error', 'Нет доступа'); end if;

  select * into v_next
  from public.batch_pipeline_stages
  where batch_id = v_stage.batch_id
    and order_index > v_stage.order_index
    and status = 'pending'
  order by order_index
  limit 1
  for update;

  v_executor := public.pipeline_stage_executor_account(v_stage);
  perform set_config('app.pipeline_internal', 'on', true);
  for v_item in
    select * from public.fulfillment_items
    where pipeline_stage_id = v_stage.id and not is_excluded
  loop
    insert into public.fulfillment_stage_stock (
      batch_id, pipeline_stage_id, account_id, item_id, lineage_id,
      barcode, warehouse_name, quality, quantity, status
    ) values
      (v_stage.batch_id, v_stage.id, v_executor, v_item.id, v_item.lineage_id,
       v_item.barcode, v_item.notes, 'good', v_item.qty_received,
       case when v_next.id is null then 'active' else 'transferred' end),
      (v_stage.batch_id, v_stage.id, v_executor, v_item.id, v_item.lineage_id,
       v_item.barcode, v_item.notes, 'defect', v_item.qty_defect, 'active')
    on conflict (pipeline_stage_id, lineage_id, quality) do update
    set quantity = excluded.quantity,
        status = excluded.status,
        warehouse_name = excluded.warehouse_name,
        updated_at = now();

    if v_next.id is not null and v_item.qty_received > 0 then
      insert into public.fulfillment_items (
        batch_id, pipeline_stage_id, lineage_id, source_item_id,
        barcode, product_name, size, color, article,
        qty_declared, qty_received, qty_defect,
        qty_otk, qty_marked, qty_packed, boxes, notes, sort_order
      ) values (
        v_item.batch_id, v_next.id, v_item.lineage_id, v_item.id,
        v_item.barcode, v_item.product_name, v_item.size, v_item.color, v_item.article,
        v_item.qty_received, 0, 0,
        null, null, null, v_item.boxes, v_item.notes, v_item.sort_order
      )
      on conflict (pipeline_stage_id, lineage_id) where pipeline_stage_id is not null
      do update set
        qty_declared = excluded.qty_declared,
        product_name = excluded.product_name,
        size = excluded.size,
        color = excluded.color,
        article = excluded.article,
        boxes = excluded.boxes,
        notes = excluded.notes;
    end if;
  end loop;
  perform set_config('app.pipeline_internal', 'off', true);

  update public.batch_pipeline_stages
  set status = 'done', completed_at = now(), updated_at = now()
  where id = v_stage.id;

  if v_next.id is not null then
    update public.batch_pipeline_stages
    set status = 'active', activated_at = now(), updated_at = now()
    where id = v_next.id;
  else
    update public.fulfillment_batches
    set status = 'done', current_stage = 'done', updated_at = now()
    where id = v_stage.batch_id;
  end if;

  return jsonb_build_object('ok', true, 'next_stage_id', v_next.id);
end;
$$;

create or replace function public.prevent_pipeline_batch_deletion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.batch_pipeline_stages stage where stage.batch_id = old.id) then
    if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
      raise exception 'Партию с пайплайном нельзя удалить';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists prevent_pipeline_batch_deletion_trigger on public.fulfillment_batches;
create trigger prevent_pipeline_batch_deletion_trigger
before update of deleted_at or delete on public.fulfillment_batches
for each row execute function public.prevent_pipeline_batch_deletion();

-- Replace the broad partner policy: a partner may change only rows of its own stage.
drop policy if exists "fulfillment_items_partner_all" on public.fulfillment_items;
drop policy if exists "fulfillment_items_partner_stage_select" on public.fulfillment_items;
drop policy if exists "fulfillment_items_partner_stage_insert" on public.fulfillment_items;
drop policy if exists "fulfillment_items_partner_stage_update" on public.fulfillment_items;
create policy "fulfillment_items_partner_stage_select" on public.fulfillment_items
  for select using (public._is_batch_partner(batch_id));
create policy "fulfillment_items_partner_stage_insert" on public.fulfillment_items
  for insert with check (
    pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id)
  );
create policy "fulfillment_items_partner_stage_update" on public.fulfillment_items
  for update using (
    pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id)
  ) with check (
    pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id)
  );

drop policy if exists "fulfillment_otk_logs_partner_all" on public.fulfillment_otk_logs;
drop policy if exists "fulfillment_otk_logs_partner_stage_select" on public.fulfillment_otk_logs;
drop policy if exists "fulfillment_otk_logs_partner_stage_manage" on public.fulfillment_otk_logs;
create policy "fulfillment_otk_logs_partner_stage_select" on public.fulfillment_otk_logs for select using (public._is_batch_partner(batch_id));
create policy "fulfillment_otk_logs_partner_stage_manage" on public.fulfillment_otk_logs for all
  using (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id))
  with check (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id));

drop policy if exists "fulfillment_marking_logs_partner_all" on public.fulfillment_marking_logs;
drop policy if exists "fulfillment_marking_logs_partner_stage_select" on public.fulfillment_marking_logs;
drop policy if exists "fulfillment_marking_logs_partner_stage_manage" on public.fulfillment_marking_logs;
create policy "fulfillment_marking_logs_partner_stage_select" on public.fulfillment_marking_logs for select using (public._is_batch_partner(batch_id));
create policy "fulfillment_marking_logs_partner_stage_manage" on public.fulfillment_marking_logs for all
  using (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id))
  with check (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id));

drop policy if exists "fulfillment_packaging_logs_partner_all" on public.fulfillment_packaging_logs;
drop policy if exists "fulfillment_packaging_logs_partner_stage_select" on public.fulfillment_packaging_logs;
drop policy if exists "fulfillment_packaging_logs_partner_stage_manage" on public.fulfillment_packaging_logs;
create policy "fulfillment_packaging_logs_partner_stage_select" on public.fulfillment_packaging_logs for select using (public._is_batch_partner(batch_id));
create policy "fulfillment_packaging_logs_partner_stage_manage" on public.fulfillment_packaging_logs for all
  using (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id))
  with check (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id));

drop policy if exists "fulfillment_supplies_pipeline_partner_select" on public.fulfillment_supplies;
create policy "fulfillment_supplies_pipeline_partner_select" on public.fulfillment_supplies for select using (public._is_batch_partner(batch_id));

create or replace function public.can_manage_fulfillment_supply(p_supply_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.fulfillment_supplies supply
    where supply.id = p_supply_id
      and (
        exists (
          select 1 from public.account_members member
          where member.account_id = supply.account_id and member.user_id = auth.uid()
        )
        or (
          supply.pipeline_stage_id is not null
          and public.is_pipeline_stage_executor(supply.pipeline_stage_id)
        )
      )
  )
$$;

create or replace function public.can_manage_fulfillment_box(p_box_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.fulfillment_boxes box
    where box.id = p_box_id
      and public.can_manage_fulfillment_supply(box.supply_id)
  )
$$;

drop policy if exists "fulfillment_supplies_pipeline_partner_manage" on public.fulfillment_supplies;
create policy "fulfillment_supplies_pipeline_partner_manage" on public.fulfillment_supplies for all
  using (
    pipeline_stage_id is not null
    and public.is_pipeline_stage_executor(pipeline_stage_id)
  )
  with check (
    pipeline_stage_id is not null
    and public.is_pipeline_stage_executor(pipeline_stage_id)
    and exists (
      select 1
      from public.batch_pipeline_stages stage
      join public.fulfillment_batches batch on batch.id = stage.batch_id
      where stage.id = fulfillment_supplies.pipeline_stage_id
        and stage.batch_id = fulfillment_supplies.batch_id
        and batch.account_id = fulfillment_supplies.account_id
    )
  );

drop policy if exists "fulfillment_boxes_pipeline_partner_select" on public.fulfillment_boxes;
create policy "fulfillment_boxes_pipeline_partner_select" on public.fulfillment_boxes for select using (
  exists (select 1 from public.fulfillment_supplies supply where supply.id=fulfillment_boxes.supply_id and public._is_batch_partner(supply.batch_id))
);
drop policy if exists "fulfillment_boxes_pipeline_partner_manage" on public.fulfillment_boxes;
create policy "fulfillment_boxes_pipeline_partner_manage" on public.fulfillment_boxes for all
  using (public.can_manage_fulfillment_supply(supply_id))
  with check (
    public.can_manage_fulfillment_supply(supply_id)
    and exists (
      select 1 from public.fulfillment_supplies supply
      where supply.id = fulfillment_boxes.supply_id
        and supply.account_id = fulfillment_boxes.account_id
    )
  );
drop policy if exists "fulfillment_box_items_pipeline_partner_select" on public.fulfillment_box_items;
create policy "fulfillment_box_items_pipeline_partner_select" on public.fulfillment_box_items for select using (
  exists (
    select 1 from public.fulfillment_boxes box
    join public.fulfillment_supplies supply on supply.id=box.supply_id
    where box.id=fulfillment_box_items.box_id and public._is_batch_partner(supply.batch_id)
  )
);
drop policy if exists "fulfillment_box_items_pipeline_partner_manage" on public.fulfillment_box_items;
create policy "fulfillment_box_items_pipeline_partner_manage" on public.fulfillment_box_items for all
  using (public.can_manage_fulfillment_box(box_id))
  with check (
    public.can_manage_fulfillment_box(box_id)
    and exists (
      select 1 from public.fulfillment_boxes box
      where box.id = fulfillment_box_items.box_id
        and box.account_id = fulfillment_box_items.account_id
    )
  );
drop policy if exists "batch_consumables_pipeline_partner_select" on public.batch_consumables;
drop policy if exists "batch_consumables_pipeline_partner_manage" on public.batch_consumables;
create policy "batch_consumables_pipeline_partner_select" on public.batch_consumables for select using (public._is_batch_partner(batch_id));
create policy "batch_consumables_pipeline_partner_manage" on public.batch_consumables for all
  using (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id))
  with check (pipeline_stage_id is not null and public.is_pipeline_stage_executor(pipeline_stage_id));

grant select on public.fulfillment_reception_history, public.fulfillment_stage_stock to authenticated;
grant execute on function public.advance_batch_pipeline_step(uuid) to authenticated;
grant execute on function public.complete_batch_pipeline_stage(uuid) to authenticated;
grant execute on function public.can_manage_fulfillment_supply(uuid) to authenticated;
grant execute on function public.can_manage_fulfillment_box(uuid) to authenticated;

-- Короб принадлежит владельцу партии, но наполнять его вправе исполнитель стадии.
create or replace function public.increment_fulfillment_box_item(
  p_box_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_product_name text,
  p_qty integer
)
returns public.fulfillment_box_items
language plpgsql security definer
set search_path = public
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_result public.fulfillment_box_items%rowtype;
  v_barcode text := trim(p_barcode);
begin
  if v_barcode = '' then raise exception 'Баркод не указан'; end if;
  if p_qty < 1 then raise exception 'Количество должно быть не меньше 1'; end if;

  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if not found then raise exception 'Короб не найден'; end if;
  if not public.can_manage_fulfillment_box(v_box.id) then raise exception 'Нет доступа к коробу'; end if;

  insert into public.fulfillment_box_items (
    box_id, account_id, barcode, item_id, product_name, qty
  ) values (
    v_box.id, v_box.account_id, v_barcode, p_item_id, p_product_name, p_qty
  )
  on conflict (box_id, barcode) do update
  set qty = fulfillment_box_items.qty + excluded.qty,
      item_id = coalesce(fulfillment_box_items.item_id, excluded.item_id),
      product_name = coalesce(fulfillment_box_items.product_name, excluded.product_name)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.increment_fulfillment_box_item(uuid, text, uuid, text, integer) from public;
grant execute on function public.increment_fulfillment_box_item(uuid, text, uuid, text, integer) to authenticated;

create or replace function public.get_pipeline_stage_outgoing_discrepancies(p_stage_id uuid)
returns table (
  lineage_id uuid,
  barcode text,
  product_name text,
  sent_good integer,
  next_good integer,
  next_defect integer,
  difference integer
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_stage public.batch_pipeline_stages%rowtype;
  v_next public.batch_pipeline_stages%rowtype;
begin
  select * into v_stage from public.batch_pipeline_stages where id = p_stage_id;
  if v_stage.id is null then return; end if;
  if not exists (
    select 1 from public.account_members member
    where member.user_id = auth.uid()
      and member.account_id in (v_stage.owner_account_id, coalesce(v_stage.partner_account_id, v_stage.owner_account_id))
  ) then
    raise exception 'Нет доступа';
  end if;

  select * into v_next
  from public.batch_pipeline_stages stage
  where stage.batch_id = v_stage.batch_id and stage.order_index > v_stage.order_index
  order by stage.order_index
  limit 1;
  if v_next.id is null or v_next.current_stage = 'reception' then return; end if;

  return query
  select
    current_item.lineage_id,
    current_item.barcode,
    current_item.product_name,
    current_item.qty_received,
    coalesce(next_item.qty_received, 0),
    coalesce(next_item.qty_defect, 0),
    current_item.qty_received - (coalesce(next_item.qty_received, 0) + coalesce(next_item.qty_defect, 0))
  from public.fulfillment_items current_item
  left join public.fulfillment_items next_item
    on next_item.pipeline_stage_id = v_next.id
   and next_item.lineage_id = current_item.lineage_id
   and not next_item.is_excluded
  where current_item.pipeline_stage_id = v_stage.id
    and not current_item.is_excluded
    and current_item.qty_received <> (coalesce(next_item.qty_received, 0) + coalesce(next_item.qty_defect, 0));
end;
$$;

grant execute on function public.get_pipeline_stage_outgoing_discrepancies(uuid) to authenticated;

-- FBS receives stock only from completed reception. Legacy batches contribute
-- good + defect after the whole batch is done. Pipeline batches contribute the
-- stage stock that is still active for the selected owner/store.
create or replace function public.get_fbs_calculated_stock(
  p_account_id uuid,
  p_store_id uuid
)
returns table (
  barcode text,
  received_quantity bigint,
  active_order_quantity bigint,
  dispatched_quantity bigint,
  calculated_quantity bigint
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.account_members member
    where member.account_id = p_account_id and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к остаткам этой компании';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит выбранной компании';
  end if;

  return query
  with legacy_received as (
    select item.barcode, sum(item.qty_received + item.qty_defect)::bigint as quantity
    from public.fulfillment_items item
    join public.fulfillment_batches batch on batch.id = item.batch_id
    where batch.account_id = p_account_id
      and batch.store_id = p_store_id
      and batch.status = 'done'
      and batch.deleted_at is null
      and item.pipeline_stage_id is null
      and not item.is_excluded
    group by item.barcode
  ),
  pipeline_received as (
    select stock.barcode, sum(stock.quantity)::bigint as quantity
    from public.fulfillment_stage_stock stock
    join public.fulfillment_batches batch on batch.id = stock.batch_id
    where stock.account_id = p_account_id
      and batch.store_id = p_store_id
      and stock.status = 'active'
    group by stock.barcode
  ),
  received_by_barcode as (
    select source.barcode, sum(source.quantity)::bigint as quantity
    from (
      select * from legacy_received
      union all
      select * from pipeline_received
    ) source
    group by source.barcode
  ),
  active_orders_by_barcode as (
    select first_sku.barcode, count(*)::bigint as quantity
    from public.fbs_orders order_row
    cross join lateral (
      select sku.value as barcode
      from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) with ordinality sku(value, position)
      order by sku.position limit 1
    ) first_sku
    where order_row.account_id = p_account_id
      and order_row.store_id = p_store_id
      and order_row.is_in_latest_snapshot = true
      and order_row.supplier_status in ('new', 'confirm')
      and order_row.wb_system_status = 'waiting'
      and not exists (
        select 1 from public.fbs_dispatch_events dispatch_event
        where dispatch_event.store_id = order_row.store_id
          and dispatch_event.wb_order_id = order_row.wb_order_id
      )
    group by first_sku.barcode
  ),
  dispatched_by_barcode as (
    select event.product_barcode as barcode, sum(event.quantity)::bigint as quantity
    from public.fbs_dispatch_events event
    where event.account_id = p_account_id
      and event.store_id = p_store_id
      and event.product_barcode <> ''
    group by event.product_barcode
  ),
  all_barcodes as (
    select value.barcode from received_by_barcode value
    union select value.barcode from active_orders_by_barcode value
    union select value.barcode from dispatched_by_barcode value
  )
  select value.barcode,
    coalesce(received.quantity, 0)::bigint,
    coalesce(active_order.quantity, 0)::bigint,
    coalesce(dispatched.quantity, 0)::bigint,
    (coalesce(received.quantity, 0) - coalesce(active_order.quantity, 0) - coalesce(dispatched.quantity, 0))::bigint
  from all_barcodes value
  left join received_by_barcode received on received.barcode = value.barcode
  left join active_orders_by_barcode active_order on active_order.barcode = value.barcode
  left join dispatched_by_barcode dispatched on dispatched.barcode = value.barcode
  order by value.barcode;
end;
$$;

revoke all on function public.get_fbs_calculated_stock(uuid, uuid) from public, anon;
grant execute on function public.get_fbs_calculated_stock(uuid, uuid) to authenticated;

create or replace function public.sync_ready_box_supply(p_item_id uuid, p_target_count integer)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_item public.fulfillment_items%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_supply_id uuid;
  v_owner uuid;
  v_blocked_numbers text;
begin
  if p_target_count < 1 then raise exception 'Количество готовых коробов должно быть не меньше 1'; end if;
  select * into v_item from public.fulfillment_items where id=p_item_id for update;
  if not found or v_item.product_name is distinct from 'Готовые короба' then raise exception 'Позиция готовых коробов не найдена'; end if;
  select * into v_batch from public.fulfillment_batches where id=v_item.batch_id;
  v_owner:=v_batch.account_id;
  if v_item.pipeline_stage_id is not null then
    if not public.is_pipeline_stage_executor(v_item.pipeline_stage_id) then raise exception 'Нет доступа к стадии'; end if;
  else
    if not exists(select 1 from public.account_members member where member.account_id=v_owner and member.user_id=auth.uid()) then raise exception 'Нет доступа к партии'; end if;
  end if;

  select supply.id into v_supply_id from public.fulfillment_supplies supply where supply.source_item_id=v_item.id limit 1;
  if v_supply_id is null then
    select supply.id into v_supply_id from public.fulfillment_supplies supply
    where supply.batch_id=v_item.batch_id and supply.warehouse_name=coalesce(v_item.notes,'') and supply.source_item_id is null
      and supply.pipeline_stage_id is not distinct from v_item.pipeline_stage_id
    order by supply.created_at,supply.id limit 1 for update skip locked;
    if v_supply_id is null then
      perform set_config('app.pipeline_internal','on',true);
      insert into public.fulfillment_supplies(batch_id,account_id,pipeline_stage_id,warehouse_id,warehouse_name,trip_id,trip_line_id,created_by,source_item_id)
      values (
        v_item.batch_id,v_owner,v_item.pipeline_stage_id,
        (select warehouse.id from public.warehouses warehouse where warehouse.name=coalesce(v_item.notes,'') and (warehouse.account_id=v_owner or warehouse.account_id is null) order by (warehouse.account_id=v_owner) desc limit 1),
        coalesce(v_item.notes,''),null,null,auth.uid(),v_item.id
      ) returning id into v_supply_id;
      perform set_config('app.pipeline_internal','off',true);
    else
      update public.fulfillment_supplies set source_item_id=v_item.id where id=v_supply_id;
    end if;
  end if;

  select string_agg('BOX'||box.box_number::text,', ' order by box.box_number) into v_blocked_numbers
  from public.fulfillment_boxes box where box.supply_id=v_supply_id and box.box_number>p_target_count
    and exists(select 1 from public.fulfillment_box_items box_item where box_item.box_id=box.id);
  if v_blocked_numbers is not null then raise exception 'Нельзя уменьшить количество. Содержат товары: %',v_blocked_numbers; end if;
  delete from public.fulfillment_boxes box where box.supply_id=v_supply_id and box.box_number>p_target_count;
  insert into public.fulfillment_boxes(supply_id,account_id,box_number,status)
  select v_supply_id,v_owner,number_value,'open' from generate_series(1,p_target_count) number_value
  on conflict(supply_id,box_number) do nothing;
  update public.fulfillment_items set boxes=p_target_count where id=v_item.id;
  return v_supply_id;
end;
$$;

revoke all on function public.sync_ready_box_supply(uuid, integer) from public;
grant execute on function public.sync_ready_box_supply(uuid, integer) to authenticated;
