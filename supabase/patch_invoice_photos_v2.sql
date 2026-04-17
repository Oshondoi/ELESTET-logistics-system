-- =============================================================
-- Патч v2: invoice_photo_url (text) → invoice_photo_urls (text[])
-- =============================================================

-- 1. Добавляем новую колонку-массив
alter table public.trip_lines
  add column if not exists invoice_photo_urls text[] not null default '{}';

-- 2. Переносим существующие одиночные фото в массив
update public.trip_lines
  set invoice_photo_urls = array[invoice_photo_url]
  where invoice_photo_url is not null
    and invoice_photo_url != '';

-- 3. Удаляем старую колонку
alter table public.trip_lines
  drop column if exists invoice_photo_url;
