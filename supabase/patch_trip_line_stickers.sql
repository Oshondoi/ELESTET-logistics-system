-- Патч: добавить sticker_file_urls и wb_supply_id к trip_lines, создать bucket для стикеров поставок

alter table trip_lines
  add column if not exists sticker_file_urls text[] not null default '{}';

alter table trip_lines
  add column if not exists wb_supply_id text;

-- Создать bucket для стикеров поставок (публичный)
insert into storage.buckets (id, name, public)
values ('trip-stickers', 'trip-stickers', true)
on conflict (id) do nothing;

-- RLS: аутентифицированные пользователи могут загружать
drop policy if exists "Authenticated can upload trip stickers" on storage.objects;
create policy "Authenticated can upload trip stickers"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'trip-stickers');

-- RLS: публичное чтение
drop policy if exists "Public can read trip stickers" on storage.objects;
create policy "Public can read trip stickers"
  on storage.objects for select
  using (bucket_id = 'trip-stickers');

-- RLS: аутентифицированные пользователи могут обновлять
drop policy if exists "Authenticated can update trip stickers" on storage.objects;
create policy "Authenticated can update trip stickers"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'trip-stickers')
  with check (bucket_id = 'trip-stickers');

-- RLS: аутентифицированные пользователи могут удалять
drop policy if exists "Authenticated can delete trip stickers" on storage.objects;
create policy "Authenticated can delete trip stickers"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'trip-stickers');
