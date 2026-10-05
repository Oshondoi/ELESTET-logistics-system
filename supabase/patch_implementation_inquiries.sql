begin;
create table if not exists public.implementation_inquiries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  user_id uuid not null default auth.uid() references auth.users(id),
  description text not null check (length(btrim(description)) between 10 and 10000),
  created_at timestamptz not null default now()
);
alter table public.implementation_inquiries enable row level security;
revoke all on public.implementation_inquiries from public, anon, authenticated;
grant select, insert on public.implementation_inquiries to authenticated;
drop policy if exists implementation_inquiries_submit on public.implementation_inquiries;
create policy implementation_inquiries_submit on public.implementation_inquiries for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.account_members m join public.accounts a on a.id = m.account_id
    where m.user_id = auth.uid() and m.account_id = implementation_inquiries.account_id and a.deleted_at is null
  )
);
drop policy if exists implementation_inquiries_read on public.implementation_inquiries;
create policy implementation_inquiries_read on public.implementation_inquiries for select to authenticated using (
  (user_id = auth.uid() and exists(select 1 from public.account_members m where m.account_id = implementation_inquiries.account_id and m.user_id = auth.uid()))
  or exists(select 1 from public.profiles p where p.user_id = auth.uid() and p.platform_role = 'superadmin')
);
notify pgrst, 'reload schema';
commit;
