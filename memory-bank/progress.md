# Progress

## Current Status
MVP в активной разработке. Шаг 0, Шаг 1, Шаг 2, Этап 3 завершены.

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

### Стикеры WB — багфикс (завершён)
- Баг: средняя перекладина буквы Е в знаке ЕАС рисовалась на y=191 (тело стикера) вместо y=377 (подвал) — из-за приоритета операторов `oy + (ch-t) >> 1` вместо `oy + ((ch-t) >> 1)`
- Знак ЕАС заменён на SVG-файл `public/eac.svg` с официальными пропорциями (по Wikipedia-источнику)
- `stickerService.ts`: `.trim()` на всех строковых полях при create/update
- `stickerPdf.ts`: regex-очистка краёв значений полей при рендере PDF
- Знак ЕАС добавлен в правый верхний угол тела стикера (64px)
- `StickerTemplate` тип в `src/types/index.ts`
- `StickersPage.tsx` — таблица с чекбоксами, bulk preview/download, CRUD
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
