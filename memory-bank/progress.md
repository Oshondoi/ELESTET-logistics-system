# Progress

## Current Status
MVP в активной разработке. Деплой на Vercel активен.

## Что сделано за сессию 24.05.2026 — Справочники → Валюты + InvoicesPage + WorkTariffs фиксы

### InvoicesPage — карточка «Расходники» (реальные данные из БД)
- `fetchPackagingLogs` и `fetchConsumableCatalog` добавлены в `fetchWorks` (Promise.all теперь 8 элементов)
- `catalogConsumableLines` (useMemo): ZIP-пакеты из `packagingLogs` агрегированы по `catalog_consumable_id`; коробка добавляется из `batch.box_catalog_consumable_id`
- `consumablesSubtotal` = старые расходники + новые catalog lines
- `grandTotal = fulfillmentSubtotal + consumablesSubtotal + logisticsSubtotal`
- JSX «Расходники»: обе группы, subtotal в шапке, empty state только если всё пусто

### WorkTariffsPanel — фикс переименования
- Убран `WarehouseSearchSelect` в режиме `focusField === 'name'` для warehouse-этапов
- Теперь всегда `<input type="text">` — свободное переименование

### WorkTariffsPanel — виртуальные строки складов
- `displayRows` (IIFE) мержит список складов (`warehouses` prop) с существующими тарифами
- Если тариф для склада есть → `{ kind: 'tariff' }`, нет → `{ kind: 'virtual', warehouse }`
- Orphan тарифы добавляются в конец списка
- Virtual row: имя курсивом/slate-400, "—" с hover-ring, клик → inline-edit, onBlur → `saveVirtualRow` → `addWorkTariff`

### Справочники → Валюты — полный редизайн + авто-курс
- **SQL** `patch_currency_primary_rate.sql`: `is_primary boolean`, `exchange_rate numeric` в `account_currencies`
- **Тип** `AccountCurrency` + поля `is_primary`, `exchange_rate`
- **Сервис** `setPrimaryCurrency(accountId, id)` + `updateCurrencyRate(id, rate)`
- **UI**: шапка колонок, ★ для основной (amber), inline-edit курса, disabled для основной
- **Авто-курс**: кнопка в шапке → `open.er-api.com/v6/latest/{primaryCode}` → сохраняет в БД → блокирует ручное редактирование; состояние в localStorage; показывает время последнего обновления
- Build: ✓ `built in 1.88s`, exit 0

---

## Что сделано за сессию 23.05.2026 — Справочники → База расходников

### Удаление вкладки «Тарифы на расходники»
- Полностью убрана вкладка `tariffs` из `ConsumablesPanel` (состояния, функции, JSX, `DeleteConfirmModal`)
- Компонент стал однозначным: только «База расходников» (`consumable_catalog`)

### Новые поля в базе расходников
- SQL-патч `supabase/patch_consumable_catalog_prices.sql` ⚠️ (не применён) — добавляет `price`, `cost`, `currency` в `consumable_catalog`
- Тип `ConsumableCatalogItem`: поля `price: number`, `cost: number`, `currency: string`
- Сервис: `addConsumableCatalogItem(accountId, kind, size, price=0, cost=0, currency='RUB')` и `updateConsumableCatalogItem(id, {size?, price?, cost?, currency?})`

### UX улучшения
- **Валюта раздела** — select + «Применить ко всем (N)» (аналог WorkTariffsPanel), сохраняется в `localStorage('catalog_section_currency')`
- **Колонка «Валюта»** в таблице — amber-badge при выбранной валюте раздела
- **Параметр** нередактируем; инлайн-редактирование только Цена и Себестоимость (`focusCatalogField: 'price' | 'cost'`)
- **Активный таб вида** сохраняется в `localStorage('catalog_active_kind')`
- **Сортировка от большего к меньшему** во всех табах: числовой разбор `NxN`/`NxNxN` через `split(/[xXхХ×]/)`, fallback `localeCompare` desc

### Технические заметки
- Build: 631 модуль, exit 0
- `ConsumableCatalogItem.currency` — `?? 0` для price/cost защищает от undefined до применения SQL-патча

---

## Что сделано за сессию 20.05.2026 — ProductsPage: себестоимость артикула + Excel

### Себестоимость в Импорт ВБ
- Добавлена колонка **«Себестоимость»** на уровне артикула (общая для всех размеров)
- Значение хранится в `products.cost_price` (numeric)
- SQL: `supabase/patch_products_cost_price.sql`

### UX кнопки в шапке таблицы
- Добавлены кнопки: скачать (иконка) / Отмена / Редактировать / Сохранить
- `Редактировать` включает режим ввода себестоимости
- `Отмена` отключена вне edit-режима; в edit-режиме откатывает все несохранённые изменения и выключает режим
- `Сохранить` пишет только изменённые значения

### Excel-выгрузка
- Экспорт по всем товарам и всем баркодам (по одной строке на баркод)
- Колонки: `Артикул WB` | `Баркод` | `Себестоимость` | `Артикул продавца`
- Порядок строк в файле совпадает с текущим порядком списка в UI
- Добавлен автоподбор ширины колонок по содержимому

### Технические заметки
- Сохранение себестоимости переведено с `upsert` на `update ... where id = ?` для обхода 403/RLS-конфликта
- Обновлены `src/pages/ProductsPage.tsx`, `src/services/productService.ts`, `src/types/index.ts`

## Что сделано за сессию 19.05.2026 — Аутсорс-партнёры (B2B контакты, список компаний)

### SQL (`supabase/patch_outsource_partners.sql`) — применён в production
- `outsource_partners` — таблица B2B-связей между компаниями (requester_id, partner_id, status: pending/accepted/declined)
- UNIQUE(requester_id, partner_id) + CHECK requester ≠ partner
- RLS: видят/изменяют оба участника, вставляет только инициатор
- Уведомления через `batch_notifications` при запросе и ответе
- RPCs:
  - `send_partner_request(p_my_account_id, p_partner_short_id)` — поиск по short_id, защита от дублей, повторная отправка при declined
  - `respond_to_partner_request(p_connection_id, p_accept)` — только получатель (partner_id)
  - `get_my_partners(p_account_id)` → TABLE(connection_id, partner_id, partner_name, partner_short_id, status, is_requester, created_at)
  - `remove_partner(p_connection_id)` — удаляет любой из участников

### TypeScript (`src/types/index.ts`)
- `OutsourcePartner` — новый интерфейс (connection_id, partner_id, partner_name, partner_short_id, status, is_requester, created_at)

### outsourceService.ts
- Импортирует `OutsourcePartner`
- `fetchMyPartners(accountId)` → `db.rpc('get_my_partners', ...)`
- `sendPartnerRequest(myAccountId, partnerShortId)` → `db.rpc('send_partner_request', ...)`
- `respondToPartnerRequest(connectionId, accept)` → `db.rpc('respond_to_partner_request', ...)`
- `removePartner(connectionId)` → `db.rpc('remove_partner', ...)`

### AddOutsourceModal (`src/components/outsource/AddOutsourceModal.tsx`) — НОВЫЙ
- Модалка «Добавить партнёра»: ввод C-ID → `sendPartnerRequest` → success animation → auto-close
- Violet тема, валидация числа, обработка серверных ошибок (already exists / already pending и т.д.)

### RolesPage — редизайн Аутсорс-таба
- Суб-табы изменены: `'incoming' | 'outgoing'` → `'partners' | 'services'`
- **Партнёры** (новый таб): входящие запросы на партнёрство (принять/отклонить), принятые партнёры (удалить), исходящие запросы (отменить), отклонённые (убрать)
- **Мои услуги** (бывший `incoming`): входящие приглашения на этапы + активные партии — без изменений
- Badge на главном табе Аутсорс: `totalPendingCount = pendingIncomingCount + pendingPartnerCount`
- `loadOutsourceData` теперь грузит `fetchMyPartners` параллельно с остальными данными

### OutsourceStagesModal — пикер партнёров
- Форма приглашения переключается: **«Из партнёров»** (список `OutsourcePartner[]` кнопками) / **«Ввести C-ID»** (старый ручной ввод)
- По умолчанию открывается «Из партнёров» если `partners.length > 0`
- Партнёры загружаются параллельно в `loadStages` (фильтр: только `status === 'accepted'`)
- Выбор партнёра → заполняет `invitePreview`, затем обычный `handleSendInvite`

