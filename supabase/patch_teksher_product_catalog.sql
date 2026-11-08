-- Каталог товаров Teksher, который пользователь один раз забрал кнопкой «Обновить».
-- Строки от скана КИЗа остаются в той же таблице, но в каталог не входят.
alter table public.teksher_products
  add column if not exists in_catalog boolean not null default false;

create index if not exists idx_teksher_products_catalog
  on public.teksher_products (store_id)
  where in_catalog;
