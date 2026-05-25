-- ============================================================
-- Тип тарифа логистики на уровне поставки (fulfillment_supplies)
-- Позволяет переопределить batch-уровень для каждой поставки отдельно
-- ============================================================

alter table public.fulfillment_supplies
  add column if not exists logistics_tariff_type text
    check (logistics_tariff_type in ('per_box', 'per_kg'));

comment on column public.fulfillment_supplies.logistics_tariff_type is
  'Переопределение типа тарифа логистики для конкретной поставки. NULL = наследует от партии (fulfillment_batches.logistics_tariff_type).';
