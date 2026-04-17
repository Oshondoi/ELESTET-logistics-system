# Progress

## Current Status
MVP в активной разработке. Шаг 0 (Фото накладных) завершён. Шаг 2 (Добавление поставки в рейс) завершён.

## What Works
- Project scaffolding is complete
- Dev server runs successfully
- Tailwind styling is active
- Left sidebar navigation works (Главная / Фулфилмент / Логистика / Магазины / Товары / Роли)
- Company switcher block and top bar layout exist
- Auth page works
- Session-gated app shell works
- Company creation / switching / deletion flow works
- Supabase client bootstrap exists
- SQL schema exists for all requested entities

### Рейсы (Этап 1 — завершён)
- Таблицы `trips` и `trip_lines` созданы в Supabase
- RPC `create_trip` и `add_trip_line` работают корректно
- Фронт: список рейсов с раскрытием строк поставок
- Модалка создания рейса работает
- Тестовые данные (2 рейса, 5 поставок) созданы и проверены

### Шаг 2 — Добавление поставки в рейс (завершён)
- Кнопка "+ Добавить поставку" внутри раскрытого рейса (peek при hover, фиксирована при открытии)
- Модалка `TripLineFormModal` с выбором магазина, склада, объёма
- Добавление строки через `add_trip_line` RPC
- Индивидуальное удаление строки (рейса и поставки) с подтверждением
- Массовое выделение + массовое удаление поставок
- Дропдауны статуса рейса и статуса поставки (изменяются сразу в Supabase)
- Дропдаун статуса оплаты поставки

### Шаг 0 — Фото накладных (завершён)
- Колонка `invoice_photo_urls text[]` в `trip_lines` (SQL-патч `patch_invoice_photos_v2.sql`)
- Storage bucket `trip-invoices` (публичный) с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра, карусель лайтбокса (циклический), клавиатурная навигация, scroll lock
- Контекстное меню (3 точки): Добавить / Заменить все / Удалить все
- Диалог подтверждения удаления (закрывается по клику вне)
- Удаление отдельного фото — из лайтбокса (countext per photo); "Удалить все" — из контекстного меню
- Хук связы: `onAdd`, `onReplace`, `onRemove` в `useAppData` + `tripService`

### UX-полировка
- При наведении на строку рейса (hover) все строки его поставок подсвечиваются `bg-blue-50`

### Дропдауны в модалках
- Перевозчик и Склад назначения — Select с захардкоженными списками
- Таблицы `carriers` и `warehouses` созданы в Supabase (готовы к подключению)

## What Is Not Yet Done
- Редактирование рейса и строки поставки (Шаг 1)
- Страница Справочники — управление carriers/warehouses из интерфейса (Шаг 3)
- Реальный поиск и фильтры (Шаг 5)
- Деплой и production RLS (Шаг 6)
- Мобильное приложение (будущее)
- Страница Товары (заглушка)
- Страница Роли (заглушка)

## Completed Decisions
- Рейс — верхний уровень отправки, имеет порядковый номер внутри аккаунта
- Поставка (trip_line) — строка рейса для одного магазина, номер уникален внутри магазина
- Используем compact operational UI, не hero layout
- Supabase is the only runtime data source
- Global unique `store_code`, store-scoped `shipment_number`
- Мобильное приложение будет на React Native + Expo, та же Supabase БД

## Known Issues / Gaps
- RLS recursion issue from original schema.sql, bypassed in dev via disable_rls_dev.sql
- carriers/warehouses дропдауны ещё не подключены к Supabase
- Нет валидации форм кроме базовой

## Roadmap
1. ✅ Этап 1 — Рейсы
2. ✅ Шаг 0 — Фото накладных (invoice_photo_urls)
3. ✅ Этап 2 — Добавление поставки в рейс
4. 🔲 Шаг 1 — Редактирование рейса и поставки
5. 🔲 Этап 3 — Справочники (carriers/warehouses)
6. 🔲 Этап 5 — Поиск и фильтры
7. 🔲 Этап 6 — Деплой
8. 🔲 Будущее — Мобильное приложение
