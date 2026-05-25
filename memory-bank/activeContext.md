# Active Context

## Current Focus (25.05.2026) — Отзывы: бейдж источника ответа (auto/manual) — ЗАВЕРШЕНО

### Что реализовано

#### 1. reply_source — новая колонка в БД
- SQL `supabase/patch_reply_source.sql`: `ALTER TABLE wb_feedbacks ADD COLUMN IF NOT EXISTS reply_source text`
- Значения: `'auto'` | `'manual'` | `null` (старые записи)
- Применено в Supabase через `supabase db query --linked`

#### 2. Типы и сервис
- `WbFeedbackRow` в `src/types/index.ts`: добавлено поле `reply_source: 'manual' | 'auto' | null`
- `loadFeedbackRowsFromDb` в `reviewsService.ts`: select и маппинг включает `reply_source`
- `markReplySent(feedbackId, replyText, currentData?, source?)`: новый параметр `source: 'manual' | 'auto' = 'manual'`
- Оба вызова `markReplySent` в ReviewsPage передают `'manual'`

#### 3. Edge Function `auto-reply`
- DB update теперь включает `reply_source: 'auto'`
- Задеплоено: `supabase functions deploy auto-reply --project-ref jzucxqakvgzpgtvagsnq`

#### 4. UI — бейдж в карточке «Отвечено»
- Рядом с артикулом и WB# в вкладке «Отвечено»:
  - `🤖 Автоответ` (bg-violet-100 / text-violet-600) — ответ от cron/EF
  - `✍ Вручную` (bg-slate-100 / text-slate-500) — ответ из интерфейса
  - Ничего — старые записи (`reply_source = null`)

#### 5. Автоматизация — карточки Магазины/Артикулы компактнее
- Кнопка «Выбрать» перенесена в одну строку с заголовком (flex justify-between)
- Высота карточек уменьшилась, больше места для контента ниже

### Ключевые файлы
- `src/types/index.ts` (`WbFeedbackRow.reply_source`)
- `src/services/reviewsService.ts` (`markReplySent`, `loadFeedbackRowsFromDb`)
- `src/pages/ReviewsPage.tsx` (UI badge + compact automation cards)
- `supabase/functions/auto-reply/index.ts` (`reply_source: 'auto'`)
- `supabase/patch_reply_source.sql` (применён)

### Важно
- Старые ответы (до 25.05.2026) имеют `reply_source = null` — бейдж не показывается
- Commit: `e4a563b` «feat: add reply_source badge (auto/manual) in answered reviews tab»

---

## Previous Focus (24.05.2026) — Справочники → Валюты + InvoicesPage расходники + WorkTariffs фиксы — ЗАВЕРШЕНО

### Что реализовано

#### 1. InvoicesPage — карточка «Расходники» (реальные данные)
- `fetchPackagingLogs` + `fetchConsumableCatalog` загружаются в `fetchWorks` (Promise.all из 8)
- `catalogConsumableLines` — useMemo: агрегирует ZIP-пакеты из `packagingLogs` по `catalog_consumable_id`, добавляет коробку из `batch.box_catalog_consumable_id`
- `consumablesSubtotal` включает старые расходники + новые catalog lines
- JSX «Расходники»: показывает обе группы, subtotal в шапке карточки, empty state только если всё пусто

#### 2. WorkTariffs — переименование тарифов (фикс)
- Убрал `WarehouseSearchSelect` при `focusField === 'name'` для warehouse-этапов
- Теперь всегда `<input type="text">` — можно свободно переименовывать

#### 3. WorkTariffs — виртуальные строки складов
- `displayRows` (IIFE) — для warehouse-этапов мержит список складов из `warehouses` prop с существующими тарифами
- Если тариф для склада есть — `{ kind: 'tariff' }`, нет — `{ kind: 'virtual', warehouse }`
- Orphan тарифы (не совпали ни со складом) добавляются в конец
- Virtual row: имя склада курсивом/slate-400, поля цен "—" с hover-ring, клик активирует inline-редактирование
- При сохранении (`saveVirtualRow`) — если хоть одно поле непустое → `addWorkTariff`

#### 4. Справочники → Валюты — полный редизайн (24.05.2026)
- **SQL**: `supabase/patch_currency_primary_rate.sql` ⚠️ (применить в Supabase Dashboard)
  - `account_currencies.is_primary boolean NOT NULL DEFAULT false`
  - `account_currencies.exchange_rate numeric NOT NULL DEFAULT 1`
- **Тип** `AccountCurrency`: добавлены `is_primary: boolean`, `exchange_rate: number`
- **Сервисы** в `directoriesService.ts`:
  - `setPrimaryCurrency(accountId, id)` — снимает is_primary со всех, ставит на одну
  - `updateCurrencyRate(id, rate)` — обновляет exchange_rate
- **CurrenciesPanel** — новый UI:
  - Шапка колонок: Валюта / Основная / Курс к основной
  - ★ звёздочка: клик → назначить основную (amber-500 когда активна)
  - Курс: кликабельный inline-edit (кроме основной → показывает "1" disabled)
  - Отключённые валюты: вся строка opacity-50, поля "—"
  - Подсказка снизу: если валюты включены, но основная не выбрана
- **Авто-курс** (`AutoFetch`):
  - Кнопка в шапке карточки (синяя при включении)
  - Источник: `open.er-api.com/v6/latest/{primaryCode}` (ECB, бесплатно, без ключа)
  - При включении → сразу запрашивает и сохраняет курсы в БД
  - При загрузке страницы → если авто-курс был включён (localStorage `currency_auto_fetch_{accountId}`), автоматически обновляет
  - Пока идёт запрос — spinner + "Обновляется…", поля заблокированы для ручного редактирования
  - После запроса — показывает время: "Авто-курс вкл · Обновлено в 21:45"
  - При смене основной валюты + авто-курс включён → пересчитывает курсы

### Ключевые файлы
- `src/pages/InvoicesPage.tsx`
- `src/pages/DirectoriesPage.tsx` (WorkTariffsPanel + CurrenciesPanel)
- `src/services/directoriesService.ts` (setPrimaryCurrency, updateCurrencyRate)
- `src/types/index.ts` (AccountCurrency)
- `supabase/patch_currency_primary_rate.sql` ⚠️ применить

---

## Previous Focus (23.05.2026) — Справочники → База расходников — ЗАВЕРШЕНО

### Что реализовано
1. **SQL** `patch_consumable_catalog_prices.sql` — добавляет `price numeric`, `cost numeric`, `currency text` в `consumable_catalog` (⚠️ ещё не применён в production)
2. **Тип** `ConsumableCatalogItem` обновлён: `price`, `cost`, `currency`
3. **Сервис** `directoriesService.ts`: `addConsumableCatalogItem` и `updateConsumableCatalogItem` принимают `currency`
4. **Удалена вкладка «Тарифы на расходники»** полностью — весь код (состояния, функции, JSX, DeleteConfirmModal)
5. **Добавлена «Валюта раздела»** — select + «Применить ко всем», аналог WorkTariffsPanel
6. **Колонка «Валюта»** в таблице Base расходников
7. **Параметр** — нередактируемая колонка (только Цена и Себестоимость в инлайн-редактировании)
8. **localStorage**: `catalog_active_kind` — активный таб; `catalog_section_currency` — валюта раздела
9. **Сортировка позиций** от большего к меньшему по размеру (числовой разбор `NxN`/`NxNxN`, fallback `localeCompare` для кастомных строк)

### Важные детали
- Сортировка: `split(/[xXхХ×]/).map(Number)` — поддерживает латинский, кириллический и символьный разделитель
- `useRef` и `fetchConsumables` / `addConsumable` / `updateConsumable` / `deleteConsumable` / `Consumable` стали неиспользованными после удаления таба — оставлены в импорте (TypeScript не ругается без `noUnusedLocals`)
- Build: ✓ 631 модуль, exit 0

---

## Previous Focus (20.05.2026) — ProductsPage: себестоимость артикула + Excel — ЗАВЕРШЕНО

### Что реализовано
1. Колонка **«Себестоимость»** на уровне строки товара (не в размерах), общая для всех размеров артикула
2. Управление через кнопки в шапке таблицы: скачать (иконка) / Отмена / Редактировать / Сохранить
3. `Отмена` выключает edit-режим и откатывает все несохранённые изменения
4. Excel-выгрузка включает все товары и каждый баркод отдельной строкой
5. Формат Excel: `Артикул WB` | `Баркод` | `Себестоимость` | `Артикул продавца`
6. Порядок строк в Excel совпадает с текущим порядком списка в UI
7. Автоподбор ширины колонок в Excel по содержимому

### База данных
- Добавлена миграция `supabase/patch_products_cost_price.sql`
- Новое поле: `products.cost_price numeric`

### Важный фикс
- Сохранение себестоимости переведено с `upsert` на `update ... where id = ?` (иначе 403/RLS-конфликт)

## Current Focus (19.05.2026) — Аутсорс-партнёры (B2B контакты) — ЗАВЕРШЕНО

### Архитектура аутсорс-партнёров
Добавлен слой «контактная книга компаний» поверх существующей системы stage-invites.

**Флоу:**
1. Роли → Аутсорс → «+ Добавить партнёра» → ввести C-ID → запрос отправлен
2. Партнёр видит запрос во вкладке «Партнёры» → принимает/отклоняет
3. В OutsourceStagesModal → «Назначить исполнителя» → сначала список партнёров, затем C-ID вручную
4. Подключённые компании видят свои партии в «Мои услуги»

**Ключевые файлы:**
- `supabase/patch_outsource_partners.sql` — таблица + 4 RPC
- `src/components/outsource/AddOutsourceModal.tsx` — новый модальник
- `src/services/outsourceService.ts` — 4 новые функции
- `src/types/index.ts` — `OutsourcePartner` интерфейс
- `src/pages/RolesPage.tsx` — суб-табы `partners | services`
- `src/components/fulfillment/OutsourceStagesModal.tsx` — пикер партнёров
- `src/App.tsx` — onAddOutsource + render AddOutsourceModal

---

## Предыдущий фокус (19.05.2026) — Аутсорс-система (B2B партии) — ЗАВЕРШЕНО

