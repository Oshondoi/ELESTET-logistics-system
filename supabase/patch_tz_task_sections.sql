-- Раздел страницы для коротких задач на служебной странице «Промпты ТЗ».
-- Существующие задачи остаются в общем разделе благодаря DEFAULT.

alter table public.tz_tasks
  add column if not exists section_key text not null default 'general';

alter table public.tz_tasks
  drop constraint if exists tz_tasks_section_key_check;

alter table public.tz_tasks
  add constraint tz_tasks_section_key_check check (section_key in (
    'general',
    'home',
    'fulfillment',
    'shipments',
    'wms',
    'fbs',
    'stores',
    'products',
    'directories',
    'stickers',
    'reviews',
    'invoices',
    'roles',
    'promotion',
    'subscription',
    'finance_report',
    'diary',
    'glossary',
    'admin',
    'tz_prompts'
  ));

create index if not exists tz_tasks_section_position_created_idx
  on public.tz_tasks (section_key, position, created_at);
