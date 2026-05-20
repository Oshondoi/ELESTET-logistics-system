-- Себестоимость на уровне артикула (общая для всех размеров)
alter table public.products
  add column if not exists cost_price numeric;
