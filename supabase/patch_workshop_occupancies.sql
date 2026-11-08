-- Занятость цеха на странице «Календарь».
-- Одна строка принадлежит одной компании. Чужая компания её не видит и не пишет.
-- Удаление мягкое: deleted_at. Физическая строка и её id остаются.

create table if not exists public.workshop_occupancies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  title text not null,
  plan_start date not null,
  plan_end date not null,
  fact_start date,
  fact_end date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint workshop_occupancies_title_not_blank check (length(btrim(title)) > 0),
  constraint workshop_occupancies_plan_range check (plan_end >= plan_start),
  constraint workshop_occupancies_fact_pair check (
    (fact_start is null and fact_end is null)
    or (fact_start is not null and fact_end is not null and fact_end >= fact_start)
  )
);

create index if not exists workshop_occupancies_account_plan_idx
  on public.workshop_occupancies (account_id, plan_start)
  where deleted_at is null;

create or replace function public.protect_workshop_occupancy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := timezone('utc', now());
  else
    new.account_id := old.account_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.deleted_at is not null then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  new.title := btrim(new.title);
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists workshop_occupancies_protect on public.workshop_occupancies;
create trigger workshop_occupancies_protect
  before insert or update on public.workshop_occupancies
  for each row execute function public.protect_workshop_occupancy();

alter table public.workshop_occupancies enable row level security;

drop policy if exists "company members read workshop occupancies" on public.workshop_occupancies;
create policy "company members read workshop occupancies"
  on public.workshop_occupancies for select
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = workshop_occupancies.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "company members insert workshop occupancies" on public.workshop_occupancies;
create policy "company members insert workshop occupancies"
  on public.workshop_occupancies for insert
  with check (
    exists (
      select 1 from public.account_members am
      where am.account_id = workshop_occupancies.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "company members update workshop occupancies" on public.workshop_occupancies;
create policy "company members update workshop occupancies"
  on public.workshop_occupancies for update
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = workshop_occupancies.account_id
        and am.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.account_members am
      where am.account_id = workshop_occupancies.account_id
        and am.user_id = auth.uid()
    )
  );

revoke all on public.workshop_occupancies from public, anon;
grant select, insert, update on public.workshop_occupancies to authenticated;
