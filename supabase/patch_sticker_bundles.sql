-- ── Наборы стикеров ──────────────────────────────────────────────
-- Каждый набор — список выбранных sticker_templates с их кол-вом копий.
-- items — jsonb массив: [{ sticker_id: uuid, copies: int }, ...]

create table if not exists public.sticker_bundles (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name       text not null,
  items      jsonb not null default '[]',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists sticker_bundles_account_id_idx
  on public.sticker_bundles (account_id);

alter table public.sticker_bundles enable row level security;

drop policy if exists "members_can_view_bundles" on public.sticker_bundles;
create policy "members_can_view_bundles"
on public.sticker_bundles
for select
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_bundles.account_id
      and am.user_id = auth.uid()
  )
);

drop policy if exists "members_manage_bundles" on public.sticker_bundles;
create policy "members_manage_bundles"
on public.sticker_bundles
for all
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_bundles.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_bundles.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);