### App.tsx
- Импорт `AddOutsourceModal`
- `addOutsourceOpen` state
- `onAddOutsource={() => setAddOutsourceOpen(true)}` в `<RolesPage>`
- `<AddOutsourceModal>` рендерится когда `addOutsourceOpen && activeAccount`

### TypeScript: 0 ошибок. Build: 629 модулей, статус 0.

---

## Что сделано за сессию 19.05.2026 — Аутсорс-система (B2B партии)

### SQL схема (`supabase/patch_outsource.sql`) — применён в production
- `batch_outsource_stages` — этапы аутсорса партии (статус, sort_order, qty_declared/received, has_discrepancy, started_at, completed_at)
- `batch_stage_invites` — приглашения между компаниями (UNIQUE stage_id + invited_company_id)
- `batch_journal` — иммутабельный журнал событий (только INSERT, без UPDATE/DELETE)
- `batch_archive_votes` — голос за архивацию партии (UNIQUE batch_id + company_id)
- `batch_notifications` — внутренние уведомления (title + body + is_read)
- Системная компания C-0: `INSERT INTO accounts (id, name, short_id) VALUES ('00000000-...', 'Системная компания', 0) ON CONFLICT DO NOTHING`
- RLS helper: `user_has_batch_access(p_batch_id)`, `user_is_batch_owner(p_batch_id)`
- RPCs: `find_account_by_short_id`, `invite_company_to_stage`, `respond_to_invite`, `get_my_incoming_invites`, `get_my_outgoing_invites`, `get_outsource_batches`, `get_batch_journal`, `vote_batch_archive`
- Cross-company RLS на `fulfillment_batches` и `fulfillment_items` (для исполнителей)

### TypeScript типы (`src/types/index.ts`)
- `OutsourceStageStatus`, `InviteStatus`
- `BatchOutsourceStage`, `BatchOutsourceStageFormValues`
- `BatchStageInvite`, `BatchJournalEntry`, `BatchNotification`
- `IncomingInvite`, `OutgoingInvite`, `OutsourceBatch`

### outsourceService.ts (`src/services/outsourceService.ts`)
- Использует `const db = supabase as any` — т.к. Supabase types не знают о новых таблицах
- `fetchOutsourceStages`, `createOutsourceStage`, `updateOutsourceStage`, `deleteOutsourceStage`, `updateStageStatus`
- `findAccountByShortId`, `inviteCompanyToStage`, `respondToInvite`
- `fetchIncomingInvites`, `fetchOutgoingInvites`, `fetchOutsourceBatches`
- `fetchBatchJournal`, `addJournalEntry`
- `fetchNotifications`, `markNotificationRead`, `markAllNotificationsRead`
- `voteArchiveBatch`

### OutsourceStagesModal (`src/components/fulfillment/OutsourceStagesModal.tsx`)
- Props: `{ open, batch, accountId, accountShortId, isOwner, onClose }`
- Вкладки: **Этапы** + **Журнал**
- Создание/удаление этапов (только владелец), приглашение по C-ID (lookup → превью → подтвердить)
- Старт/завершение (исполнитель), ввод qty_received, предупреждение о расхождении
- Кнопка «Проголосовать за архив»
- Violet тема

### RolesPage (`src/pages/RolesPage.tsx`)
- Добавлен prop `activeAccountShortId?: number | null`
- Вкладки: **Сотрудники** (без изменений) / **Аутсорс** (с badge непрочитанных)
- Аутсорс → Входящие: pending-приглашения с Accept/Decline, активные партии, история
- Аутсорс → Исходящие: отправленные приглашения с цветными статусами

### FulfillmentPage (`src/pages/FulfillmentPage.tsx`)
- Импорт `OutsourceStagesModal`
- `outsourceModalBatch` state
- ID колонка: `C-{accountShortId}` (фиолетовый, мелкий) над `P-{short_id}`
- Новая колонка **Аутсорс** с кнопкой-ссылкой (violet, иконка цепи)
- `<OutsourceStagesModal>` в конце компонента

### Уведомления — NotificationsPanel + Topbar
- `src/components/ui/NotificationsPanel.tsx`: дропдаун, badge, mark read / mark all, violet индикатор
- `src/components/layout/Topbar.tsx`:
  - Props `activeAccountId`, `unreadCount`
  - `notifOpen` state + `notifRef` (оборачивает кнопку И панель)
  - Outside-click через `notifRef` — повторный клик по колокольчику закрывает, не переоткрывает
- `src/App.tsx`: загрузка счётчика при смене аккаунта через `fetchNotifications`

### README обновлён
- Раздел «Аутсорс-система» в «Что уже есть»
- SQL патч #46 в списке миграций
- Строка в Roadmap (✅ Готово)
- Структура папок: `fulfillment/`, `NotificationsPanel`, `outsourceService`

---

## Что сделано за сессию 19.05.2026 — Фулфилмент Логистика: фикс стейта + авто-refresh рейсов

### rebuildSlotsFromSupplies — корректная инициализация модалки Логистики
- **Проблема:** при открытии этапа Логистика все поставки попадали в слот-0 (рейс `batch.trip_id`) — ignoring реальных `supply.trip_id`
- **Фикс:** новая `useCallback rebuildSlotsFromSupplies(loaded)` в `FulfillmentPage.tsx`:
  - собирает уникальные `trip_id` из загруженных поставок
  - строит `tripSlots` с правильными `tripLabel` (из `trips` стора)
  - строит `supplySlotMap` — каждая поставка в свой слот по `trip_id`
  - Если `trip_id` нет → дефолтный `slot-0`
- Вызывается в `useEffect` по `[batch.id, viewStage]` когда `viewStage === 'logistics'`

### Post-save refresh — устаревший стейт после сохранения
- **Проблема:** после «Сохранить» (в завершённой партии) модалка не обновлялась — показывала pre-save данные
- **Фикс:** после завершения sync-цикла `trip_lines` — `fetchSupplies(batch.id)` + `rebuildSlotsFromSupplies(refreshed)` — перестраивает полное визуальное состояние из БД

### Trip picker — скрытие занятых рейсов
- **Было:** рейс используемый другим слотом помечался `disabled` + badge «Занят»
- **Стало:** такие рейсы полностью фильтруются (`otherUsedTripIds` Set → `filter(t => !otherUsedTripIds.has(t.id))`)
- Убраны `isUsedByOther`, `disabled`, и соответствующие классы

### Белая страница — dangling JSX reference
- **Причина:** фильтр убрал `isUsedByOther` переменную, но JSX `{isUsedByOther && ...}` остался → runtime error → краш
- **Фикс:** удалён JSX-фрагмент `{isUsedByOther && <span>...</span>}`
- **Паттерн для памяти:** после удаления переменной — всегда grep по файлу на её имя перед сохранением

### Trip picker — фиксированная высота 520px
- **Проблема:** модалка прыгала по высоте при поиске / разном кол-ве рейсов
- **Фикс:** обёртка модалки: `style={{ height: '520px' }} flex flex-col` + список `flex-1 overflow-y-auto min-h-0`

### Авто-refresh рейсов на странице Логистики (Stale Global Cache)
- **Проблема:** `useAppData` загружает `trips` один раз при старте. Порт 5173 и порт 5174 — независимые инстансы. Изменения в рейсах из Фулфилмент-модалки невидимы на Логистике без F5.
- **useAppData.ts:**
  - `storesRef` — ref для актуального состояния stores без пересоздания каналов
  - `refreshTrips: useCallback` — `fetchTrips(accountId, storesRef.current).then(setTrips)`
  - Supabase Realtime: подписка `trip_lines_changes_{accountId}` на `postgres_changes` → вызывает `refreshTrips`
  - `visibilitychange`: при возврате на вкладку → вызывает `fetchTrips` заново
  - `refreshTrips` добавлена в return объект хука
- **App.tsx:**
  - `refreshTrips` добавлена в destructure из `useAppData`
  - `useEffect([effectivePage])`: при `effectivePage === 'shipments'` → `void refreshTrips()`

---

## Что сделано за сессию 17.05.2026 — Teksher Countries кэш + Регистрация товара + 401 фикс

