-- Добавляет колонки цены, себестоимости и валюты в базу расходников
alter table consumable_catalog
  add column if not exists price    numeric not null default 0,
  add column if not exists cost     numeric not null default 0,
  add column if not exists currency text    not null default 'RUB';
