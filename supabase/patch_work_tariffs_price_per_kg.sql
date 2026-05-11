-- Добавляем поле цена за кг для логистических тарифов
alter table public.fulfillment_work_tariffs
  add column if not exists price_per_kg numeric not null default 0;