### Страна производства — bugfix + кэш в Supabase
- **Баг:** `manufacturedCountryId` никогда не попадал в API-запрос — поле называлось иначе и/или отсутствовало в payload
- **Фикс:** в edge function `create_product` добавлен `manufacturedCountryId: countryId || undefined` в payload
- **countries таблица:** `supabase/patch_countries.sql` — создана таблица `countries(teksher_id PK, name, code, synced_at)` для кэша стран
- **action `countries`:** DB-first (читает из таблицы), fallback на Teksher API + upsert в БД
- **action `refresh_countries`:** всегда тянет с Teksher API + upsert (принудительное обновление)
- **Кнопка «Обновить ТН ВЭД»** теперь также запускает `refresh_countries` — страны синхронизируются вместе с ТН ВЭД
- `KizPage.tsx`: `cpCountry` / `cpCountryId` state + SearchableSelect для выбора страны в форме создания товара

### Регистрация нового товара (GTIN) — полная форма
- **Форма «Регистрация нового товара»** полностью реализована в `KizPage.tsx`
- Поля: GTIN, Полное наименование, Артикул МП (опц.), Производитель (ИНН + наименование), Страна производства, Товарный знак, Код ТН ВЭД
- Атрибуты: подгружаются динамически после выбора ТН ВЭД кода. Для лёгкой пром-ти:  Вид товара, Размер (значение + тип), Цвет, Состав, Целевой пол, Модель/артикул, Номер регламента
- GCP/GLN автоматически берутся из Teksher `/participants/{id}/identifiers`
- Ошибка «Карточка товара с GTIN уже существует» — приходит от Teksher API, отображается в UI

### 401 Unauthorized — фикс invoke()
- **Корень проблемы:** `supabase.functions.invoke()` отправлял устаревший/expired токен — edge function получала невалидный JWT → 401
- **Фикс:** перед каждым вызовом edge function — `await supabase.auth.getSession()` (авто-обновляет access_token через refresh_token), токен явно передаётся в заголовке `Authorization: Bearer {token}`
- Файл: `src/pages/KizPage.tsx`, функция `invoke()`

### Гайд — обновлён (17.05.2026)
- Этап 3 «Регистрация товара»: добавлены детали полной формы, атрибуты, страна производства, API стран, предупреждение о дублирующемся GTIN

---

## Что сделано за сессию 16.05.2026 — Teksher QR пополнение + UI + Favicon

### KizPage.tsx — воссоздан (файл был удалён)
- Полностью восстановлен с нуля, все 4 вкладки работают
- Edge Function `teksher-auth` задеплоена: `npx supabase functions deploy teksher-auth --no-verify-jwt`

### QR пополнение баланса — ЗАВЕРШЕНО ✅
- Обнаружен правильный endpoint через JS bundle Teksher: `generateQr` = `mutation` (POST)
- Тело 500-ошибки раскрыло параметр: `productGroupAlias` (Required!)
- **Endpoint:** `POST /api/v1/qrcode?productGroupAlias=lp`
- **Ответ:** `{ data: "https://megapay.kg/get#...", status: "SUCCESS" }`
- Установлен `qrcode.react@4.2.0`, QR рендерится через `<QRCodeSVG>` локально в браузере
- `productGroup` теперь возвращается из `stats` action и передаётся в `topup_qr`
- Edge function задеплоена с исправлениями

### UI улучшения
- Карточка участника: `sm:grid-cols-[1fr_1fr_max-content_1fr]` — не обрезает имя
- `break-words` / `break-all` вместо `truncate`

### Гайд (KizGuidePage) — обновлён
- Этап 1 + Этап 10: упоминание QR пополнения из ELESTET (MegaPay)
- API endpoint `/api/v1/qrcode?productGroupAlias=lp` добавлен в секцию API