### Что реализовано:
1. **SQL** — `patch_outsource.sql` применён. 5 таблиц + C-0 + RLS + 8 RPCs
2. **Types** — `BatchOutsourceStage`, `BatchNotification`, `IncomingInvite` и др. в `types/index.ts`
3. **Service** — `outsourceService.ts` (db = supabase as any, все CRUD + RPC функции)
4. **OutsourceStagesModal** — модалка управления этапами партии (вкладки Этапы + Журнал)
5. **RolesPage** — вкладки Сотрудники / Аутсорс (входящие + исходящие приглашения)
6. **FulfillmentPage** — колонка Аутсорс + C-ID над P-ID + `OutsourceStagesModal`
7. **NotificationsPanel** + **Topbar** — уведомления в колокольчике, outside-click фикс
8. **README** + **Memory Bank** обновлены

### Ключевой паттерн: новые Supabase таблицы без regenerate types
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
// db.from('batch_outsource_stages')... — работает, TypeScript не ругается
```

### Outside-click для вложенных дропдаунов (Topbar + NotificationsPanel)
- Проблема: `mousedown` на документе срабатывает ДО `onClick` кнопки → панель закрывается и снова открывается
- Решение: `notifRef` оборачивает **и кнопку, и панель**. Outside-click только в Topbar через `notifRef`. Клик по кнопке — внутри рефа, не закрывает.

---

## Предыдущий фокус (19.05.2026) — Фулфилмент Логистика: визуальный стейт + автообновление рейсов

### Сделано за сессию 19.05.2026:

#### 1. Баг — неправильное начальное состояние слотов в модалке Логистики
- **Проблема:** при открытии модалки все поставки показывались в Слоте 1 (рейс из `batch.trip_id`), хотя реально у каждой поставки был свой рейс в `supply.trip_id`
- **Фикс:** новая функция `rebuildSlotsFromSupplies(loaded)` — строит `tripSlots` и `supplySlotMap` на основе реальных `supply.trip_id` из БД
- Вызывается в `useEffect` загрузки поставок когда `viewStage === 'logistics'`

#### 2. Баг — устаревший визуальный стейт после сохранения
- **Проблема:** после нажатия «Сохранить» в завершённой партии модалка показывала старые данные
- **Фикс:** после sync-цикла `trip_lines` — `fetchSupplies(batch.id)` заново + `rebuildSlotsFromSupplies(refreshed)` — всё перестраивается из БД

#### 3. Trip picker — скрытие рейсов уже занятых другим слотом
- **Было:** рейс помечался disabled + badge «Занят» если уже в другом слоте
- **Стало:** такие рейсы полностью исчезают из списка (`filter` убирает их до рендера)
- Переменная `otherUsedTripIds = new Set(...)` → `filtered.filter(t => !otherUsedTripIds.has(t.id))`

#### 4. Баг — белая страница после фикса trip picker
- **Причина:** удалена переменная `isUsedByOther`, но в JSX осталась ссылка `{isUsedByOther && ...}` → runtime «isUsedByOther is not defined» → краш компонента
- **Фикс:** удалён хвостовой JSX-фрагмент с `isUsedByOther`

#### 5. Trip picker — фиксированная высота модалки (520px)
- **Проблема:** при фильтрации списка рейсов (поиск / разные кол-ва) высота модалки прыгала
- **Фикс:** контейнер модалки `style={{ height: '520px' }}` + `flex flex-col`, список `flex-1 overflow-y-auto min-h-0`

#### 6. Страница Логистики — авто-обновление рейсов при навигации
- **Проблема:** порт 5173 (Фулфилмент) и порт 5174 (Логистика) — отдельные инстансы Vite с независимым `useAppData`. Изменения рейсов (сохранение из модалки Фулфилмента) невидимы на Логистике без F5.
- **Решение:**
  - `useAppData.ts`: добавлена `refreshTrips` — `useCallback` который вызывает `fetchTrips` заново и делает `setTrips(updated)`
  - `App.tsx`: `useEffect` на `effectivePage` → при переходе на `'shipments'` → `void refreshTrips()`
  - **Бонус:** Supabase Realtime подписка на `trip_lines` (`postgres_changes`)
  - **Бонус:** `visibilitychange` event — перезагрузка при возврате на вкладку

---

## Предыдущий фокус (17.05.2026) — Страна производства + Форма создания товара + 401 фикс

### Сделано за сессию 17.05.2026:

#### 1. Баг — manufacturedCountryId не отправлялся в Teksher API
- Поле страны производства не попадало в payload `create_product` action
- Фикс: добавлен `manufacturedCountryId: countryId || undefined` в payload в edge function
- Edge function задеплоена (новая версия)

#### 2. Countries таблица + кэш
- `supabase/patch_countries.sql`: создана таблица `countries(teksher_id integer PK, name text, code text, synced_at timestamptz)`
- SQL применён в production
- action `countries`: DB-first (Supabase) → fallback на Teksher API + upsert
- action `refresh_countries`: принудительный sync с Teksher API + upsert в countries
- Кнопка «Обновить ТН ВЭД» теперь дополнительно вызывает `refresh_countries`

#### 3. KizPage.tsx — форма создания товара
- Состояния: `cpCountry`, `cpCountryId`, `cpTeksherTnvedId`, `countries: CountryItem[]`
- SearchableSelect для поля «Страна производства»
- Динамические атрибуты по ТН ВЭД: Вид товара, Размер+тип, Цвет, Состав, Целевой пол, Модель/артикул, Номер регламента
- GCP/GLN автоматически из `/participants/{id}/identifiers`
- Ошибки от Teksher API пробрасываются как есть в UI

#### 4. 401 Unauthorized — фикс
- `invoke()` в `KizPage.tsx`: явный `await supabase.auth.getSession()` перед каждым вызовом
- Свежий `access_token` → `Authorization: Bearer {token}` header → edge function получает валидный JWT
- Все 401 ошибки при загрузке страницы устранены

#### 5. Гайд — обновлён
- Этап 3: расширен список деталей и API для регистрации товара

---

## Teksher Edge Function — ключевые детали
- Файл: `supabase/functions/teksher-auth/index.ts`
- Проект: `jzucxqakvgzpgtvagsnq`
- Base: `https://label.teksher.kg/facade`, API: `/api/v1`
- Auth: `POST /facade/oauth/login` с `{ username, password }` → `data.access_token`
- **QR:** `POST /api/v1/qrcode?productGroupAlias={productGroup}` → `{ data: "<qr-string>", status: "SUCCESS" }`
- `productGroup` берётся из billing balance endpoint (`entries[0].productGroup`)
- Actions: `connect`, `disconnect`, `stats`, `products`, `codes`, `operations`, `operation_ready`, `emit`, `utilise`, `create_product`, `publish_product`, `participant_info`, `topup_qr`, `countries`, `refresh_countries`

## Teksher — тестовые credentials
- user: `user15634` / `Alymbek1991@!!!`, participantId=438752596, productGroup="lp"
- Реальный аккаунт: ABU MEN (Ашимов Кадырали Курсанбаевич), participantId=194177927
- Store "Move on": подключён, teksher_login установлен, ID участника: 438752596

---

## Предыдущий фокус (14.05.2026) — KizPage доработки + Auth + PhotoThumb

### Сделано за сессию (итого):

#### 1. WB энричмент через vendor_code
- `vendorCodeFromFullName(fullName)` — обрезает `, р.M` суффикс → vendor_code для матчинга с WB
- `wbByVendorCode: Map<string, WBProductInfo>` — ключ `vendor_code`
- Цвет: парсится из Teksher `fullName` regex `/цвет\s+(.+?)(?:,\s*р\.|$)/i` (list API возвращает `attributes:null`)

#### 2. KizPage — правильные колонки из Teksher + WB
11 колонок: Фото (WB) | GTIN (Teksher) | Арт.WB | Арт.продавца (WB) | Название GTIN (Teksher fullName) | Бренд (WB) | Цвет (Teksher regex) | Страна (Teksher manufacturedCountry.name) | Производитель (Teksher manufacturerFullName) | Предмет (WB category) | Статус (Teksher → рус.)

Русские статусы (`TEKSHER_STATUS_RU`): PUBLISHED→Опубликован, ACTIVE→Активен, DRAFT→Черновик, ARCHIVED→Архивирован, WITHDRAWN→Отозван, BLOCKED→Заблокирован, CLOSED→Закрыт

`subTab` сохраняется в localStorage (`elestet-kiz-subtab`)

#### 3. PhotoThumb — шаред компонент
- `src/components/ui/PhotoThumb.tsx` — миниатюра товара с hover-превью 288×384px через portal
- Props: `url`, `className` (def `'h-9 w-9 rounded-lg'`)
- `ProductsPage.tsx` использует `<PhotoThumb url={url} />`

#### 4. Auth страница — улучшения
- Eye-кнопка на Пароле (оба режима) и Подтвердите пароль (только регистрация)
- Поле «Подтвердите пароль» — `invisible pointer-events-none` при входе (не `hidden`) — поля не смещаются
- Валидация: `password !== confirmPassword` → ошибка перед submit
- Равная высота: `minHeight:600px` карточка + `flex-1` форма + `mt-auto` кнопка

#### 5. KizPage — Инфо модалка (owner-only) + 3 таба ← СВЕЖЕЕ
- **Кнопка «Инфо»** рядом с «Подробно» (у строки «КАК ЭТО РАБОТАЕТ?»)
- Видна только при `isAdmin === true` (sydykovsam@gmail.com)
- 3 таба: **Статусы** | **Формат GS1** | **Ссылки**
- 3 блока перенесены из главной страницы KizPage в модалку (главная стала чище)
- Модалка: `!w-[60vw] !max-w-none min-h-[65vh]`
- State: `infoModalOpen: boolean`, `infoTab: 'statuses' | 'format' | 'links'`
- isAdmin цепочка: `App.tsx → StickersPage (isAdmin prop) → KizPage (isAdmin prop)`

---

## Teksher — система маркировки КР (ИСА ЦРПТ)


#### Данные компании Ашимов Кадырали
- ИНН: 22101199601390, participantId: 9ac0c6be52c143d39d1e0d0965ac24a8
- Товаров: 407, Операций: 1496
- Баланс КИЗ: 30 шт. / 20.48 сом (одежда, группа LP RF — Россия)
- Товарный знак: ABU MEN, код ТН ВЭД: 6203120000
- GTIN формат: 047038049XXXXX (GCP: 470380490, GLN: 4703804900007)

