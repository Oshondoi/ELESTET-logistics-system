# Active Context

## Current Focus
Страница Роли реализована. Сайдбар зафиксирован по высоте. Деплой на Vercel активен. Следующий: Этап 5 — Поиск и фильтры.

## What Was Recently Done

### Страница Ролей (завершена)
- SQL: таблица `roles` с RLS (`patch_roles.sql`)
- SQL: колонка `assigned_user_id` + RPC `resolve_account_user` (`patch_roles_user.sql`)
- SQL: `short_id` (U1, U2, U3...) в `profiles` + обновлённый RPC с `p_short_id` (`patch_profiles_short_id.sql`)
- Типы: `Role`, `RolePermissions`, `DEFAULT_PERMISSIONS`, `ResolvedUser` в `index.ts`
- `roleService.ts` — CRUD + клонирование + `resolveAccountUser` (email / UUID / U{n})
- `useRoles.ts` — хук загрузки, `addRole`, `updateRole`, `removeRole`, `cloneRoleToAccount`
- `RoleFormModal.tsx` — создание/редактирование роли:
  - 10 переключателей доступов по 5 группам
  - Секция "Назначить пользователю": email или U{n}/UUID, резолв на blur, мэтчинг обоих полей
  - Кнопка "Применить к другой компании" (CloneModal)
- `RolesPage.tsx` — список ролей с карточками, имя пользователя + `U{n}`, иконки edit/delete
- `App.tsx` — `useRoles` подключён, пропсы переданы в `RolesPage`

### Сайдбар зафиксирован по высоте (завершено)
- `min-h-screen` → `h-screen sticky top-0 overflow-hidden`
- Средняя секция (компания + nav) → `flex-1 overflow-y-auto`
- Логотип и кнопка Выход всегда видны

### Магазины — полный CRUD (завершено)
- Редактирование магазина (StoreFormModal с `initialValues`)
- Удаление с подтверждением (DeleteConfirmModal)
- Поле API-ключа: скрыто в edit-режиме (маска `••••`), кнопка «Изменить»
- `store_code` редактируем, ограничение формата снято (`patch_store_code_constraint.sql`)
- Иконки edit/delete в стиле DirectoriesPage (всегда видны)

### Редактирование названия компании (завершено)
- Иконка карандаша в дропдауне компании в сайдбаре
- `EditAccountModal` — inline в `App.tsx`
- `updateAccount` в `useAccounts` + `updateAccountInSupabase` в `accountService`

### Удаление компании — FK-безопасное (завершено)
- `delete_account.sql` обновлён: сначала `trip_lines`, `trips`, `carriers`, `warehouses`

### Порядок в сайдбаре
- Стикеры → Роли (поменяны местами)

### Регистрация
- Обязательная JS-валидация поля Имя (не только HTML required)

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен

## SQL патчи — порядок применения
```
1. schema.sql
2. bootstrap.sql
3. dev_access.sql
4. delete_account.sql
5. trips.sql
6. patch_trip_functions.sql
7. carriers_warehouses.sql
8. patch_invoice_photos_v2.sql
9. patch_stickers.sql
10. patch_sticker_icons.sql
11. patch_sticker_bundles.sql
12. patch_store_api_key.sql
13. patch_store_code_constraint.sql
14. patch_system_warehouses.sql
15. patch_roles.sql
16. patch_roles_user.sql
17. patch_profiles_short_id.sql
18. patch_role_member_sync.sql
```

## Immediate Next Steps
1. **Этап 5:** Текстовый поиск + фильтр по статусу на странице Логистика
2. Участники компании (Members) — пригласить / удалить

## What Was Recently Done

### Наборы стикеров (завершен)
- Таблица `sticker_bundles` в Supabase с RLS
- Типы `StickerBundle` и `StickerBundleItem` в `index.ts`
- `stickerService.ts` — `fetchBundles`, `createBundle`, `updateBundle`, `deleteBundle`
- `useAppData.ts` — состояние `bundles`, методы `addBundle`, `editBundle`, `removeBundle`
- `App.tsx` — проброс всех пропс в `StickersPage`
- `StickersPage.tsx`:
  - Таблица стикеров с чекбоксами — выбор товаров для набора
  - Кнопка «Создать набор» активна только при выбранных стикерах
  - Модалка создания: название + список выбранных с индивидуальным кол-вом копий
  - Модалка редактирования: только стикеры из набора, менять название и копии
  - Список наборов (отдельная Card): название, кол стикеров, копий итого, дата
  - Действия: предпросмотр PDF, скачать PDF, редактировать, удалить
  - Индивидуальное кол-во копий стикера в наборе (не привязано к `copies` шаблона)
- `fetchBundles` устойчив к отсутствию таблицы (возвращает `[]` вместо краша)

### Иконки ухода в стикере (завершен)
- SVG-файлы: `public/icons/wash-30.svg`, `iron.svg`, `no-bleach.svg`, `no-tumble-dry.svg`
- `public/eac.svg` — знак ЕАС
- Боолеан поля `icon_wash`, `icon_iron`, `icon_no_bleach`, `icon_no_tumble_dry`, `icon_eac` в `sticker_templates`
- Визуальные тогглы иконок в `StickerFormModal`
- Иконки рисуются в PDF (строка «Страна:» справа, 44px)

### Предыдущее
- Шаблоны стикеров: CRUD, PDF-генерация, векторные иконки, EAC-тоггл

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Роли / Стикеры
- Стикеры: таблица стикеров + секция наборов, полный CRUD, PDF-генерация
- Логистика: таблица рейсов, фото накладных, редактирование
- Справочники: carriers/warehouses

