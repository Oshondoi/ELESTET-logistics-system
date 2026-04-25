-- patch_review_templates.sql
-- Применить один раз в Supabase SQL Editor

create table if not exists review_templates (
  id            uuid        primary key default gen_random_uuid(),
  account_id    uuid        not null references accounts(id) on delete cascade,
  name          text        not null,
  text          text        not null,
  trigger_ratings  int[]   not null default '{}',
  trigger_keywords text[]  not null default '{}',
  is_auto       boolean     not null default false,
  sort_order    int         not null default 0,
  created_at    timestamptz not null default now()
);

alter table review_templates enable row level security;

-- Участники компании могут читать и изменять свои шаблоны
create policy "review_templates_account_member"
  on review_templates for all
  using (
    exists (
      select 1 from account_members
      where account_members.account_id = review_templates.account_id
        and account_members.user_id = auth.uid()
    )
  );
