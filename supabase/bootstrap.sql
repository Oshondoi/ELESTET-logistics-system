-- Run this after schema.sql if you want a first local working account without auth yet.
-- Replace the UUID below if you want another account id, then copy it into VITE_DEFAULT_ACCOUNT_ID.

insert into public.accounts (id, name)
values ('11111111-1111-1111-1111-111111111111', 'ELESTET Logistics')
on conflict (id) do nothing;