#### Pedant.kg — что это
- URL: `pedant.kg` — платный UI поверх Teksher
- Два аккаунта (компании): ОсОО АЭРОН + Ашимов Кадырали
- Интеграция Teksher стоит: 4 000 сом/мес
- Нет своего API (был `/ru/api` → 404)
- Операции делаются через Pedant → он вызывает label.teksher.kg/facade/...
- Баланс АЭРОН: 732 шт. / 498.15 сом

#### Полный цикл маркировки
```
1. Регистрация карточки товара (один раз)
   → Teksher присваивает GTIN-14 каждому (артикул + цвет + размер)

2. Заказ на эмиссию КМ (POST операция EMISSION)
   → Teksher генерирует N КИЗ кодов, списывает деньги
   → коды в статусе ISSUED

3. Печать стикеров с DataMatrix кодом
   → распечатать каждый код → наклеить на единицу товара

4. Регистрация Нанесения (POST операция MARKING)
   → Teksher переводит коды ISSUED → APPLIED

5. Регистрация трансграничной отгрузки (Трансгран)
   → при отправке партии в Россию

6. Продажа в РФ — сканирование при продаже
   → Честный Знак РФ: APPLIED → SOLD
```

#### Для интеграции ELESTET (этап Маркировка в фулфилменте)
```
1. GET /facade/api/v1/products?... → найти GTIN по артикулу
2. GET /facade/api/v1/marking_codes/filter?gtin=...&status=ISSUED → получить доступные КИЗ
3. Распечатать стикеры (наш модуль стикеров уже умеет DataMatrix)
4. POST операция MARKING → подтвердить нанесение в Teksher
```

---

## Current Focus (13.05.2026) — обновлено

### Фулфилмент — этап Упаковка (Packaging) (13.05.2026)

Реализован полный этап **Упаковка** (`'packaging'`) между ОТК и Маркировкой.

**Изменения в STAGE_ORDER:**
```ts
['reception', 'otk', 'packaging', 'marking', 'packing', 'logistics', 'done']
```
`advanceStage` в `fulfillmentService.ts` включает `'packaging'` в order-массив и skip-map (`packaging: !batch.stage_packaging`).

**Новый тип:**
```ts
interface FulfillmentPackagingLog extends FulfillmentOtkLog {
  consumable_id: string | null
}
```

**Новые сервисные функции** (после `deleteBatchConsumable` в `fulfillmentService.ts`):
- `fetchPackagingLogs(batchId)`
- `addPackagingLog(entry)` — включает `consumable_id`
- `updatePackagingLog(id, patch)`
- `deletePackagingLog(id)` — soft-delete
- `uploadPackagingPhoto(accountId, batchId, file)`

**UI этапа Упаковка** (`viewStage === 'packaging'`):
- **Зип-пакеты**: переключатель «Все товары» / «Указать вручную» + инпут + кнопка «Сохранить»
- **Работа**: журнал работ (аналог ОТК/Маркировки): исполнитель, тариф, расходник (dropdown), кол-во/брак, фото
- Буфер (amber-карточки), кнопка «+ Добавить работу», Итого-бар
- **Расходники**: отдельного блока НЕТ (удалён), расходник выбирается в модале «Добавить работу»

**UI этапа Короба** (`viewStage === 'packing'`):
- Добавлен блок **Зип-пакеты** сверху (такой же UI как на этапе Упаковка)

**Dashboard stats** при `viewStage === 'packaging'`:
- Принято / ОТК итого / Упаковка split-card [Упаковано / Браки / Итого] / Расхождение

**SQL-патчи** (⚠️ применить в Supabase Dashboard):
1. `supabase/patch_packaging_logs.sql` — создаёт таблицу `fulfillment_packaging_logs`
2. `supabase/patch_packaging_logs_consumable.sql` — добавляет `consumable_id uuid references consumables(id) on delete set null`

---

## Previous Context (11.05.2026)

### Android-баг: обесцвечивание интерфейса (11.05.2026)
**Проблема:** На планшете E60 (Android 12, Chrome 105 с флагом `--disable-composited-antialiasing`) `‑webkit‑font‑smoothing: antialiased` на `:root` вызывало обесцвечивание всего UI.
**Решение:** `@media (pointer: coarse)` переопределяет оба smoothing-свойства в `auto`. Сенсорные устройства = `pointer: coarse`; macOS + мышь = `pointer: fine` (не затронуто).

```css
@media (pointer: coarse) {
  :root {
    -webkit-font-smoothing: auto;
    -moz-osx-font-smoothing: auto;
  }
}
```

**Файл:** `src/styles.css`

---

### Справочники — Склады назначения: сортировка + D&D (11.05.2026)
**Компонент `WarehousesPanel`** в `DirectoriesPage.tsx`:
- Кнопка «Алфавитный порядок» (lines-icon) и «Свой порядок» (6-dots-icon) в шапке
- Активная кнопка: `bg-blue-50 text-blue-500`; неактивная: **`text-slate-400 hover:text-slate-700`** (было `slate-300/slate-500` — слишком блёкло)
- Режим `alpha`: `useMemo` сортировка по `name`
- Режим `custom`: drag-and-drop через HTML5 native `draggable` API (`onDragStart/Over/Drop/End`)
- Порядок и режим сохраняются в `localStorage` (`warehouse_sort_mode`, `warehouse_order_{accountId}`)

---

### Sidebar — формат ID компании (11.05.2026)
Изменён формат: было `C-1`, стало **`ID: C-1`** (в двух местах `Sidebar.tsx`).

---

### ProductsPage — вкладка Браки (11.05.2026)
- **Автозагрузка** из `fulfillment_marking_logs` где `qty_defect > 0`
- Только чтение, нет ручного ввода
- Шапка: 4 чипа статистики (Позиций / Всего браков rose-500 / Баркодов / Партий)
- Таблица: Дата | Партия (П-N) | Баркод | Кол-во брак
- Фильтр по магазину (все магазины, не только с API-ключом)
- Сервис: `fetchMarkingDefectsByStore` + `MarkingDefectRow` в `fulfillmentService.ts`

---

### InvoicesPage — Расходники (11.05.2026)
- Добавлена третья карточка «Расходники» → `grid-cols-3` (было `grid-cols-2`)
- Пустая таблица-заглушка «Расходники не добавлены»
- Фикс share-кнопки: добавлен `font-[inherit]` на `<button>` (браузеры не наследуют font для кнопок)

---

### WB склады (11.05.2026)
- SQL `patch_wb_system_warehouses.sql` — удалены строки `?????` + вставлены 120+ реальных складов WB + 5 международных (Алматы, Астана, Бишкек, Минск, Ташкент)
- `ON CONFLICT DO NOTHING` — пользовательские склады не тронуты
- ✅ Применён в production

---

### Тарифы работ — Логистика: склад + цена за кг (11.05.2026)

**`WorkTariffsPanel` в `DirectoriesPage.tsx`:**

**Поле «Выбрать склад»** для стейджей `logistics_rf` и `wb_unload`:
- Кастомный компонент `WarehouseSearchSelect` (не нативный `<select>`)
- Поиск по подстроке в любом месте названия (нечувствительный к регистру)
- Позиционирование через `fixed` + `getBoundingClientRect()` — выходит за пределы `overflow:hidden` родителей
- Открывается вниз, если не помещается — вверх
- При открытии фокус автоматически переходит в поле поиска
- Enter — выбирает первый из отфильтрованных; Esc — закрывает

**Поле «Цена / за кг»** (только для логистических стейджей):
- Новая колонка в таблице: «Заказчику / цена / за кг»
- В форме добавления — второй инпут рядом с «за короб»
- БД: `patch_work_tariffs_price_per_kg.sql` — `add column price_per_kg numeric default 0`
- ⚠️ **Применить в Supabase**

**UX-правки всего `WorkTariffsPanel`:**
- Форма добавления тарифа **перемещена вверх** (под «Валюта раздела»), список тарифов — ниже
- Шапка таблицы **всегда видна** (пустое состояние = строка `<tr>` с `colSpan` внутри `<tbody>`)

---

### Тарифы работ — двойная цена + hover-редактирование (10.05.2026)

**`WorkTariffsPanel` в `DirectoriesPage.tsx`:**
- Три колонки цен: **Заказчику** (`price_per_unit`), **Исполнителю** (`price_worker`, зелёный), **Старшему** (`price_senior`, синий)
- БД: `supabase/patch_work_tariffs_worker_senior.sql` ✅ применён
- **Клик по ячейке** — edit-режим с фокусом; auto-save on blur 120ms; Escape — отмена
- **Право `directories_tariff_manage`**: отдельно от `directories_manage`
  - ⚠️ SQL: `supabase/patch_roles_tariff_manage.sql` запустить в Supabase

**БД**:
- `accounts.short_id integer` — глобальный SERIAL, SQL: `patch_accounts_short_id.sql` ✅ применён
- `fulfillment_batches.short_id integer` — per-account через триггер `assign_batch_short_id()`, SQL: `patch_batches_short_id.sql` ✅ применён
- RPC `get_my_accounts` и `get_my_archived_accounts` обновлены — возвращают `short_id`

**Фронтенд**:
- `App.tsx`: парсит URL при первом рендере, переключает аккаунт по `accountShortId`, передаёт `initialBatchShortId` + `onBatchUrlConsumed` в FulfillmentPage
- `FulfillmentPage.tsx`: при открытии модалки → `navigate('/fulfillment/C-{n}/P-{m}')`, при закрытии → `navigate('/fulfillment')`; авто-открытие партии из URL после загрузки
- `FulfillmentBatch.short_id: number | null` добавлен в типы
- П-N в таблице берётся из `batch.short_id` (не из локальной нумерации)

**Кнопка «Поделиться»** в шапке BatchDetailModal:
- Иконка share (три точки с линиями), слева от «История»
- Клик → dropdown с тремя пунктами:
  - Telegram (открывает `t.me/share/url?url=…` в новой вкладке)
  - WhatsApp (открывает `wa.me/?text=…` в новой вкладке)
  - «Копировать ссылку» — иконка цепочки, при копировании 2 сек показывает зелёную птичку, текст не меняется
