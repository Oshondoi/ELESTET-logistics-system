-- Добавляем subject_id в products
alter table public.products
  add column if not exists subject_id int;

-- Таблица предметов с их характеристиками (из /content/v2/object/charcs/{subjectId})
create table if not exists public.wb_subject_charcs (
  subject_id    int         not null,
  account_id    uuid        not null references public.accounts(id) on delete cascade,
  subject_name  text,
  parent_name   text,
  charcs        jsonb       not null default '[]',
  synced_at     timestamptz not null default now(),
  primary key (subject_id, account_id)
);

alter table public.wb_subject_charcs enable row level security;

-- Чтение — любой участник компании
create policy if not exists "wb_subject_charcs_select" on public.wb_subject_charcs
  for select using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

-- Запись — только service role (через Edge Function)