## Immediate Next Steps
1. **Этап 5:** Текстовый поиск + фильтр по статусу на странице Логистика

### TypeScript build-ошибки Vercel (завершен)
- `src/types/supabase.ts` — добавлены таблицы `carriers`, `warehouses`, `sticker_templates`, `sticker_bundles`
- `Topbar.tsx` — тип `title` расширен до `string` (раньше был union с 6 значениями)
- `App.tsx` — `products` добавлен в guard `storedPage` (был пропущен)
- `TripLineFormModal.tsx` — исправлен вызов `makeDefaults(stores, warehouses)` (был без 2-го аргумента)
- `stickerPdf.ts` — `output('bloburl') as unknown as string` (TS2352)
- `stickerService.ts` — `StickerBundleItem[]` → `as unknown as Json` при insert/update

## Important Implementation Notes
- `fetchBundles` возвращает `[]` при ошибке (не крашит апп если таблица не создана)
- Runtime is Supabase-only
- `useAuth` handles session

## What Was Recently Done

### Шаг 1 — Редактирование рейса и поставки (завершён)
- `updateTrip` и `updateTripLine` в `tripService.ts` (Supabase UPDATE + `.select().single()`)
- `editTrip` и `editTripLine` в `useAppData.ts` — оптимистичный апдейт состояния
- `TripFormModal`: режим edit (пропс `initialValues` + заголовок/кнопка меняются)
- `TripLineFormModal`: режим edit (пропс `initialValues`), все поля включая `arrived_box_qty` и `arrival_date`
- `TripTable`: кнопки редактирования рейса и поставки, второй экземпляр модалок для edit-режима
- Поле `departure_date` добавлено в `TripFormValues` и в форму

### Этап 3 — Справочники carriers/warehouses (завершён)
- `src/services/directoriesService.ts` — CRUD для carriers и warehouses через Supabase
- `src/pages/DirectoriesPage.tsx` — двухпанельный UI (lg:grid-cols-2), инлайн-форма добавления, удаление с подтверждением
- `useAppData.ts` — состояния `carriers`/`warehouses`, методы `addCarrier`/`removeCarrier`/`addWarehouse`/`removeWarehouse`, загрузка параллельно с рейсами
- `App.tsx` — `carrierNames`/`warehouseNames` из Supabase (fallback на constants), рендер DirectoriesPage
- `Sidebar.tsx` — пункт «Справочники» в навигации (Товары → Справочники → Роли)
- Дропдауны перевозчика и склада в модалках теперь динамические (из Supabase)

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
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Роли / Стикеры
- Логистика: таблица рейсов, раскрытие → строки поставок + фото накладных + редактирование
- Магазины: список + модалка создания
- Справочники: управление carriers/warehouses (добавить/удалить)
- Товары / Роли: заглушки

### Стикеры WB (завершён)
- Таблица `sticker_templates` в Supabase (CRUD)
- `src/types/index.ts` — тип `StickerTemplate`
- `src/services/storeService.ts` — функции `fetchStickers`, `createSticker`, `updateSticker`, `deleteSticker`
- `src/hooks/useAppData.ts` — состояние `stickers`, методы `addSticker`, `editSticker`, `removeSticker`
- `src/components/stickers/StickerFormModal.tsx` — создание/редактирование шаблона
- `src/pages/StickersPage.tsx` — таблица с чекбоксами, предпросмотр, скачивание PDF, редактирование, удаление
- `src/lib/stickerPdf.ts` — генерация PDF через Canvas + jsPDF + JsBarcode (EAN-13)
  - Раскладка 58×40мм: HEADER(120px штрихкод) / BODY(236px текст полная ширина) / FOOTER(44px иконки+ЕАС)
  - Иконки по уходу 26px в ряд + ЕАС справа, всё центрировано в подвале
  - EAC — геометрические буквы через fillRect (без шрифтов)
  - Штрихкод: JsBarcode `width:4, flat:true, displayValue:false`, цифры вручную с spacing
  - Предпросмотр (`output('bloburl')`) и скачивание (`.save()`)
- `src/components/layout/Sidebar.tsx` — пункт «Стикеры» в навигации

## Immediate Next Steps
1. **Этап 5:** Реальный поиск и фильтры — текстовый поиск по рейсу/перевозчику + дропдаун фильтра статуса на странице Логистика

## Последний багфикс (Стикеры)
- Знак ЕАС в PDF рисовал перекладину буквы Е вне блока (y=191 вместо y=377) — баг приоритета операторов `oy + (ch-t) >> 1` вместо `oy + ((ch-t) >> 1)`
- Знак ЕАС переведён на SVG-файл `public/eac.svg` (официальные пропорции Wikipedia) вместо rect-рисования вручную
- Поле артикула чистится regex `/^[\s\-–—]+|[\s\-–—]+$/g` при рендере PDF
- stickerService.ts: `.trim()` на всех строковых полях при create/update
- Знак ЕАС добавлен в правый верхний угол тела стикера (64px)

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company — включает trips, invoice photos
- RLS policies in schema.sql имеют recursion issue вокруг account_members; обходится в dev через disable_rls_dev.sql
- Не регрессировать компактный операционный layout
- Только минимально необходимые изменения

## Active Risks
- Нет валидации форм кроме базовой
- Страницы Товары и Роли — заглушки
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
