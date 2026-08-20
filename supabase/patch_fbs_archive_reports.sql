-- Локальные отчёты архива FBS. Сам XLSX собирается в браузере из сохранённого
-- снимка заказов; запись фиксирует период и точный состав отчёта на 7 дней.
create table if not exists public.fbs_archive_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  rows_count integer not null default 0 check (rows_count >= 0),
  order_ids text[] not null default '{}',
  status text not null default 'ready' check (status in ('ready', 'failed')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (period_from <= period_to)
);

alter table public.fbs_archive_reports enable row level security;

drop policy if exists "fbs_archive_reports: account members" on public.fbs_archive_reports;
create policy "fbs_archive_reports: account members"
  on public.fbs_archive_reports
  for all
  using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  )
  with check (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
    and exists (
      select 1 from public.stores
      where stores.id = fbs_archive_reports.store_id
        and stores.account_id = fbs_archive_reports.account_id
    )
  );

create index if not exists fbs_archive_reports_store_created
  on public.fbs_archive_reports(store_id, created_at desc);

create index if not exists fbs_archive_reports_expires
  on public.fbs_archive_reports(expires_at);

create or replace function public.enforce_fbs_archive_report_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.fbs_archive_reports
  where store_id = new.store_id and expires_at <= now();

  if (
    select count(*) from public.fbs_archive_reports
    where store_id = new.store_id and expires_at > now()
  ) >= 100 then
    raise exception 'Достигнут лимит: 100 архивных отчётов на магазин';
  end if;
  return new;
end;
$$;

drop trigger if exists fbs_archive_reports_limit on public.fbs_archive_reports;
create trigger fbs_archive_reports_limit
before insert on public.fbs_archive_reports
for each row execute function public.enforce_fbs_archive_report_limit();

grant select, insert, update, delete on public.fbs_archive_reports to authenticated;
