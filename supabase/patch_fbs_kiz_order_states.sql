-- Cache of the actual KIZ state reported by Wildberries.
-- The code itself is intentionally not stored here: only whether SGTIN is supported
-- for the order and whether WB reports it as filled.
create table if not exists public.fbs_kiz_order_states (
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id text not null,
  requires_kiz boolean not null default false,
  sent_to_wb boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key (store_id, order_id)
);

create index if not exists fbs_kiz_order_states_account
  on public.fbs_kiz_order_states(account_id, checked_at desc);

alter table public.fbs_kiz_order_states enable row level security;

drop policy if exists "fbs kiz states: account members read" on public.fbs_kiz_order_states;
create policy "fbs kiz states: account members read"
  on public.fbs_kiz_order_states for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_kiz_order_states.account_id
      and member.user_id = auth.uid()
  ));

do $$
begin
  alter publication supabase_realtime add table public.fbs_kiz_order_states;
exception
  when duplicate_object then null;
end $$;