- Закрывается по клику снаружи через `useEffect` + `shareRef`
- Скрыта если `accountShortId` или `batch.short_id` равно null

### Дневник — UI и навигация
- **Кнопка "Дневник"** перенесена из сайдбара в Topbar (рядом со "Словарь" и "Админ", только для `my_role === 'owner'`)
- **Клик по дате** в таймлайне теперь только выбирает дату (`setSelectedDate`), без перехода к записи
- **`openEntry(date)`** — новая функция: выбирает дату + переходит к записи; вызывается кнопкой «+ Запись» и кнопкой «Открыть» в карточках таймлайна
- **`openToday()`** использует `openEntry` (кнопка сегодня — переходить нужно)

### Topbar — рефактор
- Убран prop `onBack`, добавлен `onHomeClick`
- «Домой» стоит в правом блоке слева от трёх кнопок (Дневник / Словарь / Админ)
- Три кнопки всегда видны — не зависят от страницы
- Сайдбар скрывается на страницах `admin`, `glossary`, `diary`
- На этих трёх страницах появляется кнопка «Домой» левее трёх кнопок

### Компании — автосоздание, защита, переключение при удалении
- **Auto-create**: если после загрузки `accounts.length === 0` — автоматически создаётся «Основная компания» (useEffect в App.tsx)
- **Защита от удаления последней**: в `useAccounts.deleteAccount` — проверка `accounts.length - 1 === 0`, бросает ошибку; кнопка в сайдбаре `disabled` + `opacity-40`
- **Переключение ДО удаления**: при удалении активной компании `App.tsx` сначала находит следующую компанию по дате создания и переключается на неё, затем вызывает `deleteAccount`. Это предотвращает null-флэш (`activeAccount = null`) который очищал все данные.
- SQL-патч `supabase/cleanup_archived_accounts.sql` — ручная очистка архива для sydykovsam@gmail.com

### Дропдаун компаний — Portal + архивная модалка
- Рендерится через `createPortal(…, document.body)` с `position:fixed` + координатами от `getBoundingClientRect()`
- Не ограничен шириной сайдбара, `z-index: 9999`, `max-h-[50vh]`
- `triggerRef` на кнопку-триггер, `dropdownRef` на portal-div (оба учитываются при click-outside)
- Позиция пересчитывается при скролле
- **Архивные компании вынесены в отдельную модалку**: в конце дропдауна кнопка «Архив» → открывает modal (Portal, z-10000) со списком архивных и кнопками «Восстановить»

### API-ключи — защита от браузерного сохранения
Все поля API-ключей (WB, Claude, OpenAI) имеют:
- `autoComplete="new-password"`
- `data-lpignore="true"` (LastPass)
- `data-1p-ignore` (1Password)

**Затронутые файлы:** `DiaryPage.tsx`, `AiSettingsModal.tsx`, `StoreFormModal.tsx`

### TypeScript / Build
- `SpeechRecognition` объявлен в `src/vite-env.d.ts` — исправлена ошибка `TS2552` на Vercel (TypeScript DOM lib не содержит SpeechRecognition в части конфигураций)

## Следующие возможные шаги
- **Вкладка «Браки»** в ProductsPage — реализовать функционал (сейчас заглушка)
- **Вкладка «Сотрудники»** в Справочниках — список исполнителей с назначением роли (сотрудник/старший), для будущей системы расчёта зарплат
- Отмена партии (смена status = 'cancelled')
- Фильтр по статусу в Логистике (дропдаун «Все статусы» пока декоративный)
- SQL-патч `patch_auto_account.sql` — триггер в Supabase для автосоздания компании при регистрации
- ⚠️ Запустить `supabase/patch_roles_tariff_manage.sql` в Supabase (если ещё не выполнено)

## Фиксированный порядок дат (02.05.2026) — НИКОГДА НЕ МЕНЯТЬ
1. Приём (`reception_date`)
2. Отправлен (`transit_at`)
3. Прибыл (`arrival_date`)
4. Отгружен (`shipped_date`)
5. Запланирован (`marketplace_delivery_date`)
6. Приём ВБ (`wb_acceptance_date`)

**Логика колонок:** max 3 строки в колонке (w-[148px]). Видимые даты фильтруются из `lineHidden`, автоматически распределяются в колонки по 3 методом chunk. При скрытии любых дат оставшиеся заполняют колонки по порядку без пропусков.
Реализовано в `TripTable.tsx` через IIFE (`DATE_ITEMS` → filter → chunk by 3 → cols.map).

## What Was Recently Done

### Фулфилмент — UX-полировка CreateBatchModal (03.05.2026)

**Изменения в `src/pages/FulfillmentPage.tsx`:**
- **EditBatchModal** — новый компонент: полная копия формы создания, предзаполненная данными партии (название, магазин, 4 этапа). Открывается по иконке карандаша в строке партии. Сохраняет через `updateBatch`.
- **Выбор магазина** — заменён native `<select>` на кастомный searchable modal picker (z-[60]):
  - Поиск по названию и коду магазина
  - `+ Создать магазин` → вложенная модалка (z-[70]) с полями Название + Код
  - Выбранный магазин показывается как кнопка в форме (клик открывает picker повторно)
  - Stopropagation на всех вложенных модалках (родитель не закрывается)
  - **Удалён вариант «— без магазина —»** из списка
- **Вкладки кнопок**:
  - Слева: **«Создать и закрыть»** (`bg-slate-700` тёмная) — создаёт и возвращается в список
  - Справа: «Отмена» + **«Далее»** (синяя) — создаёт и открывает BatchDetailModal
- **Подтверждение без магазина** — при отправке без выбранного магазина показывается modal (z-[60]):
  - «Выбрать магазин» — возвращает к форме
  - «Продолжить» — создаёт партию без магазина
- **Этапы по умолчанию** — все 4 этапа (ОТК, Маркировка, Формирование, Логистика) инициализируются как `false`, берутся из `settings`
- **Маркетплейс** — только `Wildberries` в `marketplaceOptions` (`src/lib/constants.ts`)

### Фулфилмент — полная реализация (03.05.2026)

**Архитектура:**
- `FulfillmentPage` — список партий, фильтр по статусу (Все/В работе/Завершена/Отменена), кнопки создания и настроек
- `CreateBatchModal` — название (дефолт «Партия ДД.ММ.ГГГГ»), магазин, 4 тоггла этапов; Приёмка залочена всегда
- `BatchDetailModal` — прогресс-бар поверх (включённые этапы), контент меняется по `batch.current_stage`:
  - **reception**: форма добавления (баркод + авто-лукап + название + размер + кол-во), таблица позиций с inline-редактированием кол-ва
  - **otk / marking**: `StageQtyTable` — editable кол-во по каждой позиции
  - **packing**: таблица с qty_packed + boxes на позицию, итоги
  - **logistics**: карточки итогов + селекторы рейса/поставки → preview изменений → `onEditTripLine`
  - **done**: карточки итогов + зелёный экран завершения
- `SettingsModal` — дефолтные этапы для компании, сохраняет в `fulfillment_settings`

**Ключевые детали:**
- `getEnabledStages(batch)` — строит массив активных этапов, пропуская отключённые
- `advanceStage(batch)` — в сервисе: вычисляет следующий включённый этап, логирует переход в `fulfillment_stage_logs`, вызывает `updateBatch`
- `lookupProductByBarcode(accountId, storeId, barcode)` — `.contains('barcodes', [barcode])`, парсит `sizes[*].skus`
- Авто-лукап срабатывает при длине баркода ≥ 8 символов И наличии `store.api_key`
- При передаче в логистику вызывается `onEditTripLine` из `App.tsx` (обновляет state рейса без перезагрузки)
- `trip_line_id` в `fulfillment_batches` — след. итерация: бейдж «привязана» в колонке Логистики

**Баг-фикс StickersPage (03.05.2026):**
- `storesWithKey` использовалась в JSX без объявления → ReferenceError → белый экран
- Фикс: `const storesWithKey = stores.filter((s) => s.api_key)` добавлено в StickersPage.tsx

### Колонка "Даты" — полный рефактор (02.05.2026)
Колонки поставки объединены: вместо отдельных Дата приёма / Прибыл / Отгружен / Дата МП — единая колонка **Даты** с двумя подстолбцами:

**Левый подстолбец (ручные даты):**
- **Приём** (`reception_date`) — дата приёма груза; дефолт = сегодня в форме создания
- **Отправлен** (`transit_at`) — устанавливается автоматически при смене статуса на «В пути»
- **Прибыл** (`arrival_date`) — устанавливается при статусе «Прибыл»

**Правый подстолбец (дата отгрузки + данные из WB API):**
- **Отгружен** (`shipped_date`) — при статусе «Отгружен»
- **Запланирован** (`planned_marketplace_delivery_date`) — плановая дата поставки (`supplyDate` из WB API); редактируется вручную через `MpDateButton` (иконка карандаша)
- **Приём ВБ** (`wb_acceptance_date`) — фактическая дата принятия на складе WB (`factDate` из WB API); только авто

**Новые поля в БД:**
- `transit_at date NULL` — SQL: `supabase/patch_transit_at.sql` ⚠️ применить вручную
- `wb_acceptance_date date NULL` — SQL: `supabase/patch_wb_acceptance_date.sql` ⚠️ применить вручную

**Edge Function `wb-supply` (action=mp_date):**
- Вызывает `GET /api/v1/supplies/{id}` (эндпоинт WB Supplies API)
- `supplyDate` → `planned_marketplace_delivery_date` (Запланирован)
- `factDate` → `wb_acceptance_date` (Приём ВБ)
- Оба поля сохраняются в БД и обновляются в state одним запросом

**UI:**
- Оба подстолбца `w-[148px] shrink-0` — фиксированная ширина, не схлопываются при пустых датах
- Лейблы `w-[68px]` — единая ширина в обоих подстолбцах
- `MpDateButton`: иконка карандаша (ручной ввод) + иконка обновления (из WB API, только при наличии wb_supply_id)
- Статус-бейдж под статусом поставки показывает дату по статусу: Формируется→created_at, Ожидает→waiting_at, В пути→transit_at, Прибыл→arrival_date, Отгружен→shipped_date

