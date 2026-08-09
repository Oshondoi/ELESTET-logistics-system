-- Задачи, перенесённые из рабочего списка 09.08.2026.
WITH base AS (
  SELECT COALESCE(MAX(position), -1) AS max_position
  FROM public.tz_tasks
),
items(text, item_order) AS (
  VALUES
    ('Остатки на складе: синхронизировать ФБС с ВБ', 1),
    ('Ограниченный доступ к просмотру: ограничения по магазинам, просмотр партий и ФБС-заказов', 2),
    ('К скачанному Excel-файлу добавить артикул ВБ, артикул продавца, название товара, цвет и размер', 3),
    ('Массовый выбор списка ФБС-заказов на табе «На сборке»', 4),
    ('Правильная и удобная методика для маркировки заказов ФБС', 5),
    ('Массовая распечатка QR-кодов на всех табах', 6),
    ('Лист подбора ФБС-заказов', 7),
    ('КИЗ ФБС-заказов', 8),
    ('Excel-загрузка данных в партии', 9)
)
INSERT INTO public.tz_tasks (text, position)
SELECT items.text, base.max_position + items.item_order
FROM items
CROSS JOIN base
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tz_tasks existing_task
  WHERE existing_task.text = items.text
);
