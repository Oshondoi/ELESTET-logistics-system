-- Таблица шаблонов стикеров
create table if not exists public.sticker_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  barcode text not null,                    -- EAN-13 (13 цифр)
  name text not null,                       -- Наименование товара
  composition text,                         -- Состав
  article text,                             -- Артикул
  brand text,                               -- Бренд
  size text,                                -- Размер
  color text,                               -- Цвет
  supplier text,                            -- Поставщик
  supplier_address text,                    -- Адрес поставщика
  production_date text,                     -- Дата производства
  country text not null default 'Кыргызстан',
  copies int not null default 1,            -- Кол-во копий при печати
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, barcode)
);

create index if not exists sticker_templates_account_id_idx
  on public.sticker_templates (account_id);

alter table public.sticker_templates enable row level security;

create policy "members_can_view_stickers"
on public.sticker_templates
for select
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_templates.account_id
      and am.user_id = auth.uid()
  )
);

create policy "members_manage_stickers"
on public.sticker_templates
for all
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_templates.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1 from public.account_members am
    where am.account_id = sticker_templates.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);
