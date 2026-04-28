-- Добавляем колонку родительской категории (parentName из /content/v2/object/all)
alter table public.products
  add column if not exists category_parent text;
