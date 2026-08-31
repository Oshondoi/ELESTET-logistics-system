-- Separate client-declared quantity from warehouse-received quantity.
-- Existing rows are copied to both fields to preserve historical data.
alter table public.fulfillment_items
  add column if not exists qty_declared integer not null default 0;

update public.fulfillment_items
set qty_declared = qty_received
where qty_declared = 0
  and qty_received <> 0;

comment on column public.fulfillment_items.qty_declared is
  'Quantity declared by the client before physical warehouse reception';

comment on column public.fulfillment_items.qty_received is
  'Quantity physically received and counted by the warehouse';
