-- Добавляем дополнительные поля к таблице перевозчиков
alter table public.carriers
  add column if not exists phone          text,
  add column if not exists contact_person text,
  add column if not exists notes          text,
  add column if not exists owner_user_id  uuid references auth.users(id) on delete set null;
