# Project Brief

## Project
`ELESTET` is an MVP web application for managing logistics shipments to Wildberries.

## Primary Goal
Build a clean, extensible SaaS-style operations panel for shipment tracking and store management, with Supabase as the backend and React + Vite as the frontend.

## Scope of Current MVP
- Multi-account SaaS data model
- Supabase Auth flow
- Company creation and selection
- Russian-language business UI
- Shipments list page
- Shipment creation modal
- Stores page
- Store creation modal
- Supabase-ready SQL schema
- Strict Supabase-backed runtime for reads/writes

## Required Business Entities
- `auth.users`
- `profiles`
- `accounts`
- `account_members`
- `stores`
- `shipments`
- `shipment_status_history`

## Core Business Rules
- One user can belong to multiple accounts
- One account can contain multiple stores
- Each store belongs to exactly one account
- Each shipment belongs to exactly one account and one store
- Shipment status changes must be written to history
- `tracking_number` increments only within a store
- `tracking_code` format is `TRK-{number}`
- `store_code` format is `A4821` style: 1 uppercase letter + 4 digits
- `store_code` must be unique globally
- `arrival_date` is auto-filled when status becomes `Прибыл`, but remains editable
- Physical delete is not the main UX path; schema should remain safe and relationally correct

## Product Direction
The product should feel like a practical operations system, not a marketing landing page. Dense, readable, and efficient UI is preferred over decorative layout.

## Change Discipline
- Work strictly to the user's task and the stated acceptance criteria
- Do not change unrelated business logic, UI behavior, copy, layout, or visual style unless the task explicitly asks for it
- Prefer the smallest safe fix that solves the requested problem
- Avoid opportunistic refactors and side improvements during focused bugfix or UI tasks
- A valid task result must not regress adjacent screens, forms, shared UI primitives, or existing flows
- If a requested fix truly requires touching nearby areas, keep the blast radius minimal and explicit
- Default project rule: preserve already working behavior and do not touch adjacent screens, entities, or styles unless the current task explicitly requires it

## Безопасность проекта (задача — «задача о безопасности проекта»)

### GitHub — публичный репозиторий
- Vercel бесплатный тариф требует публичного репо — всё видно всем
- Защита от использования кода: добавить файл `LICENSE` (Commons Clause поверх MIT или проприетарная «All Rights Reserved») — юридический барьер, технически не останавливает
- Альтернатива без публичного репо: Vercel Pro ($20/мес) или деплой через `vercel deploy` из CLI без GitHub

### Supabase — база данных
- **Anon key** в коде — нормально, он публичный по дизайну. Опасен только если RLS отключён
- **Service role key** — НИКОГДА в фронтенд-код. Только в серверные edge functions / .env сервера. Если попал в публичный репо — немедленно ротировать в дашборде Supabase
- **RLS (Row Level Security)** — главная защита. Пока политики правильные — данные чужих аккаунтов закрыты
- **Откат назад**: Supabase Pro ($25/мес) = PITR (Point-in-time recovery, до 7 дней). Бесплатный = ежедневные бэкапы, только через поддержку
- **Снапшот БД**: `supabase db dump` (CLI) или pg_dump через дашборд → один SQL-файл структуры + данных

### Приоритеты (в порядке важности)
1. Убедиться что `service_role` key нигде нет в коде/репо — критично
2. `sourcemap: false` в `vite.config.ts` — ✅ сделано. Без этого любой видит исходный TypeScript через DevTools
3. Добавить `LICENSE` файл — минимальная правовая защита кода
4. Supabase Pro — если данные клиентов критически важны (PITR)

## Счёт клиенту — InvoicesPage (10.05.2026)
Страница `/invoices` — выставление счётов клиентам на основе данных FulfillmentBatch.

### Список счётов
- Колонки: ID (`I-N`), Партия (`P-N` + название), Магазин, Статус (иконка+текст), Создана, Принято, ОТК, Маркировка, Коробов, Сумма
- Статус-иконки: `done` = зелёная галочка, `active` = оранжевые часы, `cancelled` = серый крестик
- **Share-кнопка в колонке ID**: рядом с `I-N` — иконка граф-шаринга; createPortal-попап с Telegram/WhatsApp/Копировать ссылку; открывается вверх/вниз автоматически; закрывается click-outside; зелёная птичка 2сек при копировании
- Поиск по I-N, P-N, числу, названию, магазину

### Модальное окно счёта (InvoiceModal)
- Полноэкранное (`fixed inset-0`, `h-full w-full flex-col`)
- Шапка: `I-N` бэдж, статус, название партии, магазин+дата; кнопка Share (TG/WA dropdown) + закрыть
- Тело: `grid-cols-2` — карточка Фулфилмент и карточка Логистика
- **Обе карточки одинаковы**: заголовок + итого в шапке, таблица УСЛУГА/ЦЕНА/КОЛ-ВО/СУММА, `rounded-3xl border border-slate-200`
- **Фулфилмент**: Приёмка (`stage=reception`), ОТК+Маркировка (`buildWorkLines`, tariffMap keyed by UUID!), Формирование коробов (`stage=packing`, qty из `fetchSupplies`)
- **Логистика**: таблица тарифов (TBD), ниже через `border-t` — метаданные рейса (Рейс, Перевозчик, Даты, Поставка, Склад)
- Футер: «Итого к оплате» = `fulfillmentSubtotal + logisticsSubtotal`

### КРИТИЧНО — tariffMap
`tariffMap` = `Record<string, FulfillmentWorkTariff>` keyed by **`t.id` (UUID)** — НЕ name!  
Приёмка/Packing: `Object.values(tariffMap).find(x => x.stage === 'reception'/'packing')`

### URL-роутинг счётов
- Схема: `/invoices/C-{accountShortId}/I-{batch.short_id}`
- `App.tsx` парсит URL при старте, переключает аккаунт, передаёт `initialInvoiceShortId`
- Guard: `useEffect([activePage])` не сбрасывает URL если путь уже `/invoices/...`

## Non-Goals For Current Stage
- Production-grade role UI
- Detailed analytics
- Complex filters and reporting
- Shipment detail page
- Realtime updates
