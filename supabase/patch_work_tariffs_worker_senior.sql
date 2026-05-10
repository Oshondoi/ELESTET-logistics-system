-- Добавляем поля ставок для исполнителя и старшего в тарифы работ
alter table public.fulfillment_work_tariffs
  add column if not exists price_worker numeric not null default 0,
  add column if not exists price_senior numeric not null default 0;