### Favicon
- `public/favicon.svg` — SVG логотип E на тёмном фоне (rx=28)
- `index.html`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`

### Гайд — скрыт для не-admin
- Таб «Гайд» и `<KizGuidePage />` показываются только при `isAdmin` (`email === 'sydykovsam@gmail.com'`)
- `StickersPage.tsx`: кнопка и контент обёрнуты в `{isAdmin && ...}`
- Инициализация таба: `stickers3` → `stickers` для не-admin (защита от localStorage)

### Временные файлы удалены
- `res2.txt`, `response.txt`, `find_auth.mjs`, `teksher_src.js` — больше нет в репозитории

---

## Что сделано за сессию 14.05.2026 — Teksher исследование + КИЗ страница

### Исследование Pedant.kg + Teksher (label.teksher.kg)
- Изучена полная архитектура системы маркировки КР
- Найден рабочий кабинет: `label.teksher.kg` (не `teksher.kg`)
- Перехвачены все REST API endpoints через Playwright intercept
- Расшифрован формат КИЗ кода: GS1 DataMatrix `AI(01)GTIN14 AI(21)SerialNumber`
- Статусы кодов: ISSUED → APPLIED → SOLD
- Аутентификация: JWT Bearer в cookie `access_token`
- Pedant = платный UI поверх label.teksher.kg, своего API нет

### КИЗ страница (KizPage.tsx)
- Добавлена страница `src/pages/KizPage.tsx` между Стикерами и Отзывами
- Раздел работает как дашборд маркировки: статистика, список операций, коды
- Три вкладки: Операции / Коды маркировки / Товары
- Дизайн в стиле ELESTET (Tailwind, без лишних зависимостей)
- Добавлены в PageKey, PAGE_ROUTES, pagePermKey, pageTitles, Sidebar, App.tsx render

### WB энричмент через vendor_code (14.05.2026)
- **Проблема**: GTIN→EAN13 матчинг не работал — разные форматы у WB и Teksher
- **Решение**: `vendorCodeFromFullName(fullName)` — обрезает размерный суффикс `, р.M` из fullName Teksher → получает `vendor_code` → матчит с WB товарами
- Функция: `fullName.replace(/,\s*р\..*$/i, '').trim()`
- `wbByVendorCode: Map<string, WBProductInfo>` — ключ `vendor_code`
- **Цвет из fullName**: list API Teksher возвращает `attributes: null`, цвет парсится regex: `/цвет\s+(.+?)(?:,\s*р\.|$)/i`

### KizPage — колонки из Teksher + WB (14.05.2026)
**Таблица 11 колонок с правильными источниками:**
| Колонка | Источник |
|---------|----------|
| Фото | WB `photos[0].c246x328` |
| GTIN | Teksher `p.gtin` |
| Арт.WB | WB `nm_id` (ссылка) |
| Арт.продавца | WB `vendor_code` |
| Название GTIN | Teksher `p.fullName` |
| Бренд | WB `brand` |
| Цвет | Teksher `teksherColor(p)` (regex из fullName) |
| Страна | Teksher `p.manufacturedCountry.name` |
| Производитель | Teksher `p.manufacturerFullName` |
| Предмет | WB `category` |
| Статус | Teksher `teksherStatusRu(p.status)` |

### KizPage — русские статусы и localStorage (14.05.2026)
- `TEKSHER_STATUS_RU` map: PUBLISHED → Опубликован, ACTIVE → Активен, DRAFT → Черновик, ARCHIVED → Архивирован, WITHDRAWN → Отозван, BLOCKED → Заблокирован, CLOSED → Закрыт
- `subTab` сохраняется в localStorage (`elestet-kiz-subtab`) при каждом переключении

### PhotoThumb — шаред компонент (14.05.2026)
- `src/components/ui/PhotoThumb.tsx` — универсальный компонент миниатюры товара с hover-превью
- Props: `url: string | null | undefined`, `className?: string` (default `'h-9 w-9 rounded-lg'`)
- Превью через `createPortal(document.body)`, auto-позиционирование (право/лево по краю экрана)
- `POP_W=288`, `POP_H=384`, `GAP=12`
- `ProductsPage.tsx` перешёл на `<PhotoThumb url={url} />` — убран inline portal код

### Auth страница — улучшения (14.05.2026)
- **Eye-кнопка** на поле Пароль (оба режима: вход и регистрация) — показывает/скрывает пароль
- **Eye-кнопка** на поле «Подтвердите пароль» (только регистрация)
- **Поле «Подтвердите пароль»** — появляется только в режиме регистрации
- **Валидация**: перед отправкой проверяет `password !== confirmPassword` → ошибка
- **Стабильные позиции полей**: «Имя» и «Подтвердите пароль» — `invisible pointer-events-none` в режиме входа (не `hidden`), поля Email/Пароль не смещаются
- **Равная высота карточки**: `minHeight: 600px` на карточке, `flex-1` на форме, `mt-auto` на кнопке

### KizPage — Инфо модалка (14.05.2026)
- **Кнопка «Инфо»** добавлена рядом с «Подробно» (у строки «КАК ЭТО РАБОТАЕТ?»)
- Видна **только владельцу** (`isAdmin === true` → email === 'sydykovsam@gmail.com')
- **3 таба** внутри модалки: Статусы / Формат GS1 / Ссылки
- **Перенесено** 3 блока с главной страницы KizPage в модалку:
  - Статусы кода (ISSUED → APPLIED → SOLD)
  - Формат GS1 DataMatrix (разбивка кода с пояснениями)
  - Ссылки на кабинет (Кабинет Teksher / API: ISSUED коды / API: Товары GTIN)
- Главная страница KizPage теперь чище — без этих блоков
- Модалка: `!w-[60vw] !max-w-none min-h-[65vh]`
- Состояние: `infoModalOpen` + `infoTab: 'statuses' | 'format' | 'links'`

### isAdmin — проброс в KizPage (14.05.2026)
- `KizPageProps`: добавлен `isAdmin?: boolean`
- `StickersPageProps`: добавлен `isAdmin?: boolean`; передаётся в `<KizPage isAdmin={isAdmin} />`
- `App.tsx`: добавлен `isAdmin={isAdmin}` в `<StickersPage ...>`
- Цепочка: `App.tsx (isAdmin) → StickersPage (isAdmin) → KizPage (isAdmin)`



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
- **URL-роутинг** через react-router-dom (BrowserRouter, PAGE_ROUTES/ROUTE_PAGES, vercel.json SPA fallback)
- **URL партий фулфилмента**: `/fulfillment/C-{n}/P-{m}` — ссылка открывает конкретную партию, кнопка «Поделиться» (Telegram / WhatsApp / Копировать ссылку)

### Android-баг / CSS fix (11.05.2026)
- `@media (pointer: coarse) { :root { -webkit-font-smoothing: auto } }` в `src/styles.css`
- Исправляет обесцвечивание UI на планшете E60 (Chrome 105 + флаг `--disable-composited-antialiasing`)
- macOS (`pointer: fine`) не затронута

### Sidebar — формат ID компании (11.05.2026)
- Формат изменён с `C-1` → **`ID: C-1`** в двух местах `Sidebar.tsx`

### Браки — авто-вкладка из БД (11.05.2026)
- **`ProductsPage`**: вкладка «Браки» читает из `fulfillment_marking_logs` (qty_defect > 0), только чтение
- Шапка: 4 чипа статистики (Позиций / Всего браков rose-500 / Баркодов / Партий)
- Таблица: Дата | Партия (П-N) | Баркод | Кол-во брак
- Сервис: `fetchMarkingDefectsByStore` + `MarkingDefectRow` добавлены в `fulfillmentService.ts`

### InvoicesPage — Расходники (11.05.2026)
- Третья карточка «Расходники» → `grid-cols-3` (было `grid-cols-2`)
- Пустая таблица-заглушка «Расходники не добавлены»
- Фикс share-кнопки: `font-[inherit]` на `<button>` (браузеры не наследуют font для кнопок)

### WB склады — полная база (11.05.2026)
- `patch_wb_system_warehouses.sql`: удалены `?????` строки, вставлены 120+ реальных складов WB + 5 международных
- `ON CONFLICT DO NOTHING` — пользовательские склады не тронуты
- ✅ Применён в production

### Справочники — Склады назначения: сортировка + D&D (11.05.2026)
- Новый компонент `WarehousesPanel` вместо `DirectoryPanel` для складов
- Иконки-кнопки в шапке: алфавитный (`text-slate-400 hover:text-slate-700`) / свой порядок
- Режим `alpha`: useMemo-сортировка по имени
- Режим `custom`: HTML5 drag-and-drop, синяя подсветка цели, рукоятка (6-dots)
- Состояние в localStorage: `warehouse_sort_mode`, `warehouse_order_{accountId}`

### Тарифы работ — Логистика: склад + цена за кг (11.05.2026)
- Стейджи `logistics_rf` и `wb_unload` — поле «Склад» вместо «Название тарифа»
- `WarehouseSearchSelect`: кастомный стилизованный дропдаун с поиском
  - `position: fixed` + `getBoundingClientRect()` — выходит за пределы `overflow:hidden`
  - Поиск по подстроке, нечувствительный к регистру
  - При открытии фокус автоматически в поле поиска
  - Enter выбирает первый результат, Esc закрывает
- Новое поле `price_per_kg` для логистических стейджей:
  - SQL: `patch_work_tariffs_price_per_kg.sql` — `add column price_per_kg numeric default 0`
  - ⚠️ **Применить в Supabase**
  - Колонка «Заказчику / за кг» в таблице (только для логистики)
  - Второй инпут в форме добавления
- Форма добавления тарифа перемещена **вверх** (под «Валюта раздела»), список тарифов ниже
- Шапка таблицы **всегда видна** (пустое состояние = `<tr>` с `colSpan` внутри `<tbody>`)

### Тарифы работ — двойная цена + права (10.05.2026)
- **Три колонки цен**: Заказчику / Исполнителю (зелёный) / Старшему (синий) в `WorkTariffsPanel`
- **Поля БД**: `price_worker`, `price_senior` в `fulfillment_work_tariffs` (`patch_work_tariffs_worker_senior.sql` ✅ применён)
- **Hover-редактирование**: клик по ячейке → edit-режим с фокусом на конкретное поле; убрана иконка карандаша
- **Placeholder = текущее значение** (поле пустое при входе, placeholder показывает текущее)
- **Auto-save on blur** с таймером 120ms (отменяется при прыжке между полями той же строки)
- **Escape** — отмена без сохранения; кнопка удаления только при hover строки
- **`directories_tariff_manage`** — новое право в `RolePermissions` (DEFAULT=false, FULL=true)
  - Чекбокс в RoleFormModal (subItems группы «Справочники»)
  - Лейбл «Редактирование тарифов работ» в RolesPage
  - `DirectoriesPage` принимает `canManageTariffs` prop, передаёт в `WorkTariffsPanel`
  - `App.tsx`: `canManageTariffs={isOwnerOrAdmin || permissions.directories_tariff_manage}`
  - ⚠️ Запустить `supabase/patch_roles_tariff_manage.sql` в Supabase


### FulfillmentPage — исправления (10.05.2026)
- **Белый экран**: добавлен `useMemo` в import React (был пропущен)
- **Прогресс-бар**: `h-0.5` (2px) вместо `h-[1.5px]`, `emerald-300`/`slate-300` коннекторы

### RBAC — Ролевой контроль доступа (завершено)
- `useMyPermissions` хук: owner/admin → FULL_PERMISSIONS, остальные → запрос в `roles` по `assigned_user_id`
- Sidebar: фильтрация пунктов меню по `permKey` из `RolePermissions`
- App.tsx: `pagePermKey` map + useEffect редирект на home при недоступной странице
- Все страницы получают `canManage` prop и скрывают action-кнопки при `canManage=false`:
  - ShipmentsPage + TripTable: чекбоксы, bulk-операции, дропдауны статусов, фото накладных
  - StoresPage + StoreList: sync/edit/delete магазина
  - DirectoriesPage + DirectoryPanel: форма добавления, кнопки редактировать/удалить
  - StickersPage: создать стикер/набор, кнопки редактировать/удалить
  - RolesPage + RoleRow: создать роль, кнопки редактировать/удалить

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
- Колонки: API ключ (зелёный badge), Поставщик, Адрес, Создан
- Кнопка синка с WB API → подтягивает название поставщика (`data.name`)

### Рейсы / Логистика (завершено)
- Таблицы `trips` и `trip_lines`, RPC, UI
- Редактирование рейса и поставки
- Добавление поставки в рейс
- Фото накладных (лайтбокс-карусель, контекстное меню)
- Дропдауны статусов
- `draft_number` / `trip_number`: черновик получает «Черновик-N», по статусу «Отправлен» присваивается `trip_number`
- **Колонки поставки**: Магазин, Поставка, Объём (коробов + единиц + кг), Статус, **Даты** (динамические колонки), Стикеры, Оплата, Комментарий
- **Колонка "Даты" — динамическая (02.05.2026)**: фиксированный порядок 6 дат (Приём → Отправлен → Прибыл → Отгружен → Запланирован → Приём ВБ), max 3 строки в подстолбце (w-[148px]). Видимые даты автоматически распределяются по чанкам 3 штуки — никакого жёсткого лево/право деления. При скрытии любых дат оставшиеся заполняют колонки по порядку без пропусков.
- **Поля `transit_at` и `wb_acceptance_date`**: добавлены в БД через SQL-патчи (⚠️ применить вручную)
- Поле **Вес (кг)** в поставке — отображается в колонке «Объём» (напр. `120 единиц · 40 кг`)
- Автозаполнение дат: `arrival_date` при статусе «Прибыл», `shipped_date` при «Отгружен» (если не заданы вручную)
- Массовое «Прибыл» для рейса: все не-«Отгружен» строки получают `arrival_date = today`
- Глобальная нумерация поставок по `account_id` (вместо `store_id`)
- Сортировка поставок: новые сверху (по `shipment_number DESC`)
- **Поиск по рейсам и поставкам**: поле `min-w-[400px]`, ищет по рейсу, перевозчику, магазину (WB + юр.), коду стора, складу, номеру поставки, WB supply ID; при запросе рейсы авто-разворачиваются; в результате фильтруются и строки внутри рейса
- **Настройки тулбара привязаны к userId**: ключи localStorage содержат суффикс userId — каждый пользователь хранит свои настройки отдельно (expand-all, hover-add, show-supplier)
- **Режим фокуса**: скрывает сайдбар и топбар через CSS-класс `body.elestet-focus-mode` + `sessionStorage`; F5 не сбрасывает (флаг `beforeunload`); уход со страницы / закрытие вкладки — сбрасывает; старая логика затемнения рейсов удалена
- **Статус «В работе» партий фулфилмента**: иконка и текст оранжевые (`text-orange-500` / `text-orange-600`)
- Режим фокуса: тёмный оверлей снаружи таблицы + соседние рейсы `opacity-10`
- Настройка колонок: показ/скрытие builtin и custom колонок через `columnConfigService`
- SQL патч `patch_all_in_one.sql` — применяет все новые колонки и обновлённую функцию за один раз
- Перевозчики и склады, CRUD
- ⚠️ Системные склады WB: требуется `patch_system_warehouses.sql` в продакшн

### Стикеры WB (завершено)
- CRUD шаблонов, PDF-генерация
- Иконки ухода, EAC
- Наборы стикеров
- Вкладка Импорт WB: аккордеон с фото, превью по наведению, чекбоксы, «Создать набор» со skip дублей
- Вкладка Кастомная: массовое удаление через кнопку-корзину в шапке колонки

### Деплой (завершено)
- Vercel: env переменные настроены
- Supabase: Site URL и Redirect URLs → Vercel-домен
- Email-подтверждение при регистрации работает
- Продакшн БД: все 19 SQL-патчей применены, RLS политики восстановлены
- account_members заполнен, данные видны на Vercel

### Товары — ProductsPage (завершено)
- Аккордеон с анимацией (grid-template-rows trick)
- Вложенная таблица размеров (Размер badge + Баркод)
- Сортировка размеров по убыванию (2XL→XL→L→M→S)

### История изменений этапа Маркировка (04.05.2026)
Реализован полный аудит-журнал для этапа Маркировки — полный паритет с ОТК.

**DB:**
- Таблица `fulfillment_marking_log_history` (id, log_id→marking_logs, user_id, user_email, user_name, action, old_values jsonb, new_values jsonb, created_at)
- RLS: SELECT USING true; INSERT WITH CHECK auth.uid()=user_id

**Типы и сервисы:**
- `FulfillmentMarkingLog = FulfillmentOtkLog` (type alias), `FulfillmentMarkingLogHistory` интерфейс
- `addMarkingLogHistory`, `fetchMarkingLogHistory`, `patchMarkingLogHistoryUserName`, `deleteMarkingLog` (soft-delete)

**FulfillmentPage.tsx:**
- `markingHistoryTabId`, `markingLogHistories`, `markingHistoryLoadingIds` (useRef<Set>)
- История пишется в `handleSaveMarkingAll` и `handleMarkingAndAdvance` (created/updated/deleted)
- IIFE-блок истории маркировки — точная копия OTK, только [M]-переменные заменены
- Тарифы `MARKING_TARIFFS`: Стандарт / Срочная / Перемаркировка / Другое
- **Баг-фикс:** pending-deleted логи показываются красными табами сразу (без сохранения) через `pendingDeletedLogs = markingLogs.filter(markingDeletedIds)` + `allDeletedLogs = [...markingDeletedLogs, ...pendingDeletedLogs]`

### Фулфилмент — UX-полировка форм партий (03.05.2026)
- **EditBatchModal**: редактирование партии (название, магазин, 4 этапа), иконка карандаша в строке таблицы
- **Кастомный picker магазина**: searchable modal (z-[60]) с поиском по имени/коду; вложенная модалка «Создать магазин» (z-[70]); stopPropagation на всех слоях
- **Удалён «— без магазина —»** из picker'а
- **Кнопки**: «Создать и закрыть» (`bg-slate-700`, слева) + «Далее» (синяя, справа)
- **Confirmation modal**: при нажатии любой кнопки без выбранного магазина — попап «Продолжить без магазина?»
- **Дефолтные этапы**: все `false` (берутся из `settings`)
- **Маркетплейс**: только `Wildberries` в `constants.ts`

### Иконки оплаты — визуальная полировка (02.05.2026)
- `StatusDropdown`: добавлен `iconToneClasses` — отдельная палитра для иконочного режима (`bg-100 text-500 hover:bg-200`)
- При наличии `iconMap` используются `iconToneClasses` вместо `toneClasses`, hover меняет `bg` а не `opacity`
- Иконки оплаты стали заметнее (дефолт = бывший hover у стикеров)

### Стикеры 2в1 + UI-полировка TripLineStickerCell (завершено, 01.05.2026)
- **`supabase/patch_combined_stickers.sql`**: `ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS combined_sticker_urls text[] DEFAULT '{}'` — применено ✅
- **`types/index.ts`**: `combined_sticker_urls: string[]` добавлено в `TripLine`
- **`tripService.ts`**: `uploadCombinedStickerFile` + `updateTripLineCombinedStickerFiles`
- **`useAppData.ts`**: `addCombinedStickerFile` / `removeCombinedStickerFile` + геттер/сеттер состояния
- **`TripTable.tsx`** → **`ShipmentsPage.tsx`** → **`App.tsx`**: props-цепочка для combined sticker
- **`TripLineStickerCell.tsx`**: фиолетовая группа «2в1» (view + upload), badge счётчик, dropdown-меню, snapshot (меню не закрывается при удалении), удаление по URL (не по индексу), сброс позиции -9999 перед открытием, viewport clamping, badge центрирование, hover-цвета унифицированы

### Стикеры QR-кодов поставки WB (завершено, 30.04.2026)
- Старые модели deprecated → заменены на `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` / `claude-opus-4-7`
- `isAiConfigured` в `ReviewsPage.tsx` — проверяет ключ активного провайдера (не всегда openai_key)
- Все 7 мест с `aiSettings?.openai_key` заменены на `isAiConfigured`
- SQL: `patch_ai_providers.sql` обновлён (добавлен UPDATE для миграции старых model ID)

### Отзывы WB — мульти-провайдер ИИ (завершено, 26.04.2026)
- `AiProvider`: `openai` | `claude`; `ClaudeModel`: Sonnet/Haiku/Opus — все поддерживают Vision
- `callClaudeDirect`: Anthropic API напрямую с заголовком `anthropic-dangerous-direct-browser-access`
- `buildAiPromptParts`: системный + промпт магазина (append, читается вторым)
- `saveStorePrompt`: сохраняет `ai_prompt` в `stores` (принадлежит магазину)
- `Store` тип: `ai_prompt?: string | null`
- `AiTone`: добавлен `professional` (строго формальный)
- `AiSettingsModal`: табы Claude/OpenAI, оба блока в grid-ячейке (без прыжков), кнопка «Активировать», 2 промпт-модалки, удаление ключа
- `ReviewsPage`: активный таб в localStorage, `storePrompt` в `callOpenAi`
- `tailwind.config.js`: `zIndex { 60 }` для PromptModal
- ⚠️ SQL: `patch_ai_providers.sql` + `patch_store_ai_prompt.sql` — применить в Supabase

### Отзывы WB — ИИ-ответы (завершено, 26.04.2026)
- Таблица `account_ai_settings`: `openai_key`, `model`, `tone`, `system_prompt` с RLS по `account_members`
- Поля `ai_reply`, `ai_reply_status` (`none`/`generated`/`sent`), `reply_sent_at` в `wb_feedbacks`
- `WbFeedbackRow` тип — полная строка из БД (включая ai_reply поля)
- `callOpenAi`: toneMap, дефолтный system prompt на русском, max_tokens=400, обработка 401/429
- `AiSettingsModal`: password-поле с show/hide, radio модель, dropdown тон, textarea system prompt
- `NegativeSendModal`: amber-предупреждение для 1–3★ перед отправкой
- Кнопка «⚙ Настройки ИИ»: фиолетовая при настроенном ключе, серая — нет
- Вкладка «🧪 Тест ИИ-ответа»: dry-run, ничего не сохраняется и не отправляется
- UI стабильность: кнопки в header всегда рендерятся (не `&&`), видимость через `disabled`/`invisible`
- При смене магазина: `loadFromDb` вызывается сразу в reset-эффекте
- ⚠️ SQL-патч `patch_ai_reviews.sql` нужно применить в Supabase вручную

### Отзывы WB — ReviewsPage (завершено)
- Таблица `review_templates` в Supabase с RLS
- Таблица `wb_feedbacks` в Supabase для кэширования (patch_wb_feedbacks.sql)
- pagePermKey: `reviews: null` (доступно всем)

### Фикс TS-ошибок Vercel + UI ProductsPage (завершено, 29.04.2026)
- **`StickersPage.tsx`**: явный тип `globalIcons`, добавлено `country: ''` при импорте из WB
- **`tripService.ts`**: `as any` cast для `sticker_file_urls` в `.update()`
- **`ProductsPage.tsx`**: счётчики → «Артикулы N · Баркоды N» (баркоды = сумма всех `product.barcodes`)

### UI-полировка StickersPage + ReviewsPage (завершено, 29.04.2026)
- **`StickersPage.tsx`**: кастомная кнопка даты (`showPicker()`, placeholder `дд.мм.гггг`, `bg-[#F3F6FD]`, `w-[5.5rem]`); новый порядок тулбара; пре-принт модалка для любого кол-ва стикеров
- **`stickerPdf.ts`**: иконки ухода фиксированы внизу (`iconsY = H_PX - PAD - iconSize`)
- **`ReviewsPage.tsx`**: карточки отзывов показывают Плюсы/Минусы из WB; ИИ получает pros/cons; блок «Автоматизация ответов» (переименован), кнопки на строку ниже заголовка, кнопка логов справа по контенту; звёзды в «Тест ИИ-ответа» — amber-стиль
- **`AiSettingsModal.tsx`**: `PromptListModal` закрывается кликом по фону

### Серверная автоматизация ответов WB (завершено, 27.04.2026)
- **Edge Function** `auto-reply` — Deno, запускается через pg_cron каждые 30 минут
- **pg_cron + pg_net**: `cron.job` = `auto-reply-every-30min`, расписание `*/30 * * * *`
- **Настройки** хранятся в таблице `automation_settings` (account_id PK) — управляются с фронта
  - `is_enabled` — включить/выключить серверную автоматизацию
  - `source`: `ai` | `templates` | `ai_with_fallback`
  - `daily_limit` — 0 = без лимита
  - `target_ratings[]` — какие оценки отвечать
  - `require_text` — только отзывы с текстом
  - `delay_seconds` — пауза между ответами (мин 32с на фронте), делится пополам до и после отправки
  - `store_ids[]` — какие магазины обрабатывать
- **Логи** хранятся в таблице `automation_logs` (run_at, sent_count, log[], error)
- **Фронт** (`ReviewsPage.tsx`, вкладка Автоматизация):
  - Все настройки сохраняются в DB при изменении через `saveAutomationSettings`
  - Загружаются из DB при входе/смене аккаунта
  - Блок «Серверная автоматизация»: чекбокс включить/выключить, последние 3 запуска с логами, кнопка обновить
  - Ручная кнопка «Запустить» убрана — всё через сервер
- **SQL патчи**: `patch_automation_settings.sql`, `patch_auto_reply_cron.sql`
- **Сервис**: `src/services/automationService.ts`

### Баг-фикс: новый пользователь видит только Главную (завершено)
- **Причина:** `createAccountWithOwnerInSupabase` возвращала account без `my_role`
- `useMyPermissions` получал `myRole = undefined` → `DEFAULT_PERMISSIONS` (все false) → Sidebar скрывал всё
- **Фикс:** в `useAccounts.ts` `createAccount` добавить `my_role: 'owner' as const` к возвращаемому объекту
- Кнопка «Развернуть/Свернуть все» (двойная стрелка)
- Поиск по артикулу, названию, бренду
- Колонка фото (36×36, плейсхолдер если нет)
- Превью по наведению 288×384px, умное позиционирование — не выходит за края экрана
- Синхронизация через Edge Function `sync-store-products`

### Тарифы логистики — Справочники (завершено, 28.04.2026)
- **carrier_tariffs**: тарифы перевозчика до склада назначения — `price_per_box` (за короб) и `price_per_kg` (за кг), ключ `(carrier_id, warehouse_id)`
- **wb_unload_tariffs**: тарифы отгрузки на склады ВБ — `price_per_box` за короб, ключ `(account_id, warehouse_id)`
- Обе таблицы с RLS по `account_members`
- SQL патч: `supabase/patch_carrier_tariffs.sql`
- Типы: `CarrierTariff`, `WbUnloadTariff` в `src/types/index.ts`
- Сервис: `fetchCarrierTariffs`, `upsertCarrierTariff`, `fetchWbUnloadTariffs`, `upsertWbUnloadTariff` в `directoriesService.ts`
- **UI**: кнопка `₽` у каждого перевозчика → `CarrierTariffModal` (фикс-высота `100vh-2rem`, `max-w-3xl`) — таблица всех складов с чекбоксами (выбрать/снять все) и инпутами за короб/кг, автосохранение при blur
- **WbUnloadTariffsPanel**: панель ниже сетки, системные склады (WB), инпут за короб, автосохранение при blur
- `DirectoriesPage` получает `accountId` пропом

### Стикеры QR-кодов поставки WB + кнопка пропуска (30.04.2026)

- **Edge Function `wb-supply`**: `GET /api/v1/supplies/{ID}/package` → 1 страница/коробка QR PDF (58×40мм)
  - `qrcode-generator@1.4.4` + `pdf-lib@1.17.1`; коробки сортируются по числовому суффиксу кода
  - Русскоязычные ошибки: 401 → «Неверный API-ключ WB», 403 → «Поставка принадлежит другому магазину», 404 → «Поставка не найдена»
  - `/passes` — НЕ существует в WB API (404); логика пропусков через загрузку файла вручную
- **Кнопка «WB» в ячейке стикеров**: фиолетовая (wb_supply_id задан) / серая (нет), попап ID → вызов EF
- **Кнопка «Пропуск»** в ячейке стикеров:
  - Серая (нет файла) → file picker PDF → загрузка
  - Зелёная (есть файл) → открывает в новой вкладке + кнопка замены
  - Хранится в `trip-stickers` бакете (суффикс `_pass`), поле `wb_pass_url` в `trip_lines`
- **SQL**: `supabase/patch_wb_pass_url.sql` — применён ✅
- **Файлы**: `supabase/functions/wb-supply/index.ts` (переписан), `src/services/tripService.ts`, `src/hooks/useAppData.ts`, `src/components/ui/TripLineStickerCell.tsx`, `src/types/index.ts`, `src/components/trips/TripTable.tsx`, `src/pages/ShipmentsPage.tsx`, `src/App.tsx`
- **Меню стикеров**: дата/время из timestamp в имени файла `DD.MM.YYYY HH:MM GMT+N`; badge с 1 файла; кнопка скачивания → всегда меню

## What's Left
- Функциональность фото товаров (клик/просмотр полного набора фото)
- Участники компании (Members) — приглашение по email
- Мобильное приложение React Native + Expo

## Что сделано за сессию 13.05.2026

### Фулфилмент — этап Упаковка (Packaging) (13.05.2026)

Реализован полноценный производственный этап **Упаковка** между ОТК и Маркировкой.

**Порядок этапов:**
`reception → otk → packaging → marking → packing → logistics → done`

**DB:**
- `supabase/patch_packaging_logs.sql` — создаёт таблицу `fulfillment_packaging_logs` (RLS enabled)
- `supabase/patch_packaging_logs_consumable.sql` — добавляет `consumable_id uuid references consumables(id) on delete set null`
- ⚠️ **Оба патча нужно применить в Supabase Dashboard**

**Типы (`src/types/index.ts`):**
- `FulfillmentPackagingLog extends FulfillmentOtkLog { consumable_id: string | null }`

**Сервис (`src/services/fulfillmentService.ts`):**
- `advanceStage`: order-массив и skip-map дополнены стейджем `packaging`
- `fetchPackagingLogs`, `addPackagingLog` (с consumable_id), `updatePackagingLog`, `deletePackagingLog` (soft), `uploadPackagingPhoto`

**FulfillmentPage.tsx:**
- Состояние: `packagingLogs`, `packagingBuffer`, `packagingEdits`, `packagingDeletedIds`, `packagingWorkConsumableId` и прочие переменные аналогично ОТК/Маркировке
- Хендлеры: `handleAddPackagingLog`, `handleDeletePackagingLog`, `handleSavePackagingAll`, `handlePackagingAndAdvance`
- Тарифы: `packagingTariffsList = workTariffs.filter((t) => t.stage === 'packaging')`
- Кнопка продвижения этапа в футере включает `packaging`
- Dashboard: split-card «Упаковка» [Упаковано / Браки / Итого]

**UI изменения:**
- **Этап Упаковка**: Зип-пакеты + журнал Работа (с dropdown расходника). Отдельный блок Расходники удалён.
- **Этап Короба (packing)**: добавлен блок «Зип-пакеты» сверху (аналогичный UI)

---



### Автоматизация отзывов WB — чёрный список артикулов (10.05.2026)

#### Модалка «Артикулы WB»
- **Смена модели данных**: whitelist (`nmIds`) → blacklist (`excludedNmIds`). Пустой = отвечать всем, непустой = пропускать указанные.
- **Источник товаров**: вместо очереди отзывов — `products` таблица через `fetchProducts(storeId)`. Данные те же что на странице Товары.
- **Выпадалка магазинов**: вместо вкладок (overflow) — `<select>` дропдаун. Показывает **все** `storesWithKey` (не только из `autoSettings.storeIds`).
- **Поиск артикулов**: поле поиска по `vendor_code`, `name`, `nm_id`, `barcodes`. Появляется после загрузки товаров.
- **Счётчик**: `N из M арт.` — видно сколько отфильтровано.
- **Фото товаров**: миниатюра 9×9 с hover-превью 288×384px (та же механика что на ProductsPage). Плейсхолдер-иконка если фото нет.
- **Фиксированный размер**: модалка `h-[85vh] max-h-[720px]`, список `flex-1` — размер не меняется при пустом/заполненном состоянии.
- **Сброс поиска**: при смене магазина поиск сбрасывается.

#### Синхронизация excludedNmIds с DB
- `AutomationSettings` сервис: добавлено поле `excluded_nm_ids: number[]`
- `saveAutoSettingsToStorage`: теперь пишет `excluded_nm_ids` в `automation_settings` таблицу
- Загрузка из DB: `fromDb.excludedNmIds` берётся из `s.excluded_nm_ids ?? local`
- **SQL**: `patch_excluded_nm_ids.sql` — `ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS excluded_nm_ids integer[] NOT NULL DEFAULT '{}'` — применён через Management API ✅

#### Edge Function auto-reply
- Интерфейс `AutoSettings` дополнен `excluded_nm_ids: number[]`
- Фильтр кандидатов: если `excluded_nm_ids.length > 0` — отзывы по этим nmId пропускаются
- Функция задеплоена ✅

#### Удалена карточка «Источник ответов»
- Всегда используется ИИ. Карточка «Источник ответов» удалена из UI вкладки Автоматизация.
- Поле `source` сохраняется в DB для совместимости с Edge Function.

### SQL патчи применены через Management API (10.05.2026)
- `excluded_nm_ids integer[]` добавлен в `automation_settings` (201 ✓)

---

## Что сделано за сессию 09.05.2026

### WB Excel шаблоны для поставки FBW (09.05.2026)
Полная документация: `memory-bank/components/wb-excel-export.md`

- **Зелёная кнопка Excel** в ячейке «Стикеры» → дропдаун: «Скачать товары» / «Скачать короба» / «Скачать всё»
- **SheetJS (`xlsx`)** — генерация .xlsx файлов на фронте без сервера
- **Два шаблона**: товары (`Баркод | Количество`) и короба (`Баркод товара | Кол-во товаров | ШК короба | Срок годности`)
- ⚠️ Заголовок `Кол-во товаров` (с «в») — WB чувствителен, без «в» ставит 0 шт
- **ШК коробов** берутся из `trip_lines.wb_package_codes` (сохраняются при синке QR-стикеров), **не** из повторного запроса к WB API
- **WB Supplies API = только чтение**: write-методы для упаковки продавцам недоступны, только загрузка Excel вручную через ЛК
- SQL `patch_wb_package_codes.sql` применён в продакшн через Management API ✅
- Edge function `wb-supply` задеплоена с сохранением wb_package_codes ✅

## Что сделано за сессию 05–06.05.2026

### Дневник ELESTET — AI-настройки и UI (05.05.2026)
- Модальное окно AI-настроек теперь с 3 вкладками в шапке: «Выбор модели» / «Цены на текст» / «Цены на фото»
- Убраны всплывающие i-подсказки (popovers)
- `Modal.tsx`: добавлен prop `headerContent?: ReactNode` — под заголовком рендерится дополнительный блок (вкладки)
- `ClaudeModel` тип расширен до 6 моделей: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-7`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- `CLAUDE_MODEL_OPTIONS` в `AiSettingsModal.tsx` — 6 записей с ценами
- «Тарифы» кнопка в ReviewsPage + встроенный модал с таблицами цен (текст + фото)
- `Button.tsx`: `py-2.5` → `py-1.5` (компактнее)

### Дневник — взаимодействие с календарём (05.05.2026)
- `openDate(date)` — теперь только `setSelectedDate(date)`, без перехода
- `openEntry(date)` — `setSelectedDate` + `setView('entry')` (переход к записи)
- Кнопка «+ Запись»: SVG-плюс + текст «Запись», вызывает `openEntry(selectedDate)`
- `openToday()` → `openEntry(todayISO())`

### Topbar — рефакторинг (05.05.2026)
- Убран prop `onBack`, добавлен `onHomeClick`
- «Домой» стоит в правом блоке слева от «Дневник / Словарь / Админ»
- Три кнопки всегда видны, не зависят от страницы
- Сайдбар скрывается на `admin`, `glossary`, `diary`
- «Домой» показывается только на этих трёх страницах

### Дневник — кнопка перенесена в Topbar (05.05.2026)
- Кнопка «Дневник» убрана из Sidebar
- Добавлена в Topbar (`onDiaryClick` prop), только для `my_role === 'owner'`
- Стиль идентичен «Словарь» и «Админ»

### API-ключи — защита от браузерного сохранения (05.05.2026)
- Все поля API-ключей: `autoComplete="new-password"` + `data-lpignore="true"` + `data-1p-ignore`
- Файлы: `DiaryPage.tsx`, `AiSettingsModal.tsx`, `StoreFormModal.tsx`

### Компании — автосоздание и защита (05.05.2026)
- App.tsx: `useEffect` — если `accounts.length === 0` после загрузки, создаётся «Основная компания»
- `useAccounts.deleteAccount`: проверка `accounts.length - удаляемый <= 0` → ошибка «Нельзя удалить последнюю компанию»
- Кнопка удаления в сайдбаре: `disabled` + `opacity-40` при `accounts.length <= 1`
- `supabase/cleanup_archived_accounts.sql` — скрипт для очистки архивных компаний

### Дропдаун компаний — Portal + архивная модалка (06.05.2026)
- Дропдаун через `createPortal(…, document.body)`, `position:fixed`, `z-9999`, без ограничения шириной сайдбара
- `dropdownRef` на portal-div — click-outside проверяет оба: `companyRef` и `dropdownRef` (фикс: без этого клик по пункту списка закрывал dropdown до срабатывания `onClick`)
- Архивные компании **убраны** из дропдауна → отдельная модалка (Portal, z-10000)
- В конце дропдауна кнопка «Архив» (с иконкой коробки) — видна только при наличии архивных

### Переключение компании до удаления (06.05.2026)
- **Проблема**: при удалении активной компании ставился `activeAccountId = null` → `useAppData(null)` сбрасывал все данные
- **Фикс**: `handleConfirmDeleteActiveCompany` теперь сначала переключается на следующую компанию (oldest по `created_at`), затем вызывает `deleteAccount`

### TypeScript / Vercel build (06.05.2026)
- Ошибка `TS2552: Cannot find name 'SpeechRecognition'` — объявлен интерфейс в `src/vite-env.d.ts`

### SQL-бэкфилл и дубли компаний (06.05.2026)
- `supabase/patch_backfill_missing_companies.sql` — создаёт «Основная компания» всем пользователям у кого нет ни одной записи в `account_members`; идемпотентен
- **Проблема дублей**: `useEffect` в App.tsx срабатывал несколько раз пока `accounts.length` мигал в `0` → создавалось N компаний
- **Фикс**: `autoCreatingCompanyRef = useRef(false)` — флаг ставится в `true` при первой попытке создания, блокирует повторные вызовы в рамках сессии
- `supabase/cleanup_duplicate_companies.sql` — одноразовая чистка пустых «Основная компания» для sydykovsam@gmail.com

### Дропдаун компаний — Portal (05–06.05.2026)
- Рендерится через `createPortal(\u2026, document.body)` с `position:fixed`
- Координаты берутся из `triggerRef.getBoundingClientRect()` при открытии и на scroll
- Не ограничен шириной сайдбара, `z-index: 9999`, `max-h-[50vh]`
- Поиск и фильтры на странице Логистика
- Страница Ролей: добавить группу «Фулфилмент» (`fulfillment_view` / `fulfillment_manage`) в UI тогглов

### Фулфилмент — FulfillmentPage (завершено, 03.05.2026)
Полноценный модуль обработки товарных партий для производственных/фулфилментных компаний.

**Этапы (любой можно отключить при создании партии):**
1. Приёмка — список позиций с баркодами, кол-вом; авто-лукап из БД товаров по баркоду (если store.api_key есть)
2. ОТК — ввод кол-ва после контроля качества
3. Маркировка — ввод кол-ва после маркировки
4. Формирование коробов — единицы + кол-во коробов на каждую позицию
5. Передача на логистику — выбор рейса + поставки → обновляет box_qty/units_qty

**Файлы:**
- `supabase/patch_fulfillment.sql` — таблицы: `fulfillment_settings` (дефолты), `fulfillment_batches`, `fulfillment_items`, `fulfillment_stage_logs`; RLS по `account_members`; UPDATE roles SET permissions ← добавляет `fulfillment_view`/`fulfillment_manage` ⚠️ **ЕЩЁ НЕ ПРИМЕНЁН в Supabase**
- `src/services/fulfillmentService.ts` — полный CRUD + `advanceStage` (вычисляет следующий включённый этап, логирует) + `lookupProductByBarcode` (`.contains('barcodes', [barcode])`, парсит `sizes[].skus`)
- `src/pages/FulfillmentPage.tsx` — три модалки: `CreateBatchModal`, `BatchDetailModal` (прогресс-бар, per-stage UI), `SettingsModal`
- `src/types/index.ts` — `FulfillmentStage`, `FulfillmentBatchStatus`, `FulfillmentSettings`, `FulfillmentBatch`, `FulfillmentItem`, `FulfillmentStageLog`, `FulfillmentBatchWithItems`; добавлены `fulfillment_view`/`fulfillment_manage` в `RolePermissions`, `DEFAULT_PERMISSIONS`, `FULL_PERMISSIONS`
- `src/App.tsx` — `pagePermKey.fulfillment = 'fulfillment_view'`; пробрасывает `accountId`, `stores`, `trips`, `onEditTripLine`, `canManage` в FulfillmentPage

**RBAC:** `fulfillment_view` — видит страницу; `fulfillment_manage` — создаёт/редактирует/удаляет партии. `isOwnerOrAdmin` всегда даёт полные права.

### Баг-фикс StickersPage белый экран (03.05.2026)
- **Причина:** `storesWithKey` использовалась в JSX (строки 572/586) без объявления → `ReferenceError` в браузере → белый экран
- **Фикс:** добавлено `const storesWithKey = stores.filter((s) => s.api_key)` в блок рендера `StickersPage.tsx` перед первым использованием
- TypeScript не поймал — только runtime браузера

## Что сделано за сессию 09.05.2026

### Логистика — переключатель названия магазина
- Кнопка-тоггл (иконка двух перекрывающихся бейджей) между hover-add и шестерёнкой в тулбаре
- Состояние `showSupplier` в `ShipmentsPage`, сохраняется в localStorage (`elestet-logistics-show-supplier`)
- `TripTable` получает новый проп `showSupplier?: boolean`
- **Активен (синий)** → в колонке «Магазин» показывается `store.supplier` (юр. название/ИП/ООО) основным текстом
- **Неактивен (серый)** → показывается `store.name` (WB-название)
- Вторая строка **всегда** = `store.store_code` — не меняется при переключении
- Если `supplier` не задан — в обоих режимах показывается `name`

### Логистика — скрытие «Прибыл» и «Отгружено» в модалке создания
- В `TripLineFormModal` поля «Прибыл» и «Отгружено» скрыты при создании (`!isEdit`)
- Видны только при редактировании существующей поставки (`isEdit = true`)

### Фулфилмент — авто-создание trip_line после сохранения в завершённой партии
- `handleSaveStageDraft` (кнопка «Сохранить» на этапе Короба) при `batch.status === 'done'` и `packingSelectedTripId`:
  - После `persistLocalSupplies` проверяет поставки без `trip_line_id`
  - Создаёт `trip_line` для каждой такой поставки и записывает `trip_line_id` + `trip_id`
  - Итого: добавление новой поставки в завершённую партию → «Сохранить» → поставка сразу появляется на Логистике с привязкой к рейсу

### Защита фулфилментных поставок от ручного редактирования на Логистике
**Концепция:** поставки из ФФ помечаются `fulfillment_batch_id` — ключевые поля блокируются в модалке редактирования.

**DB:**
- `patch_trip_line_fulfillment_batch_id.sql` — добавляет `fulfillment_batch_id uuid references fulfillment_batches(id) on delete set null` в `trip_lines` ⚠️ **применить вручную**
- `patch_trip_line_backfill_fulfillment_batch_id.sql` — бэкфилл старых записей через `fulfillment_supplies` ⚠️ **применить после первого патча**

**Код:**
- `types/index.ts`: добавлено `fulfillment_batch_id?: string | null` в `TripLine`
- `tripService.ts`: новая функция `setTripLineFulfillmentBatch(lineId, batchId)` — UPDATE одной строки
- `FulfillmentPage.tsx`: вызывает `setTripLineFulfillmentBatch` после создания каждого trip_line (при завершении логистики и при сохранении в завершённой партии)
- `TripLineFormModal`: новый проп `fulfillmentBatchId?: string | null`; при задании показывает синий баннер и блокирует Магазин / Склад назначения / Коробов / Единиц / Дата приёма; прочие поля свободны
- `Input.tsx` и `Select.tsx`: добавлены Tailwind disabled-стили (`bg-slate-50 text-slate-400 cursor-not-allowed`)
- `TripTable.tsx`: передаёт `fulfillmentBatchId={editingTripLine?.line.fulfillment_batch_id}` в модалку редактирования
