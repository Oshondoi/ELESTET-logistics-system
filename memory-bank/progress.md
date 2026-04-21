# Progress

## Current Status
MVP в активной разработке. Деплой на Vercel активен.

## What Works

- Project scaffolding is complete
- Dev server runs successfully
- Tailwind styling is active
- Left sidebar navigation (зафиксирован по высоте — `h-screen sticky`)
- Company switcher + редактирование названия компании
- Auth page: вход / регистрация (Имя обязательно, JS-валидация)
- Session-gated app shell
- Company creation / switching / deletion (FK-безопасное) flow
- Supabase client bootstrap

### Роли (завершено)
- Таблица `roles` с RLS, `assigned_user_id`
- Короткие ID пользователей: U1, U2, U3 (`profiles.short_id`)
- RPC `resolve_account_user` — поиск по email, UUID, U{n}
- Страница Ролей: создание, редактирование, удаление, клонирование в другую компанию
- Назначение роли пользователю: email или U{n} с автоподтягиванием второго поля
- Список ролей показывает имя и U{n} пользователя

### Магазины (завершено)
- Список магазинов + создание / редактирование / удаление
- API-ключ: маска в edit-режиме, кнопка «Изменить»
- store_code редактируем

### Рейсы / Логистика (завершено)
- Таблицы `trips` и `trip_lines`, RPC, UI
- Редактирование рейса и поставки
- Добавление поставки в рейс
- Фото накладных (лайтбокс-карусель, контекстное меню)
- Дропдауны статусов

### Справочники (завершено)
- Перевозчики и склады, CRUD

### Стикеры WB (завершено)
- CRUD шаблонов, PDF-генерация
- Иконки ухода, EAC
- Наборы стикеров

### Деплой (завершено)
- Vercel: env переменные настроены
- Supabase: Site URL и Redirect URLs → Vercel-домен
- Email-подтверждение при регистрации работает

## What's Left
- Этап 5: Поиск и фильтры (Логистика)
- Участники компании (Members)
- Мобильное приложение React Native + Expo

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

### Шаг 1 — Редактирование рейса и поставки (завершён)
- `updateTrip` и `updateTripLine` в `tripService.ts`
- `editTrip` и `editTripLine` в `useAppData.ts`
- `TripFormModal` и `TripLineFormModal` поддерживают режим edit (`initialValues`)
- `TripTable` — кнопки редактирования, отдельные модалки для edit-режима
- Поле `departure_date` добавлено в форму рейса

### Этап 3 — Справочники (завершён)
- `directoriesService.ts` — CRUD carriers/warehouses через Supabase
- `DirectoriesPage.tsx` — двухпанельный UI управления справочниками
- Динамические дропдауны перевозчика и склада в модалках (из Supabase, fallback на constants)
- Пункт «Справочники» в Sidebar (Товары → Справочники → Роли)

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

### Деплой на Vercel (завершён)
- Проект задеплоен на `elestet-logistics-system.vercel.app`
- Исправлены все TypeScript build ошибки (TS5101, TS2322, TS18047, TS2345, TS2339, TS2769)
- `src/types/supabase.ts` дополнен таблицами `trips`, `trip_lines`, RPC-функциями, секциями `Views`/`Enums`/`CompositeTypes`
- Production RLS включён на всех таблицах
- Рекурсивная политика `members_can_view_account_members` исправлена (`user_id = auth.uid()`)
- Рекурсивная политика `members_manage_account_members` исправлена (убрана зависимость от `has_account_role()`)
- Авто-выбор первого аккаунта при первом входе (новый браузер/устройство)
- Env-переменные добавлены в Vercel

### TypeScript build-ошибки (2-й раунд, завершён, коммит 8791a70)
- `src/types/supabase.ts` — добавлены `carriers`, `warehouses`, `sticker_templates`, `sticker_bundles`
- `Topbar.tsx` — `title: string` вместо жёсткого union
- `App.tsx` — `products` добавлен в guard сохранённой страницы
- `TripLineFormModal.tsx` — `makeDefaults(stores, warehouses)` (был пропущен 2-й аргумент)
- `stickerPdf.ts` — `as unknown as string` для bloburl
- `stickerService.ts` — `as unknown as Json` для `StickerBundleItem[]` при insert/update

### Наборы стикеров (завершен)
- Таблица `sticker_bundles` в Supabase + RLS (`supabase/patch_sticker_bundles.sql`)
- Поля иконок в `sticker_templates` (`supabase/patch_sticker_icons.sql`)
- Типы `StickerBundle`, `StickerBundleItem` в `src/types/index.ts`
- `stickerService.ts`: `fetchBundles` (устойчив к ошибке ТБ), `createBundle`, `updateBundle`, `deleteBundle`
- `useAppData.ts`: состояние `bundles`, методы `addBundle`, `editBundle`, `removeBundle`
- `App.tsx`: проброс всех пропс в `StickersPage`
- `StickersPage.tsx`:
  - Выбор через чекбоксы → кнопка «Создать набор» (активна при выборе)
  - Модалка создания: название + индивидуальное кол-во для каждого стикера
  - Модалка редактирования: только стикеры из набора
  - Список наборов: название, кол стикеров, копий итого, дата; действия: предпросмотр, PDF, редактировать, удалить

### Иконки ухода в стикере (завершен)
- SVG: `wash-30`, `iron`, `no-bleach`, `no-tumble-dry`, `eac` — все векторные
- Боолеан поля `icon_*` в `sticker_templates`, `StickerFormValues`, `StickerTemplate`
- Визуальные тогглы в модалке создания/редактирования стикера
- Иконки рисуются в PDF справа от строки «Страна:» (44px)

### Стикеры WB — багфикс (завершён)
- Баг: средняя перекладина буквы Е в знаке ЕАС рисовалась вне блока — исправлено
- EAC — SVG-файл `public/eac.svg`
- Тестовые стикеры из seed имели невалидные EAN13 — исправлено через `supabase/fix_seed_barcodes.sql`
- `StickerFormModal.tsx` — форма создания/редактирования шаблона стикера
- `src/lib/stickerPdf.ts` — Canvas → PNG → jsPDF, EAN-13 баркод, EAC логотип, иконки по уходу
- PDF раскладка: HEADER(штрихкод) / BODY(текст, полная ширина) / FOOTER(иконки 26px + ЕАС в ряд)
- Предпросмотр в новой вкладке + скачивание `.pdf`
- Пункт «Стикеры» добавлен в Sidebar

## What Is Not Yet Done
- Реальный поиск и фильтры (Этап 5)
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
- Нет валидации форм кроме базовой

## Roadmap
1. ✅ Этап 1 — Рейсы
2. ✅ Шаг 0 — Фото накладных (invoice_photo_urls)
3. ✅ Этап 2 — Добавление поставки в рейс
4. ✅ Деплой на Vercel
5. ✅ Шаг 1 — Редактирование рейса и поставки
6. ✅ Этап 3 — Справочники (carriers/warehouses)
7. 🔲 Этап 5 — Поиск и фильтры
8. 🔲 Будущее — Мобильное приложение
