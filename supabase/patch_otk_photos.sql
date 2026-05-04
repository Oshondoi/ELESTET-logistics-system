-- Добавить колонку photo_urls в журнал ОТК
alter table fulfillment_otk_logs
  add column if not exists photo_urls text[] not null default '{}';

-- Создать bucket для фото ОТК (публичный)
insert into storage.buckets (id, name, public)
values ('otk-photos', 'otk-photos', true)
on conflict (id) do nothing;

-- Политики для bucket otk-photos
create policy "otk photos: authenticated read"
  on storage.objects for select
  using (bucket_id = 'otk-photos');

create policy "otk photos: authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'otk-photos');

create policy "otk photos: authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'otk-photos');
