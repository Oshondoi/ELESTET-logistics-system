# ELESTET Logistics MVP

MVP веб-приложения для логистики поставок на стеке `React + Vite + Tailwind CSS + Supabase`.

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `trips`, `trip_lines`, `carriers`, `warehouses`, `roles`
- Supabase Auth: регистрация (Имя + Email + Пароль обязательны), вход, выход
- Company flow: создание, список, switcher, сохранение в localStorage, удаление (FK-безопасное), редактирование названия
- Деплой на Vercel: env переменные, email-подтверждение → Vercel-домен
- Левый сайдбар: зафиксирован по высоте (`h-screen sticky`), бренд, company switcher (edit + delete), nav, выход
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли

### Роли
- Таблица `roles` с RLS — привязана к компании
- 10 переключателей доступов по 5 группам (Логистика, Магазины, Справочники, Стикеры, Администрирование)
- Назначение пользователю: email или U{n} (короткий ID) — поля подтягивают друг друга по базе
- Клонирование роли в другую компанию
- Короткие ID пользователей: U1, U2, U3... (`profiles.short_id` — sequence)
### RBAC — ролевой контроль доступа
- `useMyPermissions` хук: owner/admin → полные права (без запроса к БД); остальные → запрос в таблицу `roles` по `assigned_user_id + account_id`
- Sidebar скрывает пункты меню по `permKey` из `RolePermissions`
- App.tsx: автоматический редирект на главную если страница недоступна
- Все страницы принимают `canManage?: boolean` и скрывают кнопки создания/редактирования/удаления при недостаточных правах
### Логистика — модель Рейсов
- **Рейс** (#1, #2…) — верхний уровень: перевозчик, дата, статус, оплата
- **Поставка** — строка рейса: магазин, склад, коробов, единиц, вес (кг)
- Таблица рейсов с раскрытием поставок по стрелке
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- Модалки создания и редактирования рейса и поставки
- RPC: `create_trip`, `add_trip_line` (с `reception_date`, `shipped_date`, `weight`, `payment_status`)
- Удаление рейса / поставки с подтверждением
- Массовое выделение и массовое удаление поставок
- Дропдауны статусов рейса, поставки, оплаты
- **Колонки поставки**: Магазин, Поставка, Объём (коробов + единиц + кг), Дата приёма, Статус, Прибыл, Отгружено, Дата МП, Оплата, Комментарий
- **Автодаты**: `arrival_date` → авто при «Прибыл»; `shipped_date` → авто при «Отгружен»
- **Массовое «Прибыл»**: смена статуса рейса затрагивает все не-«Отгружен» поставки
- **Глобальная нумерация** поставок по компании (`account_id`)
- **Настройка колонок**: показ/скрытие builtin и custom колонок через `columnConfigService`
- **Режим фокуса**: затемняет всё кроме активного рейса

### Фото накладных
- Колонка `invoice_photo_urls text[]` в `trip_lines`
- Хранилище: bucket `trip-invoices` (публичный) с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра → лайтбокс-карусель, клавиатурная навигация, scroll lock
- Контекстное меню: Добавить / Заменить все / Удалить все

### Отзывы WB
- Таблица `wb_feedbacks` в Supabase — синхронизация с WB Feedbacks API
- **DB-first**: данные грузятся из БД; WB API вызывается только кнопкой «Синхронизировать»
- **Cooldown** в localStorage — пережигает page refresh; exponential backoff 60→120→240→480→600с
- **Шаблоны авто-ответа** (`review_templates`): CRUD, приоритет ключевые слова → оценка → универсальный, флаг «Авто»
- Переменные в шаблоне: `{buyer_name}`, `{product_name}`, `{stars}`
- **Ручные ответы**: textarea + chips шаблонов → PATCH WB API
- **Вкладка «Тест авто-ответа»** (dry-run): видно какой шаблон совпадёт с каждым отзывом и итоговый текст ответа — ничего не отправляется
- Итоговая статистика: «Будет отвечено: X из Y / Без шаблона: Z»

### ИИ-ответы на отзывы WB
- Ключ хранится в `account_ai_settings` с RLS — каждый клиент использует свой ключ
- **Мульти-провайдер**: Claude (Sonnet 4.6 / Haiku 4.5 / Opus 4.7) и OpenAI (gpt-4o-mini / gpt-4o / gpt-3.5-turbo) — оба поддерживают Vision (фото из отзыва)
- **Активный провайдер**: выбирается кнопкой «Активировать» внутри таба, бейдж «активный» в заголовке
- **`AiSettingsModal`**: табы Claude/OpenAI, оба блока в grid-ячейке (высота не прыгает), удаление ключа
- **4 тона**: Вежливый / Нейтральный / Дружелюбный / Профессиональный
- **Архитектура промптов**:
  - ИИ определяет магазин отзыва → читает системный промпт → читает промпт магазина
  - **Системный промпт** — глобальный для всей Компании (account_id). Если задан — заменяет стандартный промпт ИИ.
  - **Промпт магазина** — привязан к конкретному магазину (store_id). Добавляется после системного.
  - Каждого типа может быть несколько. Все конкатенируются.
  - Хранятся в таблице `ai_prompts` (`type`: `'system'|'store'`, `store_id` nullable)
  - UI: кнопки `[список][+]` рядом с каждым типом; список — модалка с блоками редактирования/удаления
- **`callOpenAi`**: роутинг по `settings.provider` → `callClaudeDirect` или `callOpenAiDirect`
- **Генерация**: кнопка «⚡ ИИ-ответ» на каждой карточке, текст сохраняется в `wb_feedbacks.ai_reply`
- **Правка перед отправкой**: textarea редактируема после генерации
- **NegativeSendModal**: дополнительное подтверждение для отзывов 1–3★
- **Статусы**: `none` → `generated` → `sent`; `reply_sent_at` записывается при отправке
- **Вкладка «🧪 Тест ИИ-ответа»**: dry-run с произвольным текстом/оценкой
- **Активный таб** (Без ответа / Отвечено / Шаблоны / Тест) сохраняется в localStorage
- Требует применения `supabase/patch_ai_reviews.sql`, `patch_ai_providers.sql`, `patch_store_ai_prompt.sql`, `patch_ai_prompts_list.sql`

### Магазины
- Список магазинов + создание / редактирование / удаление
- API-ключ: маска `••••` в edit-режиме, кнопка «Изменить»
- store_code редактируем

### Справочники
- Страница Справочники: Перевозчики и Склады
- Добавление/переименование/удаление с подтверждением
- Динамические дропдауны перевозчика/склада в модалках (из Supabase)

### Стикеры WB (58×40мм)
- Таблица `sticker_templates` в Supabase — полный CRUD
- Генерация PDF через Canvas + jsPDF + JsBarcode
- Иконки ухода (SVG): стирка, утюг, не отбеливать, не тумбинг
- Знак ЕАС — `public/eac.svg`
- Предпросмотр и скачивание PDF (одиночный и bulk)
- **Вкладка Импорт WB**: аккордеон с фото, превью по наведению, чекбоксы (глобальный / на товар / на размер), expand-all, «Создать набор» со skip дублей по баркоду
- **Вкладка Кастомная**: массовое удаление через кнопку-корзину в шапке колонки (активна при 1+ выбранных строках)

### Наборы стикеров
- Выбрать несколько стикеров через чекбоксы → «Создать набор»
- Каждому стикеру в наборе своё кол-во копий
- Список наборов: название, дата, предпросмотр/скачать PDF, редактировать, удалить

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripLineFormModal, TripFormModal
    stores/        — StoreList, StoreFormModal
    accounts/      — AccountFormModal, DeleteAccountModal, ProfileModal
    roles/         — RoleFormModal
    stickers/      — StickerFormModal
    reviews/       — AiSettingsModal
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea, InvoicePhotoCell, DeleteConfirmModal
  hooks/           — useAuth, useAccounts, useAppData, useRoles, useMyPermissions
  lib/             — supabase, constants, utils, stickerPdf, ean13
  pages/           — ShipmentsPage, StoresPage, HomePage, RolesPage, DirectoriesPage, StickersPage, ProductsPage, ReviewsPage, AuthPage
  services/        — tripService, shipmentService, storeService, directoriesService, roleService, accountService, stickerService, reviewsService
  types/           — index.ts (RolePermissions, FULL_PERMISSIONS, AiSettings, WbFeedbackRow, ...)
supabase/
  schema.sql
  bootstrap.sql
  dev_access.sql
  delete_account.sql
  trips.sql
  patch_trip_functions.sql
  carriers_warehouses.sql
  patch_invoice_photos_v2.sql
  patch_stickers.sql
  patch_sticker_icons.sql
  patch_sticker_bundles.sql
  patch_store_api_key.sql
  patch_store_code_constraint.sql
  patch_system_warehouses.sql
  patch_roles.sql
  patch_roles_user.sql
  patch_profiles_short_id.sql
  patch_role_member_sync.sql
  patch_draft_number.sql
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
1.  schema.sql
2.  bootstrap.sql
3.  dev_access.sql
4.  delete_account.sql
5.  trips.sql
6.  patch_trip_functions.sql
7.  carriers_warehouses.sql
8.  patch_invoice_photos_v2.sql
9.  patch_stickers.sql
10. patch_sticker_icons.sql
11. patch_sticker_bundles.sql
12. patch_store_api_key.sql
13. patch_store_code_constraint.sql
14. patch_system_warehouses.sql
15. patch_roles.sql
16. patch_roles_user.sql
17. patch_profiles_short_id.sql
18. patch_role_member_sync.sql
19. patch_draft_number.sql
20. patch_review_templates.sql
21. patch_wb_feedbacks.sql
22. patch_fix_wb_feedbacks_rls.sql
23. patch_ai_reviews.sql            ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
```
> Для dev без auth: `supabase/disable_rls_dev.sql`

4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC |
| Фото накладных | ✅ Готово | invoice_photo_urls, лайтбокс, контекстное меню |
| 2. Добавление поставки | ✅ Готово | Кнопка + модалка + add_trip_line |
| Деплой | ✅ Готово | Vercel + email-подтверждение |
| 1. Редактирование | ✅ Готово | Рейс и поставка |
| 3. Справочники | ✅ Готово | UI управления carriers/warehouses |
| Стикеры WB | ✅ Готово | CRUD шаблонов, PDF, иконки, EAC |
| Наборы стикеров | ✅ Готово | Создать/редактировать/удалить, PDF |
| Магазины CRUD | ✅ Готово | Редактирование, удаление, API-ключ |
| Роли | ✅ Готово | CRUD, доступы, назначение пользователя, U{n} |
| Продакшн БД | ✅ Готово | Все 23 SQL-патчей, RLS восстановлены, данные видны |
| Баркод в стикере | ✅ Готово | Поле в форме, генерация EAN-13, PDF |
| Товары | ✅ Готово | Аккордеон, размеры, фото, превью, синхронизация |
| Магазины — синк WB | ✅ Готово | Колонки API ключ/Поставщик/Адрес, синк seller-info |
| Профиль пользователя | ✅ Готово | Topbar дропдаун + ProfileModal (имя, пароль) |
| **Отзывы WB** | ✅ Готово | WB API, DB-first, шаблоны, cooldown, dry-run вкладка «Тест» |
| **ИИ-ответы на отзывы** | ✅ Готово | OpenAI интеграция, генерация/правка/отправка, 1–3★ подтверждение, Тест-вкладка |
| 5. Поиск и фильтры | 🔲 Следующий | Текстовый поиск, фильтр по статусу (Логистика) |
| Участники компании | 🔲 Следующий | Пригласить / удалить |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка

## Ключевые паттерны / ловушки

### Account / Company модель
- **Account** = «Компания» в UI. Это SaaS tenant-сущность, не профиль пользователя.
- Каждый пользователь может зарегистрироваться и создать свою компанию самостоятельно.
- Один user может быть членом нескольких компаний.
- `Account.my_role` — роль текущего пользователя в этой компании. Приходит из RPC `get_my_accounts`.
- **Важно:** после `createAccountWithOwnerInSupabase` RPC не возвращает `my_role`. В `useAccounts.ts` нужно вручную добавить `my_role: 'owner'` к объекту — иначе новый пользователь после создания компании видит только Главную (пустые permissions).

### Сброс активной страницы на home при обновлении
Активная страница сохраняется в `localStorage` (`elestet-active-page`). **Проблема:** редирект на `home` по правам доступа срабатывал до загрузки прав из БД — `permissions = DEFAULT_PERMISSIONS` (все `false`) сбрасывал страницу.

**Обязательный паттерн в App.tsx:**
```ts
const { permissions, isLoading: isPermissionsLoading } = useMyPermissions(...)
useEffect(() => {
  if (isPermissionsLoading) return  // ← без этого страница всегда сбрасывается на home
  const key = pagePermKey[activePage]
  if (key !== null && !permissions[key]) setActivePage('home')
}, [permissions, activePage, isPermissionsLoading])
```

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

### Редактирование рейса и поставки
- Кнопки редактирования на каждой строке рейса и поставки
- Модалки edit-режима с предзаполнением всех полей
- UPDATE через Supabase (`updateTrip`, `updateTripLine`)

### Справочники
- Страница Справочники: два панели — перевозчики и склады
- Добавление/удаление записей с подтверждением
- Динамические дропдауны перевозчика/склада в модалках (из Supabase)

### Страница магазинов
- Список магазинов + создание / редактирование / удаление
- API-ключ: маска `••••` в edit-режиме, кнопка «Изменить»
- store_code редактируем
- Колонки: API ключ (зелёный badge / прочерк), Поставщик, Адрес, Создан
- Кнопка синка с WB API → подтягивает `data.name` (seller-info) в поле «Поставщик»
- Индикатор загрузки и ошибка при синке (429 → «Много запросов»)

### Товары — ProductsPage
- Таблица товаров с аккордеон-раскрытием по клику на строку
- Анимация `grid-template-rows: 1fr / 0fr` (220ms ease)
- Вложенная таблица размеров: Размер (badge) + Баркод
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Кнопка «Развернуть все / Свернуть все» (двойная стрелка)
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Колонка фото: миниатюра 36×36px с rounded-lg, плейсхолдер если фото нет
- Превью при наведении: 288×384px, умное позиционирование — не выходит за края экрана
- Синхронизация через Edge Function `sync-store-products`
- Только магазины с API-ключом доступны в дропдауне

### Стикеры WB (58×40мм)
- Таблица `sticker_templates` в Supabase — полный CRUD
- Генерация PDF через Canvas + jsPDF + JsBarcode
- Раскладка: Шапка (штрихкод EAN-13) / Тело (текст + ЕАС справа)
- Иконки ухода (SVG): стирка, утюг, не отбеливать, не тумбинг — вкл/выкл через тоггл в модалке
- Знак ЕАС — `public/eac.svg` (официальные пропорции, векторный)
- Предпросмотр в новой вкладке и скачивание `.pdf` (один или bulk)
- Чекбоксы для массовых операций

### Наборы стикеров
- Выбрать несколько стикеров через чекбоксы → «Создать набор»
- Каждому стикеру в наборе своё кол-во копий (не зависит от шаблона)
- Список наборов: название, дата, предпросмотр/скачать PDF, редактировать, удалить
- Хранится в `sticker_bundles` (jsonb `items`)

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripLineFormModal, TripFormModal
    shipments/     — legacy
    stores/
    accounts/
    stickers/        — StickerFormModal
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea, InvoicePhotoCell
  hooks/           — useAuth, useAccounts, useAppData
  lib/             — supabase, constants, utils, stickerPdf
  pages/           — ShipmentsPage, StoresPage, HomePage, ...
  services/        — tripService, shipmentService, storeService, directoriesService
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
  patch_invoice_photos_v2.sql   — миграция invoice_photo_urls text[]  patch_stickers.sql            — таблица sticker_templates + RLS
  patch_sticker_icons.sql       — колонки icon_* (иконки ухода + EAC)
  patch_sticker_bundles.sql     — таблица sticker_bundles + RLS
  seed_stickers.sql             — 3 тестовых стикера
  fix_seed_barcodes.sql         — исправление EAN13 в тестовых данных  seed_trips.sql                — тестовый SQL-сид
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
9. supabase/patch_stickers.sql
10. supabase/patch_sticker_icons.sql
11. supabase/patch_sticker_bundles.sql
```
> Для dev без auth: `supabase/disable_rls_dev.sql`

4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC |
| Шаг 0. Фото накладных | ✅ Готово | invoice_photo_urls, лайтбокс, контекстное меню |
| 2. Добавление поставки | ✅ Готово | Кнопка + модалка + add_trip_line |
| Деплой | ✅ Готово | Vercel + production RLS |
| Шаг 1. Редактирование | ✅ Готово | Редактирование рейса и поставки |
| 3. Справочники | ✅ Готово | UI управления carriers/warehouses |
| Стикеры WB | ✅ Готово | CRUD шаблонов, PDF-генерация, иконки ухода, EAC |
| Наборы стикеров | ✅ Готово | Создать/редактировать/удалить, индивидуальные копии, PDF |
| TS build fix | ✅ Готово | supabase.ts + Topbar + App + TripLineFormModal + stickerPdf + stickerService |
| Профиль пользователя | ✅ Готово | Topbar дропдаун + ProfileModal (имя, пароль) |
| 5. Поиск и фильтры | 🔲 Следующий | Текстовый поиск, фильтр по статусу |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка
- При исправлении одного дефекта не ломать соседние сценарии
