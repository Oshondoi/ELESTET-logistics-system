# ELESTET Logistics MVP

MVP веб-приложения для логистики поставок на стеке `React + Vite + Tailwind CSS + Supabase`.

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `trips`, `trip_lines`, `carriers`, `warehouses`
- Supabase Auth: регистрация, вход, выход, блокировка интерфейса без сессии
- Company flow: создание, список, switcher, сохранение в localStorage, удаление
- Русский операционный интерфейс в компактном SaaS-стиле
- Левый сайдбар: бренд, company switcher, nav, выход
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли

### Логистика — модель Рейсов
- **Рейс** (#1, #2…) — верхний уровень: перевозчик, дата, статус, оплата
- **Поставка** — строка рейса: магазин, склад, коробов, единиц (номер уникален внутри магазина)
- Таблица рейсов с раскрытием поставок по стрелке
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- Модалка создания рейса и поставки
- RPC: `create_trip`, `add_trip_line`
- Удаление рейса / поставки с подтверждением
- Массовое выделение и массовое удаление поставок
- Дропдауны статусов рейса, поставки, оплаты (сохраняются в Supabase сразу)
- При наведении на строку открытого рейса — все его поставки подсвечиваются

### Фото накладных
- Колонка `invoice_photo_urls text[]` в `trip_lines`
- Хранилище: bucket `trip-invoices` (публичный) с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра → лайтбокс-карусель (циклический), клавиатурная навигация, scroll lock
- Контекстное меню: Добавить / Заменить все / Удалить все
- Диалог подтверждения удаления (закрывается по клику вне)

### Страница магазинов
- Список магазинов + модалка создания

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripLineFormModal, TripFormModal
    shipments/     — legacy
    stores/
    accounts/
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea, InvoicePhotoCell
  hooks/           — useAuth, useAccounts, useAppData
  lib/             — supabase, constants, utils
  pages/           — ShipmentsPage, StoresPage, HomePage, ...
  services/        — tripService, shipmentService, storeService
  types/           — index.ts (Trip, TripLine, TripWithLines, ...)
supabase/
  schema.sql                    — основная схема
  bootstrap.sql                 — первый аккаунт
  dev_access.sql                — временный dev-доступ
  disable_rls_dev.sql           — обход рекурсии RLS в dev
  delete_account.sql            — удаление компании
  trips.sql                     — таблицы trips, trip_lines, RLS, RPC
  patch_trip_functions.sql      — патч исправления FOR UPDATE
  carriers_warehouses.sql       — таблицы carriers, warehouses, RLS
  patch_invoice_photos_v2.sql   — миграция invoice_photo_urls text[]
  seed_trips.sql                — тестовый SQL-сид
  run_seed.mjs                  — тестовый Node.js сид
memory-bank/
```

## Запуск

1. `npm install`
2. Создать `.env`:
```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```
3. Применить SQL в Supabase SQL Editor по порядку:
```
1. supabase/schema.sql
2. supabase/bootstrap.sql
3. supabase/dev_access.sql
4. supabase/delete_account.sql
5. supabase/trips.sql
6. supabase/patch_trip_functions.sql
7. supabase/carriers_warehouses.sql
8. supabase/patch_invoice_photos_v2.sql
```
> Для dev без auth: `supabase/disable_rls_dev.sql`

4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC |
| Шаг 0. Фото накладных | ✅ Готово | invoice_photo_urls, лайтбокс, контекстное меню |
| 2. Добавление поставки | ✅ Готово | Кнопка + модалка + add_trip_line |
| Шаг 1. Редактирование | 🔲 Следующий | Редактирование рейса и строки поставки |
| 3. Справочники | 🔲 | UI управления carriers/warehouses |
| 5. Поиск и фильтры | 🔲 | Реальный поиск, фильтр по статусу |
| 6. Деплой | 🔲 | Vercel/Netlify + production RLS |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка
- При исправлении одного дефекта не ломать соседние сценарии

- Supabase Auth: регистрация, вход, выход, блокировка интерфейса без сессии
- Company flow: создание, список, switcher, сохранение в localStorage, удаление
- Русский операционный интерфейс в компактном SaaS-стиле (референс — Педант)
- Левый сайдбар: бренд, company switcher, nav, выход
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли
- **Логистика — модель Рейсов:**
  - Рейс (#1, #2...) — верхний уровень: перевозчик, дата, статус, оплата
  - Поставка — строка рейса: магазин, склад, коробов, единиц (номер уникален внутри магазина)
  - Таблица рейсов с раскрытием поставок по стрелке
  - Модалка создания рейса
  - RPC: `create_trip`, `add_trip_line`
- Страница магазинов со списком и модалкой создания
- Дропдауны Перевозчик и Склад назначения (из констант, таблицы в Supabase готовы)

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripFormModal
    shipments/     — legacy
    stores/
    accounts/
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea
  hooks/           — useAuth, useAccounts, useAppData
  lib/             — supabase, constants, utils
  pages/           — ShipmentsPage, StoresPage, HomePage, ...
  services/        — tripService, shipmentService, storeService
  types/           — index.ts (включает Trip, TripLine, TripWithLines)
supabase/
  schema.sql                    — основная схема
  bootstrap.sql                 — первый аккаунт
  dev_access.sql                — временный dev-доступ
  disable_rls_dev.sql           — обход рекурсии RLS в dev
  delete_account.sql            — удаление компании
  trips.sql                     — таблицы trips, trip_lines, RLS, RPC
  patch_trip_functions.sql      — патч исправления FOR UPDATE
  carriers_warehouses.sql       — таблицы carriers, warehouses, RLS
  seed_trips.sql                — тестовый SQL-сид
  run_seed.mjs                  — тестовый Node.js сид
memory-bank/
```

## Запуск

1. `npm install`
2. Создать `.env`:
```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```
3. Применить SQL в Supabase SQL Editor по порядку:
```
1. supabase/schema.sql
2. supabase/bootstrap.sql
3. supabase/dev_access.sql
4. supabase/delete_account.sql
5. supabase/trips.sql
6. supabase/patch_trip_functions.sql
7. supabase/carriers_warehouses.sql
```
4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC, тест |
| 2. Добавление поставки | 🔲 Следующий | Кнопка + модалка + add_trip_line |
| 3. Справочники | 🔲 | UI управления carriers/warehouses |
| 4. Редактирование | 🔲 | Редактирование рейса и поставки |
| 5. Поиск и фильтры | 🔲 | Реальный поиск, фильтр по статусу |
| 6. Деплой | 🔲 | Vercel/Netlify + production RLS |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка
- При исправлении одного дефекта не ломать соседние сценарии
- Это правило действует по умолчанию всегда: не трогать рабочие части системы, соседние экраны, сущности и стили, если этого прямо не требует текущая задача

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `shipments`, `shipment_status_history`
- Supabase Auth: регистрация, вход, выход и блокировка интерфейса без сессии
- Company flow:
  - создание компании
  - список компаний текущего пользователя в switcher
  - выбор активной компании
  - сохранение активной компании в `localStorage`
  - удаление компании с подтверждением
- Русский операционный интерфейс в компактном SaaS-стиле
- Левый сайдбар, верхний topbar, страницы `Фулфилмент`, `Логистика`, `Магазины`, `Роли`
- Страница логистики с action bar, таблицей и модалкой создания
- Страница магазинов со списком и модалкой создания
- Supabase client и SQL-схема с историей статусов, логикой `tracking_number` и автогенерацией `store_code`
- Приложение работает в Supabase-only режиме

## Структура

```text
src/
  components/
    layout/
    shipments/
    stores/
    ui/
  hooks/
  lib/
  pages/
  services/
  types/
supabase/
  schema.sql
  bootstrap.sql
  dev_access.sql
  disable_rls_dev.sql
  delete_account.sql
memory-bank/
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` на основе `.env.example`:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

3. Выполнить SQL в Supabase SQL Editor по порядку:

```sql
-- 1
supabase/schema.sql

-- 2
supabase/bootstrap.sql

-- 3
supabase/dev_access.sql

-- 4
-- auth / onboarding patch (если еще не применен)
-- вставить SQL patch из текущей документации / чата

-- 5
supabase/delete_account.sql
```

Если возникает ошибка из-за RLS recursion на этапе разработки без auth, временно выполнить:

```sql
supabase/disable_rls_dev.sql
```

4. Запустить dev-сервер:

```bash
npm run dev
```

## Supabase

- SQL-схема лежит в `supabase/schema.sql`
- Bootstrap для первого аккаунта лежит в `supabase/bootstrap.sql`
- Временный dev-доступ для браузера без auth лежит в `supabase/dev_access.sql`
- Временное отключение проблемного RLS для dev лежит в `supabase/disable_rls_dev.sql`
- Удаление компании owner-ом лежит в `supabase/delete_account.sql`
- Приложение работает только через Supabase
- Локальная mock-база больше не используется как основной runtime
- Auth уже подключен на фронте, но production RLS / onboarding еще нужно дотянуть до финального вида

## Правила внесения изменений

- Выполнять работу строго по ТЗ и по текущему запросу пользователя
- Не менять бизнес-логику, UX, визуальный стиль, тексты, структуру экранов и поведение вне рамок задачи без явного запроса
- Не делать попутные рефакторинги, переименования, перестройки компонентов или "улучшения на будущее", если это не требуется для решения задачи
- Любая правка должна быть локальной и минимально достаточной
- При исправлении одного дефекта нельзя ломать соседние сценарии, формы, страницы и общие UI-примитивы
- Если для решения задачи все же требуется затронуть смежную область, сначала явно обосновать это и ограничить изменение только необходимым минимумом
- Перед завершением задачи проверять, что исправление не вызвало побочных изменений вне запрошенного объема

## Следующие шаги

- Дотянуть production-ready onboarding и SQL patch под auth / profiles / memberships
- Добавить нормальный выбор компании и управление несколькими компаниями без хардкода на одну active company
- Добавить фильтры, поиск и страницу деталей поставки
- Дошлифовать UI плотность и поведение элементов
- Подготовить проект к удаленному тестированию и деплою