### Иконки статуса оплаты + тип груза (02.05.2026)
- **StatusDropdown**: `iconMap?: Record<T, React.ReactNode>` — иконки рендерятся внутри цветного pill в меню (единый `inline-flex` со спаном иконки и текстом)
- **Тип груза**: WbSupplyIdButton — при сохранении wb_supply_id авто-запрашивает cargo_type; матч по `lineId` (не wb_supply_id) для правильного обновления стейта

## Фиксированный порядок дат (02.05.2026) — НИКОГДА НЕ МЕНЯТЬ
1. Приём (`reception_date`)
2. Отправлен (`transit_at`)
3. Прибыл (`arrival_date`)
4. Отгружен (`shipped_date`)
5. Запланирован (`marketplace_delivery_date`)
6. Приём ВБ (`wb_acceptance_date`)

**Логика колонок:** max 3 строки в колонке (w-[148px]). Видимые даты фильтруются из `lineHidden`, автоматически распределяются в колонки по 3 методом chunk. При скрытии любых дат оставшиеся заполняют колонки по порядку без пропусков.
Реализовано в `TripTable.tsx` через IIFE (`DATE_ITEMS` → filter → chunk by 3 → cols.map).

## What Was Recently Done

### Колонка "Даты" — полный рефактор (02.05.2026)
Колонки поставки объединены: вместо отдельных Дата приёма / Прибыл / Отгружен / Дата МП — единая колонка **Даты** с двумя подстолбцами:

**Левый подстолбец (ручные даты):**
- **Приём** (`reception_date`) — дата приёма груза; дефолт = сегодня в форме создания
- **Отправлен** (`transit_at`) — устанавливается автоматически при смене статуса на «В пути»
- **Прибыл** (`arrival_date`) — устанавливается при статусе «Прибыл»

**Правый подстолбец (дата отгрузки + данные из WB API):**
- **Отгружен** (`shipped_date`) — при статусе «Отгружен»
- **Запланирован** (`planned_marketplace_delivery_date`) — плановая дата поставки (`supplyDate` из WB API); редактируется вручную через `MpDateButton` (иконка карандаша)
- **Приём ВБ** (`wb_acceptance_date`) — фактическая дата принятия на складе WB (`factDate` из WB API); только авто

**Новые поля в БД:**
- `transit_at date NULL` — SQL: `supabase/patch_transit_at.sql` ⚠️ применить вручную
- `wb_acceptance_date date NULL` — SQL: `supabase/patch_wb_acceptance_date.sql` ⚠️ применить вручную

**Edge Function `wb-supply` (action=mp_date):**
- Вызывает `GET /api/v1/supplies/{id}` (эндпоинт WB Supplies API)
- `supplyDate` → `planned_marketplace_delivery_date` (Запланирован)
- `factDate` → `wb_acceptance_date` (Приём ВБ)
- Оба поля сохраняются в БД и обновляются в state одним запросом

**UI:**
- Оба подстолбца `w-[148px] shrink-0` — фиксированная ширина, не схлопываются при пустых датах
- Лейблы `w-[68px]` — единая ширина в обоих подстолбцах
- `MpDateButton`: иконка карандаша (ручной ввод) + иконка обновления (из WB API, только при наличии wb_supply_id)
- Статус-бейдж под статусом поставки показывает дату по статусу: Формируется→created_at, Ожидает→waiting_at, В пути→transit_at, Прибыл→arrival_date, Отгружен→shipped_date

### Иконки статуса оплаты + тип груза (02.05.2026)
- **StatusDropdown**: `iconMap?: Record<T, React.ReactNode>` — иконки рендерятся внутри цветного pill в меню (единый `inline-flex` со спаном иконки и текстом)
- **Тип груза**: WbSupplyIdButton — при сохранении wb_supply_id авто-запрашивает cargo_type; матч по `lineId` (не wb_supply_id) для правильного обновления стейта

## What Was Recently Done

### Стикеры 2в1 + UI-полировка TripLineStickerCell (01.05.2026)
- **`supabase/patch_combined_stickers.sql`**: новая колонка `combined_sticker_urls text[] DEFAULT '{}'` в `trip_lines` — **применено ✅**
- **`src/types/index.ts`**: добавлено поле `combined_sticker_urls: string[]` в интерфейс `TripLine`
- **`src/services/tripService.ts`**: добавлены `uploadCombinedStickerFile` (бакет `trip-stickers`, суффикс `_combined`) и `updateTripLineCombinedStickerFiles`
- **`src/hooks/useAppData.ts`**: добавлены `getCombinedStickerUrls`, `applyCombinedStickerUrls`, `addCombinedStickerFile`, `removeCombinedStickerFile`; экспортированы в return
- **`src/components/trips/TripTable.tsx`**: добавлены props `onAddCombinedStickerFile` / `onRemoveCombinedStickerFile`; переданы в `TripLineStickerCell` как `combinedUrls`, `onAddCombined`, `onRemoveCombined`
- **`src/pages/ShipmentsPage.tsx`** + **`src/App.tsx`**: props пробрасываются по цепочке
- **`src/components/ui/TripLineStickerCell.tsx`**: полный UI-оверхол:
  - **Виолетовая группа (2в1)**: кнопка «просмотр» + кнопка «загрузить файл», badge со счётчиком, dropdown-меню с датой загрузки, удаление файлов
  - **UI-полировка**: badge горизонтально центрированы (`left-1/2 -translate-x-1/2`); hover-цвета выровнены (синий `hover:bg-blue-100`, изумрудный `hover:bg-emerald-100`); badge на кнопке пропуска (emerald)
  - **Меню snapshot**: при открытии замораживает список файлов → удаление не схлопывает меню
  - **Удаление по URL**: `fileUrls.indexOf(url)` вместо индекса из snapshot → правильный файл удаляется
  - **Стабильная позиция меню**: при открытии сбрасывается в `{-9999,-9999}` → `useLayoutEffect` пересчитывает → убирает артефакт старой позиции
  - **Viewport clamping**: все три меню не выходят за края экрана (отступ 8px, проверка право/низ/верх)
  - **Цветовая схема**: violet = 2в1; blue = скачать/QR; emerald = пропуск
  - **Порядок кнопок** (слева направо): `[2в1 view | 2в1 upload] [sticker download | QR] [pass view | pass upload]`

### Стикеры QR-кодов поставки WB + кнопка пропуска (30.04.2026)
- **Edge Function `wb-supply`**: генерирует PDF с QR-кодами коробов поставки WB
  - Эндпоинт: `GET /api/v1/supplies/{ID}/package` (единственный рабочий; `/passes` → 404)
  - 1 страница на коробку (packageCode), 58×40мм (164.4×113.4pt)
  - QR-код генерируется через `qrcode-generator@1.4.4`, PDF — через `pdf-lib@1.17.1`
  - Коробки сортируются по числовой части `packageCode` по возрастанию
  - Ошибки: 401 / 403 / 404 → читаемые сообщения на русском
  - Файл загружается в бакет `trip-stickers`, URL добавляется к `sticker_file_urls`
  - Деплой: `supabase functions deploy wb-supply --project-ref jzucxqakvgzpgtvagsnq`
- **Кнопка «WB»** в `TripLineStickerCell`: открывает попап с полем ID поставки → вызывает Edge Function
  - Фиолетовая если `wb_supply_id` задан, серая — нет
  - Toast «Штрихкоды WB загружены в стикеры поставки» (success, зелёный)
- **Кнопка «Пропуск»** в `TripLineStickerCell` (новое, 30.04.2026):
  - Серая — пропуск не загружен, кликнуть → file picker (только PDF)
  - Зелёная — загружен, кликнуть → открывается в новой вкладке; рядом кнопка замены
  - Хранится в `trip-stickers` бакете с суффиксом `_pass` в имени
  - `wb_pass_url` — отдельная колонка в `trip_lines` (не входит в `sticker_file_urls`)
  - SQL: `supabase/patch_wb_pass_url.sql` — применён в Supabase ✅
- **`supabase/functions/wb-supply/index.ts`**: полностью переписан (убрана логика `/passes`, `_debug_passes`)
- **`src/hooks/useAppData.ts`**: удалён debug console.log; добавлена функция `uploadWbPass`
- **`src/services/tripService.ts`**: добавлены `uploadWbPassFile`, `updateTripLineWbPassUrl`
- **`src/types/index.ts`**: добавлено поле `wb_pass_url: string | null` в `TripLine`
- **Меню стикеров**: дата/время загрузки в формате `DD.MM.YYYY HH:MM GMT+N`
- **Badge**: показывается от 1 файла, кнопка скачивания всегда открывает меню

### Архив компаний + архив магазинов (29.04.2026)
- **`supabase/patch_archive_accounts.sql`**: добавлен `deleted_at` к `accounts`; `get_my_accounts` фильтрует `deleted_at IS NULL`; RLS политика обновлена; `delete_account_with_owner` теперь soft delete; `hard_delete_expired_accounts()` + pg_cron задание (03:00 UTC ежедневно)
- **`supabase/patch_archive_stores.sql`**: добавлен `deleted_at` к `stores`; RLS политики обновлены; создана RPC `archive_store(p_store_id uuid)`; FK `trip_lines.store_id` изменён с RESTRICT → SET NULL; `hard_delete_expired_stores()` + pg_cron задание (03:10 UTC)
- **`src/components/accounts/DeleteAccountModal.tsx`**: переписан через `DeleteConfirmModal` — поле пароля + отображение ошибки + описание «15 дней в архиве»
- **`src/App.tsx`**: импортирован `supabase` клиент; добавлены `deleteAccountPassword` + `deleteAccountError` state; `handleConfirmDeleteActiveCompany` теперь верифицирует пароль через `signInWithPassword` перед архивацией
- **`src/services/storeService.ts`**: `fetchStoresFromSupabase` → добавлен `.is('deleted_at', null)`; `deleteStoreInSupabase` → вызывает RPC `archive_store` вместо прямого удаления
- **Правила (системные, не изменяются пользователем)**:
  - Удаление компании: только владелец + обязательный ввод пароля + 15 дней в архиве
  - Удаление магазина: управляется ролью (`canManage`) + пароль (уже требовался) + 15 дней в архиве

