-- Тип тарифа логистики для партии (per_box / per_kg)
alter table fulfillment_batches add column if not exists logistics_tariff_type text check (logistics_tariff_type in ('per_box', 'per_kg'));

-- Вес поставки в кг
alter table fulfillment_supplies add column if not exists weight numeric;
