-- =============================================================
-- Патч: добавить invoice_photo_url к trip_lines
-- + создать публичный bucket для хранения фото накладных
-- =============================================================

-- 1. Колонка в таблице
alter table public.trip_lines
  add column if not exists invoice_photo_url text;

-- 2. Storage bucket (публичный — чтобы можно было показывать фото без авторизации)
insert into storage.buckets (id, name, public)
values ('trip-invoices', 'trip-invoices', true)
on conflict (id) do nothing;

-- 3. RLS политики для bucket
create policy "Авторизованные могут загружать накладные"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'trip-invoices');

create policy "Все могут читать накладные"
  on storage.objects for select
  to public
  using (bucket_id = 'trip-invoices');

create policy "Авторизованные могут удалять свои накладные"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'trip-invoices');

create policy "Авторизованные могут обновлять накладные"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'trip-invoices')
  with check (bucket_id = 'trip-invoices');