### Фикс TS-ошибок сборки Vercel + мелкие UI (29.04.2026)
- **`StickersPage.tsx`**: `globalIcons` state — добавлен явный тип `useState<{...}>` (фикс TS7006 + symbol key), добавлено `country: ''` в объект при импорте из WB (фикс TS2345)
- **`tripService.ts`**: `.update({ sticker_file_urls } as any)` — cast для Supabase-типов, не знающих о новой колонке (фикс TS2353)
- **`ProductsPage.tsx`**: счётчик «Товары» → «Артикулы»; счётчик «Артикул (кол-во уникальных vendor_code)» → «Баркоды (сумма всех barcodes)`

### UI-полировка StickersPage + ReviewsPage (29.04.2026)
- **`StickersPage.tsx`** — тулбар:
  - Кнопка «Дата производства»: кастомная кнопка + скрытый `<input type="date">` внутри, клик вызывает `showPicker()`. Показывает `дд.мм.гггг` или `ДД.ММ.ГГГГ`. Стиль `bg-[#F3F6FD]`, ширина `w-[5.5rem]` (без прыжков)
  - Порядок тулбара: `[поиск/магазин] [Создать набор (stickers)] [Скачать PDF (stickers)] [Дата] [Иконки ↓] [Создать набор (bundles/import)] [+ Создать стикер]`
  - Пре-принт модалка: редактор открывается для ЛЮБОГО кол-ва стикеров (не только одиночных). Заголовок «Редактирование (применится ко всем)» при множественном выборе
- **`src/lib/stickerPdf.ts`** — иконки ухода (стирка/утюг/не отбеливать/не тумблер) зафиксированы внизу: `iconsY = H_PX - PAD - iconSize` (не зависят от потока контента)
- **`src/types/index.ts`** — `WbFeedback`: добавлены `pros?: string | null`, `cons?: string | null`
- **`src/services/reviewsService.ts`** — `buildAiPromptParts`: добавляет `Плюсы: ...` / `Минусы: ...` перед текстом отзыва в промпт ИИ
- **`src/pages/ReviewsPage.tsx`**:
  - Карточки отзывов: показывает `Плюсы:` / `Минусы:` / текст; «Отзыв без текста» только когда все три пустые
  - Генерация ИИ (ручная + авто): передаёт `pros`/`cons` в `callOpenAi`
  - Блок автоматизации: заголовок «Автоматизация ответов» (было «Серверная автоматизация»), субтитл убран, кнопки вынесены на вторую строку под заголовок, кнопка логов — `ml-auto shrink-0` (вплотную справа, ширина по контенту)
  - Звёзды в «Тест ИИ-ответа»: `h-9 w-12`, amber-цвета active, однострочный формат `{r}★`
- **`src/components/reviews/AiSettingsModal.tsx`** — `PromptListModal`: клик по тёмному фону (backdrop) закрывает модалку (`onClick={onClose}` на overlay, `stopPropagation` на теле)

### Мульти-промпт UI + защита от случайного закрытия (27.04.2026)
- **`AiSettingsModal.tsx`**:
  - Кнопки промптов: `[список][+]` пара для системного и магазинного типов, бейдж с количеством
  - `PromptListModal` (z-60, max-w-3xl, 90vh): список промптов с полным текстом, кнопки редакт/удал на каждом, «Добавить промпт» снизу
  - `PromptAddEditModal` (z-70, max-w-3xl): поле названия + textarea `rows=12`, `minHeight: 240px`
  - `isDirty` флаг: отслеживает изменения ключей, моделей, тона, провайдера
  - При попытке закрыть с `isDirty=true` → диалог «Закрыть без сохранения?» (z-80)
- **`ReviewsPage.tsx`**: стейт `systemPrompts`/`storePrompts`, useEffect загрузки, хендлеры CRUD, передача `extraSystemPrompts`/`extraStorePrompts` в генерацию
- **`reviewsService.ts`**: `fetchAiPrompts`, `createAiPrompt`, `updateAiPrompt`, `deleteAiPrompt`; `buildAiPromptParts` конкатенирует все промпты обоих типов
- **`types/index.ts`**: добавлены `AiPrompt`, `AiPromptFormValues`
- **`supabase/patch_ai_prompts_list.sql`**: создаёт таблицу `ai_prompts` с RLS — **требует применения в Supabase SQL Editor**
- **Бренд**: убран субтитл «Supply Logistics» из Sidebar и AuthPage — логотип теперь только «ELESTET»

## What Was Recently Done

### Фикс Claude API — актуальные модели (26.04.2026)
- **Причина бага**: старые модели `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229` — deprecated и удалены Anthropic → 404
- **`src/types/index.ts`**: `ClaudeModel` обновлён: `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` | `claude-opus-4-7`
- **`src/components/reviews/AiSettingsModal.tsx`**: `CLAUDE_MODEL_OPTIONS` обновлены, дефолт `claude-sonnet-4-6`
- **`src/services/reviewsService.ts`**: улучшены сообщения ошибок Claude API (HTTP статус + detail)
- **`supabase/patch_ai_providers.sql`**: добавлен `UPDATE` — сбрасывает старые model ID на `claude-sonnet-4-6`

### Фикс isAiConfigured — провайдер-агностичная проверка ключа (26.04.2026)
- **Проблема**: везде в `ReviewsPage.tsx` проверялся `aiSettings?.openai_key` — при Claude-провайдере кнопка «ИИ-ответ» была серой
- **Решение**: добавлена `isAiConfigured` = `provider === 'claude' ? !!claude_key : !!openai_key`
- Все 7 мест заменены: guard в `handleGenerate`, guard в `handleTestGenerate`, стили кнопки, badge «ИИ настроен», банер в очереди, title кнопки «⚡ ИИ-ответ», кнопка «Перегенерировать»
- Тексты ошибок и плашек убраны «OpenAI-специфика» → универсальные формулировки

### ИИ-настройки — мульти-провайдер Claude + OpenAI (26.04.2026)
- **`src/types/index.ts`**: добавлены `AiProvider` (`openai`|`claude`), `ClaudeModel`, `AiTone` расширен (`professional`), обновлены `AiSettings` и `AiSettingsFormValues`
- **`src/services/reviewsService.ts`**:
  - `callClaudeDirect`: прямой вызов Anthropic API с Vision (base64 image blocks)
  - `callOpenAiDirect`: GPT-4o Vision через base64
  - `callOpenAi`: роутинг по `settings.provider` к claude/openai
  - `buildAiPromptParts`: системный промпт + промпт магазина (append после системного) + `storePrompt` в `AiFeedbackInput`
  - `saveStorePrompt(storeId, prompt)`: сохраняет `ai_prompt` в таблицу `stores`
  - `saveAiSettings`: сохраняет `provider`, `claude_key`, `claude_model`
- **`src/types/index.ts`**: `Store` интерфейс расширен полем `ai_prompt?: string | null`
- **`src/components/reviews/AiSettingsModal.tsx`** — полный рефакторинг:
  - Google Sheets-стиль табы: Claude (первый) / OpenAI
  - Таб = просмотр настроек; отдельный `activeProvider` state = кто генерирует
  - Кнопка «Активировать» в каждом табе (серая/disabled = уже активен, синяя = кликабельная)
  - Бейдж «активный» на активном табе
  - Оба блока настроек рендерятся одновременно в одной grid-ячейке (`[grid-area:1/1]`), неактивный `invisible` — высота не прыгает при переключении
  - Удаление API-ключей: кнопка «Удалить» (красная) → плашка «Ключ будет удалён при сохранении» + «Отменить»
  - 4 тона ответов: Вежливый / Нейтральный / Дружелюбный / Профессиональный
  - 2 кнопки промптов: «Системный промпт» + «Промпт магазина» — открывают `PromptModal` overlay (z-60)
  - `PromptModal`: draft state (Отмена = отменяет изменения), автоматически растущий textarea (max 480px), Сохранить + Отмена
  - `initialStorePrompt` + `onSaveStorePrompt` пропы
  - Все поля не обязательны для сохранения
- **`src/pages/ReviewsPage.tsx`**:
  - Активный таб (`queue`/`answered`/`templates`/`test`) сохраняется в localStorage `reviews_active_tab`
  - `storePrompt` передаётся в `callOpenAi` при генерации
  - `handleSaveStorePrompt` → вызывает `saveStorePrompt`
  - `AiSettingsModal` получает `initialStorePrompt` и `onSaveStorePrompt`
- **`tailwind.config.js`**: добавлен `zIndex: { 60: '60' }` для `PromptModal`
- **`supabase/patch_ai_providers.sql`**: применён в Supabase ✅
- **`supabase/patch_store_ai_prompt.sql`**: применён в Supabase ✅

### ИИ-ответы на отзывы WB (26.04.2026)
- **`supabase/patch_ai_reviews.sql`**: новые поля `ai_reply`, `ai_reply_status`, `reply_sent_at` в `wb_feedbacks`; новая таблица `account_ai_settings` (RLS по `account_members`)
- **`src/types/index.ts`**: добавлены `AiReplyStatus`, `AiTone`, `AiModel`, `AiSettings`, `AiSettingsFormValues`, `WbFeedbackRow`
- **`src/services/reviewsService.ts`**: добавлены `loadFeedbackRowsFromDb`, `saveAiReply`, `markReplySent`, `getAiSettings`, `saveAiSettings`, `callOpenAi`
- **`src/components/reviews/AiSettingsModal.tsx`**: модалка настройки ИИ
- **`src/pages/ReviewsPage.tsx`**: 4 вкладки (Без ответа / Отвечено / Шаблоны / Тест ИИ-ответа); `NegativeSendModal` для 1–3★
- Кнопка «⚙ ИИ настроен»: фиолетовая когда ключ настроен

### Логистика — новые поля и поведение (25.04.2026)
- Колонки trip_lines: `reception_date`, `arrival_date`, `shipped_date`, `weight`
- Автозаполнение дат, массовое «Прибыл», глобальная нумерация, режим фокуса
- SQL патч: `supabase/patch_all_in_one.sql`

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Отзывы / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Топбар: профиль-кнопка — дропдаун (Настройки / Выйти), имя + email
- ИИ провайдеры: Claude (Sonnet 4.6 / Haiku 4.5 / Opus 4.7) + OpenAI (gpt-4o-mini / gpt-4o / gpt-3.5-turbo)

## SQL патчи — порядок применения
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
20. patch_all_in_one.sql
21. patch_review_templates.sql
22. patch_wb_feedbacks.sql
23. patch_fix_wb_feedbacks_rls.sql
24. patch_ai_reviews.sql             ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
25. patch_ai_providers.sql           ← мульти-провайдер: provider/claude_key/claude_model (✅ применён)
26. patch_store_ai_prompt.sql        ← промпт магазина: ai_prompt в stores (✅ применён)
```


## What Was Recently Done

### ИИ-настройки — мульти-провайдер Claude + OpenAI (26.04.2026)
- **`src/types/index.ts`**: добавлены `AiProvider` (`openai`|`claude`), `ClaudeModel`, `AiTone` расширен (`professional`), обновлены `AiSettings` и `AiSettingsFormValues`
- **`src/services/reviewsService.ts`**:
  - `callClaudeDirect`: прямой вызов Anthropic API с Vision (base64 image blocks)
  - `callOpenAiDirect`: GPT-4o Vision через base64
  - `callOpenAi`: роутинг по `settings.provider` к claude/openai
  - `buildAiPromptParts`: системный промпт + промпт магазина (append после системного) + `storePrompt` в `AiFeedbackInput`
  - `saveStorePrompt(storeId, prompt)`: сохраняет `ai_prompt` в таблицу `stores`
  - `saveAiSettings`: сохраняет `provider`, `claude_key`, `claude_model`
- **`src/types/index.ts`**: `Store` интерфейс расширен полем `ai_prompt?: string | null`
- **`src/components/reviews/AiSettingsModal.tsx`** — полный рефакторинг:
  - Google Sheets-стиль табы: Claude (первый) / OpenAI
  - Таб = просмотр настроек; отдельный `activeProvider` state = кто генерирует
  - Кнопка «Активировать» в каждом табе (серая/disabled = уже активен, синяя = кликабельная)
  - Бейдж «активный» на активном табе
  - Оба блока настроек рендерятся одновременно в одной grid-ячейке (`[grid-area:1/1]`), неактивный `invisible` — высота не прыгает при переключении
  - Удаление API-ключей: кнопка «Удалить» (красная) → плашка «Ключ будет удалён при сохранении» + «Отменить»
  - 4 тона ответов: Вежливый / Нейтральный / Дружелюбный / Профессиональный
  - 2 кнопки промптов: «Системный промпт» + «Промпт магазина» — открывают `PromptModal` overlay (z-60)
  - `PromptModal`: draft state (Отмена = отменяет изменения), автоматически растущий textarea (max 480px), Сохранить + Отмена
  - `initialStorePrompt` + `onSaveStorePrompt` пропы
  - Все поля не обязательны для сохранения
- **`src/pages/ReviewsPage.tsx`**:
  - Активный таб (`queue`/`answered`/`templates`/`test`) сохраняется в localStorage `reviews_active_tab`
  - `storePrompt` передаётся в `callOpenAi` при генерации
  - `handleSaveStorePrompt` → вызывает `saveStorePrompt`
  - `AiSettingsModal` получает `initialStorePrompt` и `onSaveStorePrompt`
- **`tailwind.config.js`**: добавлен `zIndex: { 60: '60' }` для `PromptModal`
- **`supabase/patch_ai_providers.sql`**: `ALTER TABLE account_ai_settings ADD COLUMN IF NOT EXISTS provider/claude_key/claude_model` — ⚠️ применить в Supabase
- **`supabase/patch_store_ai_prompt.sql`**: `ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_prompt text` — ⚠️ применить в Supabase

### ИИ-ответы на отзывы WB (26.04.2026)
- **`supabase/patch_ai_reviews.sql`**: новые поля `ai_reply`, `ai_reply_status`, `reply_sent_at` в `wb_feedbacks`; новая таблица `account_ai_settings` (RLS по `account_members`)
- **`src/types/index.ts`**: добавлены `AiReplyStatus`, `AiTone`, `AiModel`, `AiSettings`, `AiSettingsFormValues`, `WbFeedbackRow`
- **`src/services/reviewsService.ts`**: добавлены `loadFeedbackRowsFromDb`, `saveAiReply`, `markReplySent`, `getAiSettings`, `saveAiSettings`, `callOpenAi`
- **`src/components/reviews/AiSettingsModal.tsx`**: модалка настройки ИИ
- **`src/pages/ReviewsPage.tsx`**: 4 вкладки (Без ответа / Отвечено / Шаблоны / Тест ИИ-ответа); `NegativeSendModal` для 1–3★
- Кнопка «⚙ ИИ настроен»: фиолетовая когда ключ настроен

### Логистика — новые поля и поведение (25.04.2026)
- Колонки trip_lines: `reception_date`, `arrival_date`, `shipped_date`, `weight`
- Автозаполнение дат, массовое «Прибыл», глобальная нумерация, режим фокуса
- SQL патч: `supabase/patch_all_in_one.sql`

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Топбар: профиль-кнопка — дропдаун (Настройки / Выйти), имя + email

## SQL патчи — порядок применения
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
20. patch_all_in_one.sql
21. patch_review_templates.sql
22. patch_wb_feedbacks.sql
23. patch_fix_wb_feedbacks_rls.sql
24. patch_ai_reviews.sql             ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
25. patch_ai_providers.sql           ← ⚠️ мульти-провайдер: provider/claude_key/claude_model
26. patch_store_ai_prompt.sql        ← ⚠️ промпт магазина: ai_prompt в stores
```

## What Was Recently Done

### ИИ-ответы на отзывы WB (26.04.2026)
- **`supabase/patch_ai_reviews.sql`**: новые поля `ai_reply`, `ai_reply_status`, `reply_sent_at` в `wb_feedbacks`; новая таблица `account_ai_settings` (RLS по `account_members`)
- **`src/types/index.ts`**: добавлены `AiReplyStatus`, `AiTone`, `AiModel`, `AiSettings`, `AiSettingsFormValues`, `WbFeedbackRow`
- **`src/services/reviewsService.ts`**: добавлены `loadFeedbackRowsFromDb`, `saveAiReply`, `markReplySent`, `getAiSettings`, `saveAiSettings`, `callOpenAi`
- **`src/components/reviews/AiSettingsModal.tsx`**: модалка настройки OpenAI (ключ, модель, тон, system prompt)
- **`src/pages/ReviewsPage.tsx`**: полный рефакторинг — 4 вкладки (Без ответа / Отвечено / Шаблоны / Тест ИИ-ответа); `NegativeSendModal` для 1–3★; генерация через `callOpenAi` + сохранение в БД; отправка через WB API; кнопка «⚙ Настройки ИИ» (фиолетовая когда ключ настроен)
- **Архитектура**: ключ OpenAI хранится в `account_ai_settings` с RLS, вызовы идут напрямую из браузера
- **UI-фикс**: header row (кнопки «Настройки ИИ» + «Синхронизировать») — всегда рендерятся на всех вкладках → высота строки не прыгает при переключении
- **Загрузка при смене магазина**: `loadFromDb` вызывается сразу в reset-эффекте → данные из БД появляются немедленно

### Отзывы WB — полная реализация (26.04.2026)
- **DB-first архитектура**: данные грузятся из `wb_feedbacks` (Supabase), кнопка «Синхронизировать» — единственная точка обращения к WB API
- **Cooldown в localStorage**: ключи `wb_feedbacks_cooldown_end` + `wb_feedbacks_fail_count` — пережигают page refresh
- **Exponential backoff**: база 60с, удваивается при 429, максимум 600с (10 мин)
- **UPSERT вместо DELETE+INSERT**: данные в БД не разрушаются при сбое синхронизации
- **RLS-фикс**: политика `wb_feedbacks` ссылалась на несуществующую таблицу `role_members` вместо `account_members` — исправлено в `patch_fix_wb_feedbacks_rls.sql` и применено в продакшн
- **WB Feedbacks API**: `GET /api/v1/feedbacks` — заголовки rate-limit всегда null, поэтому используется exponential backoff
- **Шаблоны**: CRUD в таблице `review_templates`; приоритет: ключевые слова → оценка → универсальный; флаг `is_auto`
- **matchTemplate / applyTemplate**: подстановка `{buyer_name}`, `{product_name}`, `{stars}`
- **Ручные ответы**: textarea + chips шаблонов по каждому отзыву → PATCH WB API
- **Вкладки**: Без ответа / Отвечено / Шаблоны / 🧪 Тест авто-ответа
- **Вкладка «Тест»** (dry-run): показывает для каждого отзыва из «Без ответа» — какой шаблон совпал (по ключевым словам / оценке / универсальный) и итоговый текст ответа после подстановки переменных. Ничего не отправляется. Итоговая строка: «Будет отвечено: X из Y / Без шаблона: Z»
- **Файлы**: `src/services/reviewsService.ts`, `src/pages/ReviewsPage.tsx`, `supabase/patch_wb_feedbacks.sql`, `supabase/patch_review_templates.sql`

### Логистика — новые поля и поведение (25.04.2026)
- **Колонки trip_lines**: `reception_date` (Дата приёма), `arrival_date` (Прибыл), `shipped_date` (Отгружено), `weight` (Вес кг, numeric)
- **Автозаполнение дат**: `arrival_date` → при смене статуса на «Прибыл»; `shipped_date` → при «Отгружен» (не перезаписывает вручную заданное)
- **Массовое «Прибыл»**: при смене статуса рейса → «Прибыл» все не-«Отгружен» строки получают `arrival_date = today`
- **Глобальная нумерация**: поставки нумеруются по `account_id` (не `store_id`), constraint `trip_lines_account_id_shipment_number_key`
- **Сортировка**: поставки — новые сверху (`shipment_number DESC`)
- **Вес в «Объём»**: `weight` отображается внутри колонки Объём (`120 единиц · 40 кг`), отдельной колонки нет
- **Режим фокуса**: оверлей `bg-slate-900/60` снаружи таблицы; соседние рейсы `opacity-10`
- **Границы строк**: `divide-slate-200` (было `divide-slate-100/80`)
- **SQL патч**: `supabase/patch_all_in_one.sql` — применить в Supabase SQL Editor один раз

### UI-фиксы (25.04.2026)
- Modal: `footer` prop вынесен за scroll-область; `max-h` на Card; `flex-1 min-h-0` на content
- Sidebar: `h-full overflow-hidden` — никогда не скроллится
- Layout: `html/body overflow:hidden; #root height:100%`; content — `overflow-y-scroll` (всегда виден scrollbar)
- StatusDropdown: `whitespace-nowrap` + spacer включает SVG-стрелку

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Topbar: профиль-кнопка — дропдаун (Настройки / Выйти), имя + email

## SQL патчи — порядок применения
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
20. patch_all_in_one.sql
21. patch_review_templates.sql
22. patch_wb_feedbacks.sql
23. patch_fix_wb_feedbacks_rls.sql  ← фикс RLS (account_members вместо role_members)
24. patch_ai_reviews.sql             ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
```

## What Was Recently Done

### RBAC — Ролевой контроль доступа (завершено)
- `src/types/index.ts`: добавлена константа `FULL_PERMISSIONS` (все флаги `true`)
- `src/hooks/useMyPermissions.ts` (новый файл): хук загружает эффективные права текущего пользователя
  - `owner` / `admin` → автоматически `FULL_PERMISSIONS` (без запроса к БД)
  - остальные → запрос в таблицу `roles` по `assigned_user_id + account_id`
  - если роль не найдена → `DEFAULT_PERMISSIONS` (все `false`)
- `src/components/layout/Sidebar.tsx`: принимает `permissions: RolePermissions`; каждый nav-пункт имеет `permKey`; фильтрация `.filter(item => item.permKey === null || permissions[item.permKey])`
- `src/App.tsx`: подключён `useMyPermissions`; `pagePermKey` map + `useEffect` редирект на главную если страница недоступна; `permissions` передаётся в Sidebar и все страницы как `canManage`
- `ShipmentsPage` + `TripTable`: `canManage` скрывает «+ Создать рейс», чекбоксы, bulk-кнопки, дропдауны статусов (pointer-events-none), кнопки редактирования/удаления рейсов и строк, строку «Добавить поставку», фото накладных (onAdd/onReplace/onRemove = undefined)
- `InvoicePhotoCell`: все три обработчика `onAdd?/onReplace?/onRemove?` стали опциональными; кнопки лайтбокса и контекстное меню скрыты когда обработчик не передан
- `StoresPage` + `StoreList`: `canManage` скрывает «+ Создать магазин», кнопки sync/edit/delete строки
- `DirectoriesPage` + `DirectoryPanel`: `canManage` скрывает форму добавления и кнопки редактировать/удалить каждого пункта
- `StickersPage`: `canManage` скрывает «+ Создать стикер», «Создать набор», кнопки редактировать/удалить стикеры и наборы
- `RolesPage` + `RoleRow`: `canManage` скрывает «+ Создать роль» (топ-бар + пустой state), кнопки редактировать/удалить каждой роли
- Все `canManage` props имеют `default = true` — обратная совместимость сохранена

### Стикеры — Import WB аккордеон + массовые операции (завершено)
- Вкладка «Импорт WB» полностью перестроена в аккордеон (аналог ProductsPage)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease`
- Колонка фото (миниатюра 36×36), превью по наведению (288×384px, умное позиционирование)
- Чекбокс глобальный в `<thead>` — выбирает ВСЕ size-строки по всем товарам
- Чекбокс на каждой строке товара — выбирает все его размеры / снимает их
- Чекбокс на каждой строке размера — отдельный выбор
- Кнопка «Развернуть/Свернуть все» — двойная стрелка
- «Создать набор» — создаёт стикеры для всех выбранных строк (skip дублей по баркоду), затем открывает модалку набора с pre-fill
- Уведомление «Все выбранные стикеры уже существуют» если все дубли

### Стикеры — Кастомная вкладка: массовое удаление (завершено)
- Колонка удаления выделена в отдельный `<th w-10>` правее колонки действий (eye/print/edit)
- Шапка колонки: иконка-корзина, неактивна (`opacity-30`) пока не выбрана хотя бы 1 строка
- При выборе 1+ строк кнопка активируется и открывает `<DeleteConfirmModal>` с количеством

### Страница Товары — ProductsPage (завершена)
- Таблица товаров с аккордеон-раскрытием по строке (клик на строку)
- Вложенная таблица размеров: колонки «Размер» (badge) и «Баркод»
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Выбор магазина: дропдаун, только магазины с API-ключом
- Синхронизация товаров через Edge Function `sync-store-products`
- Колонка фото: 2-я колонка, миниатюра 36×36 с rounded-lg, превью по наведению 288×384px

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Topbar: блок «0 сом» удалён; профиль-кнопка — дропдаун (Настройки / Выйти), отображает имя + email
- ProfileModal: смена имени (auth.user_metadata + profiles) и пароля

## SQL патчи — порядок применения
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
```

⚠️ `patch_system_warehouses.sql` (#14) — нужно применить в продакшн Supabase SQL Editor, чтобы системные склады WB вернулись на странице Справочники.

## What Was Recently Done

### Стикеры — Import WB аккордеон + массовые операции (завершено)
- Вкладка «Импорт WB» полностью перестроена в аккордеон (аналог ProductsPage)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease`
- Колонка фото (миниатюра 36×36), превью по наведению (288×384px, умное позиционирование)
- Чекбокс глобальный в `<thead>` — выбирает ВСЕ size-строки по всем товарам
- Чекбокс на каждой строке товара — выбирает все его размеры / снимает их
- Чекбокс на каждой строке размера — отдельный выбор
- Кнопка «Развернуть/Свернуть все» — двойная стрелка
- «Создать набор» — создаёт стикеры для всех выбранных строк (skip дублей по баркоду), затем открывает модалку набора с pre-fill
- Уведомление «Все выбранные стикеры уже существуют» если все дубли

### Стикеры — Кастомная вкладка: массовое удаление (завершено)
- Колонка удаления выделена в отдельный `<th w-10>` правее колонки действий (eye/print/edit)
- Шапка колонки: иконка-корзина, неактивна (`opacity-30`) пока не выбрана хотя бы 1 строка
- При выборе 1+ строк кнопка активируется и открывает `<DeleteConfirmModal>` с количеством
- State: `deleteMassOpen`, `isDeletingMass`, `deleteMassError`
- Handler: `handleConfirmDeleteMass()` — удаляет каждый id из `selected`, очищает set
- В каждой строке корзина вынесена в отдельный `<td>` — стоит ровно под шапкой

### Страница Товары — ProductsPage (завершена)
- Таблица товаров с аккордеон-раскрытием по строке (клик на строку)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease` (как в LogisticsPage)
- Вложенная таблица размеров: колонки «Размер» (badge) и «Баркод»
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Кнопка «Развернуть все / Свернуть все» (двойная стрелка, стиль Logistics)
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Выбор магазина: дропдаун, только магазины с API-ключом
- Синхронизация товаров через Edge Function `sync-store-products`
- Время последней синхронизации в шапке карточки
- **Колонка фото**: 2-я колонка (после стрелки), миниатюра 36×36 с rounded-lg
- **Превью по наведению**: 288×384px, позиционирование с учётом краёв экрана (зеркалится если не влезает справа, прижимается если уходит за низ)
- Плейсхолдер если фото нет (серый квадрат с иконкой)

### Магазины — синк с WB API (завершено)
- `StoreList.tsx`: добавлены колонки «API ключ» (зелёный badge / прочерк), «Поставщик», «Адрес», «Создан»
- `StoreList.tsx`: кнопка синка (rotating arrows icon, зелёный hover), `animate-spin` во время загрузки
- `StoreList.tsx`: ошибка синка показывается над кнопками
- `StoresPage.tsx`: prop `onSync: (store: Store) => Promise<void>` передаётся в StoreList
- `App.tsx`: `handleSyncStore` — вызывает WB `/api/v1/seller-info`, сохраняет `data.name` в поле `supplier`
- WB API ограничения: только `{name, sid, tin, tradeMark}` — адреса нет. Rate limit: 1 req/24h (429 → «Много запросов»)
- `StoreFormModal.tsx`: кнопка «Из WB» удалена (мёртвый код)

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен

## SQL патчи — порядок применения
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
```

⚠️ `patch_system_warehouses.sql` (#14) — нужно применить в продакшн Supabase SQL Editor, чтобы системные склады WB вернулись на странице Справочники.

## What Was Recently Done

### Профиль пользователя — Topbar дропдаун + ProfileModal (завершено)
- `src/components/layout/Topbar.tsx`: удалён блок «0 сом»; кнопка профиля теперь открывает дропдаун
- Дропдаун: шапка (имя + email), пункт «Настройки профиля», пункт «Выйти из аккаунта» (красный)
- Клик вне дропдауна закрывает его (`useRef` + `mousedown` listener)
- Под именем в кнопке отображается email (с truncate), а не слово «Аккаунт»
- Topbar принимает `onSignOut` prop — выход прямо из дропдауна
- `src/components/accounts/ProfileModal.tsx` (новый): email read-only, смена имени через `supabase.auth.updateUser` + UPDATE в `profiles`, смена пароля (min 6 символов, подтверждение)
- `App.tsx`: `profileUserName` синхронизируется через `useEffect([session?.user?.id])` — корректно обновляется при входе с другого аккаунта

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

### Продакшн деплой — полная настройка БД (завершено)
- Применены все 18 SQL-патчей в продакшн Supabase
- Восстановлены RLS политики (были дропнуты при переприменении схемы):
  - `stores`, `shipments`, `sticker_templates`, `trips`, `trip_lines`, `roles`
- Добавлен `patch_role_member_sync.sql` (#18): триггер синхронизации account_members, RPC `get_my_accounts`, бэкфилл
- Storage политики для `trip-invoices` bucket восстановлены
- `account_members` заполнен — sydykovsam как owner в обеих компаниях

### Баркод в форме стикера (завершено)
- `StickerFormValues.barcode: string` добавлен в типы
- Поле баркода первым в `StickerFormModal` (генерируется через `generateEAN13()` по умолчанию)
- `stickerService` передаёт barcode при create и update

### PDF стикер — финальные визуальные правки (завершено)
- Шрифт тела 21px, начальный отступ 20px
- Значения полей `font-weight: 500` (тоньше меток `600`)

### Страница Товары (заглушка)
- Показывает «Скоро» вместо RolesPage

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
