-- ─── Дневник ELESTET ───────────────────────────────────────────────────────
-- Таблица для личных дневниковых записей владельца аккаунта
-- Запускать: psql / Supabase SQL Editor

create table if not exists public.diary_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  day_summary   text not null default '',
  tasks_done    text[] not null default '{}',
  tasks_tomorrow text[] not null default '{}',
  media_urls    text[] not null default '{}',
  ai_review     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, date)
);

-- Обновление updated_at при изменении строки
create or replace function public.set_diary_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists diary_entries_updated_at on public.diary_entries;
create trigger diary_entries_updated_at
  before update on public.diary_entries
  for each row execute function public.set_diary_updated_at();

-- RLS — только владелец видит и редактирует свои записи
alter table public.diary_entries enable row level security;

drop policy if exists "diary_entries_owner_all" on public.diary_entries;
create policy "diary_entries_owner_all"
  on public.diary_entries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Storage bucket для медиа дневника ────────────────────────────────────
-- Создать bucket 'diary-media' в Supabase Dashboard → Storage → New bucket
-- Или через SQL:
insert into storage.buckets (id, name, public)
values ('diary-media', 'diary-media', false)
on conflict (id) do nothing;

-- Политики для bucket diary-media
drop policy if exists "diary_media_owner_upload" on storage.objects;
create policy "diary_media_owner_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'diary-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "diary_media_owner_select" on storage.objects;
create policy "diary_media_owner_select"
  on storage.objects for select
  using (
    bucket_id = 'diary-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "diary_media_owner_delete" on storage.objects;
create policy "diary_media_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'diary-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
