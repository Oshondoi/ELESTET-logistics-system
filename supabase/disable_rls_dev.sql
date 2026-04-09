-- DEV ONLY
-- Temporary fix for local browser development without Supabase Auth.
-- This disables RLS on current working tables so the frontend can talk
-- directly to Supabase with the anon key.

alter table public.accounts disable row level security;
alter table public.account_members disable row level security;
alter table public.stores disable row level security;
alter table public.shipments disable row level security;
alter table public.shipment_status_history disable row level security;
