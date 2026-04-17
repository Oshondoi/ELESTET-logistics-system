# Active Context

## Current Focus
Шаг 1 — Редактирование рейса и строки поставки (следующий).

## What Was Recently Done

### Шаг 0 — Фото накладных (завершён)
- Колонка `invoice_photo_urls text[]` в `trip_lines` (SQL-патч `patch_invoice_photos_v2.sql`)
- Storage bucket `trip-invoices` с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра, лайтбокс-карусель (циклический), клавиатурная навигация, scroll lock
- Контекстное меню (3 точки): Добавить / Заменить все / Удалить все
- Диалог подтверждения удаления с закрытием по клику вне
- Хуки: `addInvoicePhoto`, `replaceInvoicePhoto`, `removeInvoicePhoto` в `useAppData`
- Сервисы: `uploadInvoicePhoto`, `updateTripLineInvoicePhotos` в `tripService`

### Шаг 2 — Добавление поставки в рейс (завершён)
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- Модалка `TripLineFormModal`: выбор магазина, склада, объёма
- Добавление через `add_trip_line` RPC
- Удаление рейса и поставки с подтверждением
- Массовое выделение + массовое удаление поставок
- Дропдауны статуса рейса и статуса поставки (меняются сразу в Supabase)
- Дропдаун статуса оплаты поставки

### UX-полировка
- При наведении на строку открытого рейса → все строки поставок подсвечиваются `bg-blue-50`
- Компактный сайдбар

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли
- Логистика: таблица рейсов, раскрытие → строки поставок + фото накладных
- Магазины: список + модалка создания
- Товары / Роли: заглушки

## Immediate Next Steps
1. **Шаг 1:** Редактирование рейса (модалка редактирования) + редактирование строки поставки
2. **Этап 3:** Справочники — управление carriers/warehouses из UI
3. **Этап 5:** Реальный поиск и фильтры
4. **Этап 6:** Деплой + production RLS

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company — включает trips, invoice photos
- RLS policies in schema.sql имеют recursion issue вокруг account_members; обходится в dev через disable_rls_dev.sql
- Не регрессировать компактный операционный layout
- Только минимально необходимые изменения

## Active Risks
- RLS/auth design is not production-ready yet
- carriers/warehouses пока не подключены к фронту (дропдауны из constants.ts)
- Мобильное приложение запланировано на будущее (React Native + Expo, та же Supabase БД)


## What Was Recently Done

### UX-полировка сайдбара
- Уменьшен шрифт и отступы навигационных пунктов
- Убран плюс перед "Добавить компанию", уменьшен текст через scale
- Усилен название компании (font-bold), уменьшен ID-subtitle
- Добавлен пункт "Товары" между Магазины и Роли (заглушка)
- Усилен hover-эффект строк в таблице поставок

### Дропдауны в модалках
- Перевозчик и Склад назначения стали Select вместо Input
- Списки захардкожены в `src/lib/constants.ts` (временно)
- Созданы таблицы `carriers` и `warehouses` в Supabase (`supabase/carriers_warehouses.sql`)

### Рефакторинг логистики → Рейсы
- Введена сущность **Рейс** (`trips`) как верхний уровень отправки
- Введена сущность **Поставка** (`trip_lines`) — строка рейса для конкретного магазина
- Рейс имеет порядковый номер внутри аккаунта (Рейс #1, #2...)
- Поставка имеет порядковый номер внутри магазина (уникален только в рамках store_id)
- SQL-схема: `supabase/trips.sql`
- Патч исправления функций: `supabase/patch_trip_functions.sql`
- Тестовые данные: `supabase/seed_trips.sql` и `supabase/run_seed.mjs`
- Фронт переделан: `TripTable`, `TripFormModal`, `tripService.ts`
- Страница Логистики показывает список рейсов с раскрытием строк
- Протестировано с реальными данными в Supabase ✅

## Present UI State
- Сайдбар: компактный, nav-пункты мельче, компания заметнее
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли
- Логистика: таблица рейсов, раскрытие по стрелке → строки поставок
- Магазины: список + модалка создания
- Товары / Роли: заглушки

## Immediate Next Steps
1. **Этап 2:** Кнопка "+ Поставка" внутри раскрытого рейса → модалка → `add_trip_line` RPC
2. **Этап 3:** Страница Справочники — управление перевозчиками и складами из UI (таблицы уже в Supabase)
3. **Этап 4:** Редактирование рейса и поставки
4. **Этап 5:** Реальный поиск и фильтры
5. **Этап 6:** Деплой + production RLS

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company — теперь включает `trips` и `addTrip`
- RLS policies in `schema.sql` have recursion issue around `account_members`; bypassed in dev using `disable_rls_dev.sql`
- Новые таблицы `trips`, `trip_lines`, `carriers`, `warehouses` имеют корректные RLS по тому же паттерну
- Не регрессировать компактный операционный layout
- Только минимально необходимые изменения; не трогать смежную логику без запроса

## Active Risks
- RLS/auth design is not production-ready yet
- `carriers` и `warehouses` пока не подключены к фронту (дропдауны из constants.ts)
- Мобильное приложение запланировано на будущее (React Native + Expo, та же Supabase БД)
