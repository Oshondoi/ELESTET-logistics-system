-- Таблица кастомных ролей (доступов) per company
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  permissions jsonb not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, name)
);

create index if not exists roles_account_id_idx on public.roles (account_id);

alter table public.roles enable row level security;

-- Просмотр: любой участник компании
create policy "members can view roles"
  on public.roles for select
  using (
    exists (
      select 1 from public.account_members
      where account_members.account_id = roles.account_id
        and account_members.user_id = auth.uid()
    )
  );

-- Создание/изменение/удаление: только owner и admin
create policy "owners and admins can manage roles"
  on public.roles for all
  using (
    exists (
      select 1 from public.account_members
      where account_members.account_id = roles.account_id
        and account_members.user_id = auth.uid()
        and account_members.role in ('owner', 'admin')
    )
  );
