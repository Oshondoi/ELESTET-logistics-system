-- Добавить колонку для хранения ШК коробов WB (синхронизируется при скачивании QR-стикеров)
alter table public.trip_lines
  add column if not exists wb_package_codes text[] not null default '{}';
