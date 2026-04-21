-- Добавляет колонки иконок ухода и ЕАС в sticker_templates.
-- Безопасно запускать повторно (IF NOT EXISTS).

alter table public.sticker_templates
  add column if not exists icon_wash         boolean not null default true,
  add column if not exists icon_iron         boolean not null default true,
  add column if not exists icon_no_bleach    boolean not null default true,
  add column if not exists icon_no_tumble_dry boolean not null default true,
  add column if not exists icon_eac          boolean not null default true;
