-- Excel import for fulfillment box contents.
-- Only explicitly listed box numbers are replaced; missing box numbers are created.
-- Active KIZ links are archived with an immutable audit event before replacement.

begin;

create or replace function public.replace_fulfillment_box_contents_from_excel(
  p_supply_id uuid,
  p_rows jsonb,
  p_filename text default null,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_box public.fulfillment_boxes%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_old_pair jsonb;
  v_box_number integer;
  v_reserved_box integer;
  v_reserved_order text;
  v_affected_boxes integer := 0;
  v_created_boxes integer := 0;
  v_archived_kiz integer := 0;
  v_total_positions integer := 0;
  v_total_units bigint := 0;
  v_reason text;
  v_has_content boolean;
  v_box_existed boolean;
  v_old_positions integer;
  v_old_units integer;
  v_new_positions integer;
  v_new_units integer;
  v_box_action text;
  v_box_results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'В Excel нет заполненных строк для загрузки';
  end if;

  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена'; end if;

  perform public.fulfillment_kiz_assert_editable(v_supply.id);

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
    where imported.box_number is null or imported.box_number < 1 or imported.box_number > 2147483647
       or not (
         (coalesce(imported.barcode, '') = '' and coalesce(imported.qty, 0) = 0)
         or (
           coalesce(imported.barcode, '') ~ '^[0-9]{13}$'
           and imported.qty is not null and imported.qty between 1 and 2147483647
         )
       )
  ) then
    raise exception 'Excel содержит некорректный баркод, количество или номер короба';
  end if;

  if exists (
    select 1
    from (
      select imported.box_number, imported.barcode, sum(imported.qty) as qty
      from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
      where coalesce(imported.barcode, '') <> ''
      group by imported.box_number, imported.barcode
    ) grouped
    where grouped.qty > 2147483647
  ) then
    raise exception 'Суммарное количество одного товара в коробе превышает допустимое значение';
  end if;

  -- A source item referenced by an active FBS order is immutable until that
  -- order is released or completed; deleting it would break the stock audit.
  select box.box_number, allocation.wb_order_id
  into v_reserved_box, v_reserved_order
  from public.fulfillment_boxes box
  join public.fulfillment_box_items item on item.box_id = box.id
  join public.fbs_stock_allocations allocation on allocation.box_item_id = item.id
  where box.supply_id = v_supply.id
    and allocation.status in ('reserved', 'awaiting_wb')
    and box.box_number in (
      select distinct imported.box_number::integer
      from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
      where coalesce(imported.barcode, '') <> '' and imported.qty > 0
    )
  order by box.box_number
  limit 1;
  if v_reserved_box is not null then
    raise exception 'Короб №% нельзя заменить: его товар связан с активным FBS-заказом №%', v_reserved_box, v_reserved_order;
  end if;

  -- Serialize imports and ordinary box edits for every affected existing box.
  perform 1
  from public.fulfillment_boxes box
  where box.supply_id = v_supply.id
    and box.box_number in (
      select distinct imported.box_number::integer
      from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
    )
  order by box.box_number
  for update;

  select count(distinct imported.box_number)::integer,
         (count(distinct (imported.box_number, imported.barcode)) filter (where coalesce(imported.barcode, '') <> ''))::integer,
         coalesce(sum(imported.qty) filter (where coalesce(imported.barcode, '') <> ''), 0)::bigint
  into v_affected_boxes, v_total_positions, v_total_units
  from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint);

  for v_box_number in
    select distinct imported.box_number::integer
    from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
    order by imported.box_number::integer
  loop
    select exists (
      select 1
      from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
      where imported.box_number = v_box_number
        and coalesce(imported.barcode, '') <> ''
        and imported.qty > 0
    ) into v_has_content;

    select * into v_box
    from public.fulfillment_boxes
    where supply_id = v_supply.id and box_number = v_box_number
    for update;
    v_box_existed := found;

    if v_box_existed then
      select count(*)::integer, coalesce(sum(item.qty), 0)::integer
      into v_old_positions, v_old_units
      from public.fulfillment_box_items item
      where item.box_id = v_box.id;
    else
      v_old_positions := 0;
      v_old_units := 0;
      insert into public.fulfillment_boxes(supply_id, account_id, box_number, status)
      values (v_supply.id, v_supply.account_id, v_box_number, 'open')
      returning * into v_box;
      v_created_boxes := v_created_boxes + 1;
    end if;

    -- A box-number-only row creates a missing empty box, but never clears an
    -- existing box or touches its KIZ history.
    if not v_has_content then
      v_box_action := case when v_box_existed then 'unchanged' else 'create_empty' end;
      v_new_positions := v_old_positions;
      v_new_units := v_old_units;
      v_box_results := v_box_results || jsonb_build_array(jsonb_build_object(
        'box_number', v_box_number,
        'action', v_box_action,
        'old_positions', v_old_positions,
        'old_units', v_old_units,
        'new_positions', v_new_positions,
        'new_units', v_new_units
      ));
      continue;
    end if;

    for v_pair in
      select *
      from public.fulfillment_kiz_pairs pair
      where pair.box_id = v_box.id and pair.status in ('draft', 'committed')
      order by pair.created_at
      for update
    loop
      v_old_pair := to_jsonb(v_pair);
      update public.fulfillment_kiz_pairs
      set status = 'replaced',
          deleted_at = now(),
          updated_at = now(),
          actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
          actor_email = nullif(left(coalesce(p_actor_email, actor_email, ''), 320), '')
      where id = v_pair.id
      returning * into v_pair;

      v_reason := format(
        'КИЗ заменён из-за Excel-замены данных короба №%s%s',
        v_box.box_number,
        case when nullif(trim(coalesce(p_filename, '')), '') is null
          then '' else format(' (файл: %s)', left(trim(p_filename), 255)) end
      );
      perform public.fulfillment_kiz_event(
        v_pair, 'replaced', 'excel_import', v_reason,
        v_old_pair, to_jsonb(v_pair),
        p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
      );
      v_archived_kiz := v_archived_kiz + 1;
    end loop;

    delete from public.fulfillment_box_items item where item.box_id = v_box.id;

    insert into public.fulfillment_box_items(
      box_id, account_id, barcode, item_id, product_name, qty
    )
    select
      v_box.id,
      v_supply.account_id,
      imported.barcode,
      matched.id,
      matched.product_name,
      sum(imported.qty)::integer
    from jsonb_to_recordset(p_rows) as imported(barcode text, qty bigint, box_number bigint)
    left join lateral (
      select item.id, item.product_name
      from public.fulfillment_items item
      where item.batch_id = v_supply.batch_id
        and trim(item.barcode) = imported.barcode
        and coalesce(item.is_excluded, false) = false
      order by
        (v_supply.pipeline_stage_id is not null and item.pipeline_stage_id = v_supply.pipeline_stage_id) desc,
        item.created_at desc,
        item.id
      limit 1
    ) matched on true
    where imported.box_number = v_box_number
      and coalesce(imported.barcode, '') <> ''
      and imported.qty > 0
    group by imported.barcode, matched.id, matched.product_name;

    select count(*)::integer, coalesce(sum(item.qty), 0)::integer
    into v_new_positions, v_new_units
    from public.fulfillment_box_items item
    where item.box_id = v_box.id;
    v_box_action := case
      when not v_box_existed then 'create_filled'
      when v_old_positions = 0 then 'fill_first'
      else 'replace'
    end;
    v_box_results := v_box_results || jsonb_build_array(jsonb_build_object(
      'box_number', v_box_number,
      'action', v_box_action,
      'old_positions', v_old_positions,
      'old_units', v_old_units,
      'new_positions', v_new_positions,
      'new_units', v_new_units
    ));
  end loop;

  return jsonb_build_object(
    'affected_boxes', v_affected_boxes,
    'created_boxes', v_created_boxes,
    'archived_kiz', v_archived_kiz,
    'total_positions', v_total_positions,
    'total_units', v_total_units,
    'box_results', v_box_results
  );
