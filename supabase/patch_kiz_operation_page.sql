-- Один порядок операций магазина для всех пользователей.
-- База собирает список целиком и отдаёт только запрошенную страницу.
-- Документы идут по дате, сверху самые новые, как в Teksher.
-- Заказ, который относится к нанесению, стоит сразу под ним.
-- Остальные заказы остаются на своей дате.
-- Страница не режет нанесение и его заказ пополам.

create or replace function public.list_teksher_operations_page(
  p_store_id uuid,
  p_page integer default 0,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_block integer := 0;
  v_order text;
  v_n integer := 0;
  v_index integer := 0;
  v_take integer;
  v_pages integer;
  v_safe integer;
  v_offset integer;
  v_next integer;
  v_starts integer[] := '{}';
  v_items jsonb;
  m record;
  o record;
  s record;
begin
  create temp table _kiz_ops (
    operation_id text primary key,
    kind text not null,
    cnt integer,
    at_ts timestamptz not null,
    grp text not null,
    used boolean not null default false
  ) on commit drop;

  insert into _kiz_ops (operation_id, kind, cnt, at_ts, grp)
  select
    operation.operation_id,
    case
      when upper(case when operation.operation_type is null then coalesce(operation.type, '') else operation.operation_type end) in ('MARK_CODE_ORDER', 'EMISSION') then 'order'
      when upper(case when operation.operation_type is null then coalesce(operation.type, '') else operation.operation_type end) in ('MARKING', 'UTILISATION') then 'marking'
      else 'other'
    end,
    coalesce(operation.kms_count, operation.codes_count),
    coalesce(operation.created_at_teksher, operation.created_date, 'epoch'::timestamptz),
    btrim(coalesce(operation.product_group_code, ''))
  from public.teksher_operations operation
  where operation.store_id = p_store_id
    and operation.operation_id is not null
    and btrim(operation.operation_id) <> '';

  update _kiz_ops set kind = 'other' where cnt is null and kind <> 'other';

  create index _kiz_ops_free_order_idx
    on _kiz_ops (cnt, at_ts desc, operation_id desc)
    where kind = 'order' and not used;
  analyze _kiz_ops;

  create temp table _kiz_blocks (
    block_id integer primary key,
    at_ts timestamptz not null,
    cnt integer,
    head_id text not null,
    has_marking boolean not null,
    grp text not null
  ) on commit drop;

  create temp table _kiz_block_rows (
    block_id integer not null,
    pos integer not null,
    operation_id text not null,
    primary key (block_id, pos)
  ) on commit drop;

  for m in
    select operation_id, cnt, at_ts, grp
    from _kiz_ops
    where kind = 'marking'
    order by at_ts asc, operation_id asc
  loop
    v_order := null;
    select free.operation_id into v_order
    from _kiz_ops free
    where free.kind = 'order'
      and not free.used
      and free.cnt = m.cnt
      and free.at_ts <= m.at_ts
      and (free.grp = '' or m.grp = '' or free.grp = m.grp)
    order by free.at_ts desc, free.operation_id desc
    limit 1;

    v_block := v_block + 1;
    insert into _kiz_blocks (block_id, at_ts, cnt, head_id, has_marking, grp)
    values (v_block, m.at_ts, m.cnt, m.operation_id, true, m.grp);
    insert into _kiz_block_rows (block_id, pos, operation_id)
    values (v_block, 0, m.operation_id);

    if v_order is not null then
      update _kiz_ops set used = true where operation_id = v_order;
      insert into _kiz_block_rows (block_id, pos, operation_id)
      values (v_block, 1, v_order);
    end if;
  end loop;

  for o in
    select operation_id, cnt, at_ts, grp
    from _kiz_ops
    where kind = 'order' and not used
    order by at_ts desc, operation_id asc
  loop
    v_block := v_block + 1;
    insert into _kiz_blocks (block_id, at_ts, cnt, head_id, has_marking, grp)
    values (v_block, o.at_ts, o.cnt, o.operation_id, false, o.grp);
    insert into _kiz_block_rows (block_id, pos, operation_id)
    values (v_block, 0, o.operation_id);
  end loop;

  for s in
    select operation_id, cnt, at_ts, grp
    from _kiz_ops
    where kind = 'other'
    order by at_ts asc, operation_id asc
  loop
    v_block := v_block + 1;
    insert into _kiz_blocks (block_id, at_ts, cnt, head_id, has_marking, grp)
    values (v_block, s.at_ts, s.cnt, s.operation_id, false, s.grp);
    insert into _kiz_block_rows (block_id, pos, operation_id)
    values (v_block, 0, s.operation_id);
  end loop;

  create temp table _kiz_final (
    seq integer primary key,
    operation_id text not null,
    kind text not null,
    cnt integer,
    grp text not null
  ) on commit drop;

  insert into _kiz_final (seq, operation_id, kind, cnt, grp)
  select
    row_number() over (order by block.at_ts desc, block.head_id asc, line.pos asc) - 1,
    line.operation_id,
    operation.kind,
    operation.cnt,
    operation.grp
  from _kiz_blocks block
  join _kiz_block_rows line on line.block_id = block.block_id
  join _kiz_ops operation on operation.operation_id = line.operation_id;

  select count(*) into v_n from _kiz_final;

  if v_n = 0 then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'pages', 1, 'offset', 0);
  end if;

  while v_index < v_n loop
    v_starts := v_starts || v_index;
    v_take := least(v_page_size, v_n - v_index);
    while v_index + v_take < v_n and exists (
      select 1
      from _kiz_final left_row
      join _kiz_final right_row on right_row.seq = left_row.seq + 1
      where left_row.seq = v_index + v_take - 1
        and left_row.cnt is not null
        and left_row.cnt = right_row.cnt
        and (
          (left_row.kind = 'marking' and right_row.kind = 'order')
          or (left_row.kind = 'order' and right_row.kind = 'order')
        )
        and (left_row.grp = '' or right_row.grp = '' or left_row.grp = right_row.grp)
    ) loop
      v_take := v_take + 1;
    end loop;
    v_index := v_index + greatest(v_take, 1);
  end loop;

  v_pages := coalesce(array_length(v_starts, 1), 1);
  v_safe := least(greatest(coalesce(p_page, 0), 0), v_pages - 1);
  v_offset := v_starts[v_safe + 1];
  v_next := case when v_safe + 1 < v_pages then v_starts[v_safe + 2] else v_n end;

  select coalesce(jsonb_agg(row_data.item order by row_data.seq), '[]'::jsonb)
  into v_items
  from (
    select
      final_row.seq,
      jsonb_build_object(
        'operation_id', operation.operation_id,
        'operation_type', operation.operation_type,
        'type', operation.type,
        'status', operation.status,
        'kms_count', operation.kms_count,
        'codes_count', operation.codes_count,
        'gtin', operation.gtin,
        'created_at_teksher', operation.created_at_teksher,
        'created_date', operation.created_date,
        'product_group_code', operation.product_group_code,
        'product', operation.product
      ) as item
    from _kiz_final final_row
    join public.teksher_operations operation
      on operation.store_id = p_store_id
     and operation.operation_id = final_row.operation_id
    where final_row.seq >= v_offset
      and final_row.seq < v_next
  ) row_data;

  return jsonb_build_object(
    'items', v_items,
    'total', v_n,
    'pages', v_pages,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.list_teksher_operations_page(uuid, integer, integer) from public, anon;
grant execute on function public.list_teksher_operations_page(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
