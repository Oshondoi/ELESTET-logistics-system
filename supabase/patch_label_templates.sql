-- Named sticker sheets from the constructor, and the dry-clean care icon.
-- Safe to run again.

alter table public.sticker_templates
  add column if not exists icon_dry_clean boolean not null default false;

create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  size text not null check (size in ('58x40', '120x75')),
  mode text not null check (mode in ('barcode', 'kiz', 'combined')),
  blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint label_templates_account_name_unique unique (account_id, name),
  constraint label_templates_name_length check (char_length(btrim(name)) between 1 and 80)
);

create index if not exists label_templates_account_idx
  on public.label_templates (account_id, updated_at desc);

alter table public.label_templates enable row level security;

drop policy if exists label_templates_member_all on public.label_templates;
create policy label_templates_member_all
on public.label_templates
for all
to authenticated
using (exists (
  select 1 from public.account_members member
  where member.account_id = label_templates.account_id
    and member.user_id = auth.uid()
))
with check (exists (
  select 1 from public.account_members member
  where member.account_id = label_templates.account_id
    and member.user_id = auth.uid()
));

grant select, insert, update, delete on public.label_templates to authenticated;
grant all on public.label_templates to service_role;