end;
$$;

-- Committing a newly scanned KIZ normally creates/increments one physical unit.
-- If Excel already supplied an aggregate quantity, active KIZ pairs first fill
-- those existing units. This prevents a repeated scan from doubling stock.
create or replace function public.commit_fulfillment_kiz_box(
  p_box_id uuid,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_count integer := 0;
  v_committed_count integer;
  v_excel_rescan boolean;
  v_reason_code text;
  v_reason_text text;
begin
  select * into v_box from public.fulfillment_boxes where id = p_box_id for update;
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  perform public.fulfillment_kiz_assert_editable(v_box.supply_id);

  for v_pair in
    select * from public.fulfillment_kiz_pairs
    where box_id = p_box_id and status = 'draft'
    order by created_at for update
  loop
    select * into v_item
    from public.fulfillment_box_items item
    where item.box_id = v_box.id and item.barcode = v_pair.barcode
    for update;

    select count(*)::integer into v_committed_count
    from public.fulfillment_kiz_pairs pair
    where pair.box_id = v_box.id
      and pair.barcode = v_pair.barcode
      and pair.status = 'committed';

    if v_item.id is null then
      insert into public.fulfillment_box_items(box_id, account_id, barcode, item_id, product_name, qty)
      values (
        v_box.id, v_box.account_id, v_pair.barcode, v_pair.item_id,
        v_pair.product_snapshot->>'product_name', 1
      ) returning * into v_item;
    elsif v_item.qty <= v_committed_count then
      update public.fulfillment_box_items
      set qty = qty + 1,
          item_id = coalesce(item_id, v_pair.item_id),
          product_name = coalesce(product_name, v_pair.product_snapshot->>'product_name')
      where id = v_item.id
      returning * into v_item;
    else
      update public.fulfillment_box_items
      set item_id = coalesce(item_id, v_pair.item_id),
          product_name = coalesce(product_name, v_pair.product_snapshot->>'product_name')
      where id = v_item.id
      returning * into v_item;
    end if;

    update public.fulfillment_kiz_pairs set
      status = 'committed', box_item_id = v_item.id, committed_at = now(), updated_at = now(),
      actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
      actor_email = nullif(left(coalesce(p_actor_email, actor_email, ''), 320), ''),
      device_id = coalesce(nullif(p_device_id, ''), device_id),
      device_name = coalesce(nullif(p_device_name, ''), device_name),
      scanner_model = coalesce(nullif(p_scanner_model, ''), scanner_model)
    where id = v_pair.id returning * into v_pair;

    select exists (
      select 1
      from public.fulfillment_kiz_pairs previous
      join public.fulfillment_kiz_events event on event.pair_id = previous.id
      where previous.account_id = v_pair.account_id
        and previous.kiz_normalized = v_pair.kiz_normalized
        and previous.status = 'replaced'
        and event.reason_code = 'excel_import'
    ) into v_excel_rescan;

    if v_excel_rescan then
      v_reason_code := 'excel_rescan';
      v_reason_text := format(
        'Повторным сканом связана с товаром %s в коробе №%s',
        v_pair.barcode, v_box.box_number
      );
    else
      v_reason_code := 'box_commit';
      v_reason_text := 'Записана в короб';
    end if;

    perform public.fulfillment_kiz_event(
      v_pair, 'committed', v_reason_code, v_reason_text,
      jsonb_build_object('status', 'draft'), to_jsonb(v_pair),
      p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'В этом коробе нет незаписанных пар КИЗ'; end if;
  return jsonb_build_object(
    'committed_count', v_count,
    'items', coalesce((select jsonb_agg(item order by item.created_at) from public.fulfillment_box_items item where item.box_id = p_box_id), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(pair order by pair.created_at) from public.fulfillment_kiz_pairs pair where pair.box_id = p_box_id and pair.status in ('draft', 'committed')), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.replace_fulfillment_box_contents_from_excel(uuid,jsonb,text,text,text,text,text,text) from public, anon;
grant execute on function public.replace_fulfillment_box_contents_from_excel(uuid,jsonb,text,text,text,text,text,text) to authenticated;

revoke all on function public.commit_fulfillment_kiz_box(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.commit_fulfillment_kiz_box(uuid,text,text,text,text,text) to authenticated;

commit;
