-- TEMP DEV ACCESS
-- Run this only for current development if you want the browser app to work
-- without Supabase Auth yet. This opens browser-side access for the known account.

create policy "dev_public_read_stores"
on public.stores
for select
using (account_id = '11111111-1111-1111-1111-111111111111');

create policy "dev_public_write_stores"
on public.stores
for insert
with check (account_id = '11111111-1111-1111-1111-111111111111');

create policy "dev_public_read_shipments"
on public.shipments
for select
using (account_id = '11111111-1111-1111-1111-111111111111');

create policy "dev_public_write_shipments"
on public.shipments
for insert
with check (account_id = '11111111-1111-1111-1111-111111111111');

create policy "dev_public_read_history"
on public.shipment_status_history
for select
using (
  exists (
    select 1
    from public.shipments s
    where s.id = shipment_status_history.shipment_id
      and s.account_id = '11111111-1111-1111-1111-111111111111'
  )
);

grant execute on function public.create_shipment(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  date,
  date,
  text,
  text,
  text
) to anon, authenticated;
