-- Тарифы работ фулфилмента (ОТК, Маркировка, Упаковка и др.)
create table if not exists public.fulfillment_work_tariffs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  stage text not null check (stage in ('otk', 'marking', 'packing', 'other')),
  name text not null,
  price_per_unit numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.fulfillment_work_tariffs enable row level security;

drop policy if exists "work_tariffs_member" on public.fulfillment_work_tariffs;
create policy "work_tariffs_member"
  on public.fulfillment_work_tariffs for all
  using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );
