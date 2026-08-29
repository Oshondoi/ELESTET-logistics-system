-- Передача логистической поставки подтверждённой компании-партнёру.
-- Склад намеренно не назначается отправителем и всегда хранится пустым.

alter table public.trip_lines
  add column if not exists transfer_to_account_id uuid
    references public.accounts(id) on delete set null,
  add column if not exists transfer_created_at timestamptz;

create index if not exists trip_lines_transfer_to_account_idx
  on public.trip_lines (transfer_to_account_id, transfer_created_at desc)
  where transfer_to_account_id is not null;

create or replace function public.enforce_trip_line_partner_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transfer_to_account_id is null then
    return new;
  end if;

  if new.transfer_to_account_id = new.account_id then
    raise exception 'Нельзя передать поставку своей компании';
  end if;

  if tg_op = 'INSERT'
     or old.transfer_to_account_id is distinct from new.transfer_to_account_id then
    if not exists (
      select 1
      from public.outsource_partners op
      where op.status = 'accepted'
        and (
          (op.requester_id = new.account_id and op.partner_id = new.transfer_to_account_id)
          or
          (op.partner_id = new.account_id and op.requester_id = new.transfer_to_account_id)
        )
    ) then
      raise exception 'Передача доступна только подтверждённому партнёру';
    end if;
  end if;

  new.destination_warehouse := '';
  new.transfer_created_at := coalesce(new.transfer_created_at, now());
  return new;
end;
$$;

drop trigger if exists trip_lines_enforce_partner_transfer on public.trip_lines;
create trigger trip_lines_enforce_partner_transfer
before insert or update on public.trip_lines
for each row execute function public.enforce_trip_line_partner_transfer();

drop function if exists public.add_partner_trip_line(
  uuid, uuid, uuid, uuid, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text
);

create function public.add_partner_trip_line(
  p_trip_id uuid,
  p_account_id uuid,
  p_store_id uuid,
  p_transfer_to_account_id uuid,
  p_box_qty integer default 0,
  p_units_qty integer default 0,
  p_units_total integer default 0,
  p_arrived_box_qty integer default 0,
  p_planned_marketplace_delivery_date date default null,
  p_arrival_date date default null,
  p_reception_date date default null,
  p_shipped_date date default null,
  p_weight numeric default null,
  p_status text default 'Формируется',
  p_payment_status text default 'Не оплачено',
  p_comment text default ''
)
returns public.trip_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_shipment_number integer;
  v_created_line public.trip_lines;
  v_sender_name text;
begin
  if not exists (
    select 1 from public.account_members am
    where am.account_id = p_account_id and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к компании-отправителю';
  end if;

  if not exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.account_id = p_account_id
  ) then
    raise exception 'Рейс не принадлежит компании-отправителю';
  end if;

  if not exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит компании-отправителю';
  end if;

  if not exists (
    select 1
    from public.outsource_partners op
    where op.status = 'accepted'
      and (
        (op.requester_id = p_account_id and op.partner_id = p_transfer_to_account_id)
        or
        (op.partner_id = p_account_id and op.requester_id = p_transfer_to_account_id)
      )
  ) then
    raise exception 'Получатель не является подтверждённым партнёром';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('supply-number:' || p_account_id::text, 0));

  select greatest(
    coalesce((select max(tl.shipment_number) from public.trip_lines tl where tl.account_id = p_account_id), 0),
    coalesce((select max(s.supply_number) from public.fulfillment_supplies s where s.account_id = p_account_id), 0),
    coalesce((select max(r.supply_number) from public.fulfillment_supply_number_registry r where r.account_id = p_account_id), 0)
  ) + 1 into v_next_shipment_number;

  insert into public.trip_lines (
    trip_id, account_id, store_id, shipment_number,
    destination_warehouse, transfer_to_account_id, transfer_created_at,
    box_qty, units_qty, units_total, arrived_box_qty,
    planned_marketplace_delivery_date, arrival_date, reception_date,
    shipped_date, weight, status, payment_status, comment
  ) values (
    p_trip_id, p_account_id, p_store_id, v_next_shipment_number,
    '', p_transfer_to_account_id, now(),
    greatest(coalesce(p_box_qty, 0), 0),
    greatest(coalesce(p_units_qty, 0), 0),
    greatest(coalesce(p_units_total, 0), 0),
    greatest(coalesce(p_arrived_box_qty, 0), 0),
    p_planned_marketplace_delivery_date, p_arrival_date, p_reception_date,
    p_shipped_date, p_weight, p_status, p_payment_status, coalesce(p_comment, '')
  )
  returning * into v_created_line;

  select a.name into v_sender_name from public.accounts a where a.id = p_account_id;
  insert into public.batch_notifications (account_id, type, title, body)
  values (
    p_transfer_to_account_id,
    'trip_line_transfer',
    'Вам передана поставка',
    coalesce(v_sender_name, 'Компания-партнёр') || ' передала поставку №' || v_next_shipment_number
  );

  return v_created_line;
end;
$$;

revoke all on function public.add_partner_trip_line(
  uuid, uuid, uuid, uuid, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text
) from public;
grant execute on function public.add_partner_trip_line(
  uuid, uuid, uuid, uuid, integer, integer, integer, integer,
  date, date, date, date, numeric, text, text, text
) to authenticated;

create or replace function public.get_incoming_trip_line_transfers(p_account_id uuid)
returns table (
  line_id uuid,
  sender_account_id uuid,
  sender_account_name text,
  sender_account_short_id integer,
  trip_id uuid,
  trip_label text,
  store_name text,
  store_code text,
  shipment_number integer,
  box_qty integer,
  units_qty integer,
  weight numeric,
  reception_date date,
  comment text,
  transfer_created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    tl.id,
    tl.account_id,
    a.name,
    a.short_id,
    t.id,
    case
      when t.trip_number is not null then 'Рейс ' || t.trip_number::text
      else 'Рейс без номера'
    end,
    s.name,
    s.store_code,
    tl.shipment_number,
    tl.box_qty,
    tl.units_qty,
    tl.weight,
    tl.reception_date,
    tl.comment,
    coalesce(tl.transfer_created_at, tl.created_at)
  from public.trip_lines tl
  join public.accounts a on a.id = tl.account_id
  join public.trips t on t.id = tl.trip_id
  join public.stores s on s.id = tl.store_id
  where tl.transfer_to_account_id = p_account_id
    and tl.deleted_at is null
    and exists (
      select 1 from public.account_members am
      where am.account_id = p_account_id and am.user_id = auth.uid()
    )
  order by coalesce(tl.transfer_created_at, tl.created_at) desc;
$$;

revoke all on function public.get_incoming_trip_line_transfers(uuid) from public;
grant execute on function public.get_incoming_trip_line_transfers(uuid) to authenticated;

