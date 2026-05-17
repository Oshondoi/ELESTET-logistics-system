export const GlossaryPage = () => {
  const items: { name: string; category: string; description: string }[] = [
    {
      name: 'История изменений этапов — шаблон (источник: ОТК)',
      category: 'Фулфилмент',
      description: `Шаблон блока истории для любого журнального этапа (ОТК, Маркировка и т.д.). Копируй OTK-блок дословно, меняй только помеченные места.

СТРУКТУРА БЛОКА (внутри IIFE otkHistoryStageTab === 'ХХХ'):
  ┌ локальные переменные (shadowing внешнего скоупа):
  │   const allOtkLogs = [...АКТИВНЫЕ_ЛОГИ, ...УДАЛЁННЫЕ_ЛОГИ]          // [M] массивы своего этапа
  │   const activeId   = ТАБ_STATE ?? allOtkLogs[0]?.id ?? ''           // [M] свой useState таба
  │   const activeLog  = allOtkLogs.find(l => l.id === activeId) ?? ... // не менять
  │   const isDeletedLog = !!activeLog?.deleted_at                       // не менять
  │   const histories  = activeId ? СВОИ_HISTORIES[activeId] : undefined // [M] свой state histories
  │   const FIELD_LABELS = { tariff, qty, qty_defect, notes, photo_urls } // не менять
  │   const calcTotal  = (vals) => qty + qty_defect                      // не менять
  │   const fmtVal = (key, val) => {
  │     if key==='tariff' → СВОИ_TARIFFS.find(...)                      // [M] свои тарифы
  │     ...остальное не менять
  │   }
  │   const loadHistory = async (logId) => {
  │     if (СВОИ_HISTORIES[logId] || СВОЙ_LOADING_REF.current.has(logId)) return  // [M]
  │     СВОЙ_LOADING_REF.current.add(logId)
  │     // fetch: fetchХХХLogHistory(logId)                              // [M] своя функция fetch
  │     // если h.length===0 → синтез created через addХХХLogHistory    // [M] своя функция add
  │     // enrich user_name через СВОИ_PERFORMERS                        // [M] свои performers
  │     // patchХХХLogHistoryUserName                                    // [M] своя функция patch
  │     setСВОИ_HISTORIES(prev => ({...prev, [logId]: enriched}))       // [M]
  │   }
  │   const createdEntry = histories?.find(h => h.action==='created')
  │   const initialValues = createdEntry?.new_values ?? null
  │
  ├ if (activeId && !histories) { void loadHistory(activeId) }
  │
  ├ pristineLogs = АКТИВНЫЕ_ЛОГИ.filter(updated-created <= 1000ms)      // [M] свои активные
  ├ modifiedLogs = АКТИВНЫЕ_ЛОГИ.filter(updated-created > 1000ms)       // [M]
  ├ renderTab(log, scheme, suffix?) → кнопка таба (синяя/оранж/красная)
  │   onClick: setСВОЙ_ТАБ_STATE(log.id); loadHistory(log.id)           // [M] свой setter
  │
  └ JSX:
      таб-ряд: pristineLogs(blue) + modifiedLogs(orange) + УДАЛЁННЫЕ(red, 'удалена')  // [M]
      левая панель: текущие данные + первоначальные данные (из initialValues)
      правая панель: [...histories].reverse().map(h => карточка действия)
        - created  → зелёный, поля из new_values + calcTotal
        - updated  → жёлтый, diff: old → new по changedKeys
        - deleted  → красный, поля из old_values + calcTotal
        - имя: h.user_name ?? СВОИ_PERFORMERS.find(...)                 // [M]

МЕТКИ ИЗМЕНЕНИЙ [M] — только их трогать при копировании:
  АКТИВНЫЕ_ЛОГИ     → markingLogs / otkLogs / ...
  УДАЛЁННЫЕ_ЛОГИ    → markingDeletedLogs / otkDeletedLogs / ...
  ТАБ_STATE         → markingHistoryTabId / otkHistoryTabId / ...
  СВОИ_HISTORIES    → markingLogHistories / otkLogHistories / ...
  СВОЙ_LOADING_REF  → markingHistoryLoadingIds / otkHistoryLoadingIds / ...
  СВОИ_TARIFFS      → MARKING_TARIFFS / OTK_TARIFFS / ...
  fetchХХХ          → fetchMarkingLogHistory / fetchOtkLogHistory / ...
  addХХХ            → addMarkingLogHistory / addOtkLogHistory / ...
  patchХХХ          → patchMarkingLogHistoryUserName / patchOtkLogHistoryUserName / ...
  setСВОИ_HISTORIES → setMarkingLogHistories / setOtkLogHistories / ...
  setСВОЙ_ТАБ       → setMarkingHistoryTabId / setOtkHistoryTabId / ...
  СВОИ_PERFORMERS   → markingPerformers / otkPerformers / ...

БД: fulfillment_otk_log_history, fulfillment_marking_log_history
  Колонки: id, log_id (FK), user_id, user_email, user_name, action (created|updated|deleted), old_values (jsonb), new_values (jsonb), created_at
  RLS: SELECT USING true; INSERT WITH CHECK uid()=user_id`,
    },
    {
      name: 'Аудит-модалка / История изменений',
      category: 'Фулфилмент',
      description: 'Модалка истории внутри BatchDetailModal. Кнопка «История» в шапке партии. Табы этапов вверху, мини-табы работ/позиций горизонтально, левая панель = текущие/первоначальные данные, правая = журнал действий (Создал/Изменил/Удалил) с автором и датой. У ОТК и Маркировки — реальная история из БД. У остальных этапов — снимки из batch.created_at / updated_at.',
    },
    {
      name: 'Мини-табы OTK (3 цвета)',
      category: 'Фулфилмент',
      description: 'Синие = активные нетронутые (updated_at ≈ created_at). Оранжевые = активные изменённые. Красные = удалённые (deleted_at != null). Порядок: синие → оранжевые → красные.',
    },
    {
      name: 'Тabs этапов (верхний уровень истории)',
      category: 'Фулфилмент',
      description: 'Приёмка | ОТК | Маркировка | Короба | Логистика. Кликабельны только этапы включённые в настройках партии. Активный при открытии = текущий viewStage партии.',
    },
    {
      name: 'Архив партий',
      category: 'Фулфилмент',
      description: 'Soft-delete через deleted_at. Кнопка «Архив» в заголовке FulfillmentPage. Открывает модальный список архивированных партий с Восстановить. Клик по строке → BatchDetailModal на z-index 60 (поверх архива). Кнопка «Архив» в шапке отдельной партии теперь переименована в «История» и открывает аудит-модалку.',
    },
    {
      name: 'Расхождение ОТК (otk_discrepancy)',
      category: 'Фулфилмент',
      description: 'Разница между итого ОТК (sum qty + qty_defect) и принято в приёмке. Показывается в карточке-статистике партии оранжевым цветом. Хранится в fulfillment_batches.otk_discrepancy.',
    },
    {
      name: 'Итого ОТК (tOtk)',
      category: 'Фулфилмент',
      description: 'Сумма qty (годных) + qty_defect (брак) по всем активным записям ОТК партии. Используется в расхождении, в статус-баре, в кнопке «Перейти дальше».',
    },
    {
      name: 'Статус-бар ОТК (Итого строка)',
      category: 'Фулфилмент',
      description: 'Первая строка <thead> над заголовками колонок. Показывает: Исполнителей / Тарифов / Годных / Браков / Итого ОТК / Примечаний / Фото — все через justify-between на полную ширину.',
    },
    {
      name: 'Политика сохранения данных (Data preservation)',
      category: 'Архитектура',
      description: 'Данные никогда не удаляются без явного согласия. OTK логи — soft-delete. FK user_id ON DELETE SET NULL — данные остаются при удалении пользователя. user_email и user_name хранятся как текст-снимок.',
    },
    {
      name: 'effectivePage vs activePage',
      category: 'App.tsx',
      description: 'activePage — хранится в localStorage, используется для навигации. effectivePage — вычисляется синхронно (не через useEffect!) с учётом прав и isAdmin — используется для рендеринга. Решает race condition при загрузке прав.',
    },
    {
      name: 'isAdmin',
      category: 'App.tsx',
      description: 'session?.user?.email === "sydykovsam@gmail.com". Показывает кнопки «Админ» и «Словарь» в Topbar. Открывает AdminPage и GlossaryPage. Не зависит от ролей — только email владельца.',
    },
    {
      name: 'BatchDetailModal',
      category: 'Фулфилмент',
      description: 'Модалка детали партии. z-index задаётся через prop zIndex (default 50). При открытии из архива zIndex=60. Внутренние sub-модалки: z-[60]/z-[65]. Шапка: название + магазин в одну строку, кнопка «История», статус, закрыть.',
    },
    {
      name: 'Sweep-select (выделение свайпом)',
      category: 'UI паттерны',
      description: 'Выделение чекбоксов свайпом мышью / касанием на мобильном. Реализован через onPointerDown/onPointerEnter. Детали: /memories/repo/sweep-select.md',
    },
    {
      name: 'WB Supplies API — только чтение (ВАЖНО)',
      category: 'WB API',
      description: 'API supplies-api.wildberries.ru предоставляет продавцам только GET-методы. Создать поставку, добавить товары в короб, записать баркоды через API — невозможно. Это намеренное ограничение WB. Единственная автоматизация упаковки — сгенерировать Excel и загрузить вручную через кнопку «Загрузить файл» в ЛК → Поставки → Упаковка.',
    },
    {
      name: 'ШК короба (packageCode)',
      category: 'WB API',
      description: 'WB автоматически присваивает каждому коробу уникальный код вида WB_1586327524 при старте упаковки поставки в ЛК. Получаются через GET /api/v1/supplies/{supplyId}/package. Наш edge function wb-supply запрашивает их при синке QR-стикеров (синяя кнопка) и сохраняет в trip_lines.wb_package_codes (text[]). SQL: patch_wb_package_codes.sql.',
    },
    {
      name: 'WB Excel шаблоны — Скачать товары / Скачать короба',
      category: 'WB API',
      description: `Зелёная кнопка (иконка документа) в ячейке «Стикеры» в Логистике. Генерирует Excel-файлы через SheetJS (xlsx) для загрузки в ЛК WB → Упаковка.

ШАБЛОН ТОВАРОВ (Скачать товары):
  Колонки: Баркод | Количество
  Источник: fulfillment_supplies → boxes → items, агрегация по баркоду
  Доступна всегда (не нужен wb_supply_id)

ШАБЛОН КОРОБОВ (Скачать короба):
  Колонки: Баркод товара | Кол-во товаров | ШК короба | Срок годности
  ⚠️ "Кол-во товаров" — именно с «в», WB чувствителен к заголовку, без «в» пишет 0 шт
  Источник: наши коробы из фулфилмента + wb_package_codes из state
  Соответствие: box_number=1 → WB_min, box_number=2 → WB_next (сортировка по числовому суффиксу)
  Требует: нажать синюю кнопку QR-стикеров до этого (она сохраняет ШК в state/БД)

СЦЕНАРИЙ:
  1. Создали рейс + поставку в ELESTET, заполнили коробки в Фулфилменте
  2. Создали FBW поставку в ЛК WB, записали ID поставки в ELESTET
  3. Нажали синюю кнопку QR → ШК коробов сохранились
  4. Нажали зелёную кнопку Excel → скачали два файла
  5. Загрузили в ЛК WB → поставка готова

Файлы: src/lib/wbExcelExport.ts, src/components/ui/TripLineStickerCell.tsx`,
    },
    {
      name: 'wb_supply_id — ID поставки WB',
      category: 'WB API',
      description: 'Числовой ID поставки FBW в системе WB (напр. 39201279). Вводится вручную менеджером в поле поставки в ELESTET после создания поставки в ЛК WB. Хранится в trip_lines.wb_supply_id. Нужен для: синка QR-стикеров (синяя кнопка), скачивания шаблона коробов (зелёная кнопка). Синяя кнопка активна только при наличии wb_supply_id.',
    },
    {
      name: 'wb_cargo_type — тип отгрузки',
      category: 'WB API',
      description: 'Тип упаковки поставки WB: 1 = короба (QR), 2 = паллеты. Берётся из GET /api/v1/supplies/{id} поля boxTypeID + isBoxOnPallet при синке стикеров. Хранится в trip_lines.wb_cargo_type. Влияет на отображение иконок в ячейке стикеров.',
    },
    {
      name: 'Что такое КИЗ',
      category: 'Teksher / КИЗ маркировка',
      description: `КИЗ (Контрольный Идентификационный Знак) — это уникальный цифровой код маркировки товара. Похож на QR-код, но стандарт Data Matrix.

Простыми словами:
  Каждая единица товара (каждая футболка, каждые джинсы) получает свой личный код.
  Код печатается на стикер и наклеивается на товар.
  При пересечении границы и при продаже код сканируется — государство отслеживает путь товара.

Зачем нужен:
  По законодательству КР и ТС — легальная продажа в РФ без КИЗ невозможна.
  Честный Знак РФ сканирует код при продаже и фиксирует факт продажи.`,
    },
    {
      name: 'label.teksher.kg — рабочая система',
      category: 'Teksher / КИЗ маркировка',
      description: `Государственная система маркировки КР. ИСА ЦРПТ (Информационная система администрирования).

URL: https://label.teksher.kg  ← ЭТО рабочий кабинет
НЕ teksher.kg — это маркетинговый сайт, войти туда не удалось.
НЕ pedant.kg — это сторонний платный сервис (4000 сом/мес) с красивым UI поверх label.teksher.kg.

Аккаунт (Ашимов Кадырали Курсанбаевич):
  Логин:   user93645
  Пароль:  Abumen2026.kg!!!
  Email:   zamirbekkyzy2021@icloud.com
  ИНН:     22101199601390
  participantId: 9ac0c6be52c143d39d1e0d0965ac24a8
  Тип:     УОТ (участник оборота товаров)

Данные кабинета:
  Товаров: 407, Операций: 1496
  Баланс: 30 шт. КИЗ / 20.48 сом
  Товарный знак: ABU MEN, ТН ВЭД: 6203120000`,
    },
    {
      name: 'REST API Teksher — все endpoints',
      category: 'Teksher / КИЗ маркировка',
      description: `База URL: https://label.teksher.kg/facade/
Аутентификация: JWT Bearer в HTTP-cookie access_token
Заголовок: Authorization: Bearer {access_token}

POST /facade/api/v1/sign-in
  Body (form): login + password
  Ответ: устанавливает cookie access_token (JWT, алгоритм RS256, realm mzkm_prod_realm)

GET /facade/api/v1/users/getCurrentUser
  → { id, login, fullName, email, participant: { inn, participantId, typeName, ... } }

GET /facade/api/v1/products?page=0&size=10
  → { content: [{ id, fullName, gtin, tnved, trademark, manufacturerFullName,
                   manufacturerInn, gcp, gln, status, statusDate }], page: {...} }

GET /facade/api/v1/operations/filter?size=15&page=0&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  → { content: [{ operationType, createdAt, endAt, kmsCount, status,
                   operationId (UUID), productGroupMarkingDto, participantDto }] }

GET /facade/api/v1/marking_codes/filter?size=N&page=0&productGroupCode=LP+RF
  Дополнительные фильтры: &gtin=...&status=ISSUED&operationId=...
  → { content: [{ id, gtin, code, serialNumber, status, productGroupMarking,
                   markingCodeLevel, parent, createdAt, country }] }

GET /facade/product_groups_marking
  → { content: [{ id, code:"1", alias:"lp", name:"Предметы одежды и одежды..." }] }

GET /facade/api/v1/countries
  → список стран

Типы операций: EMISSION (заказ кодов), MARKING (нанесение), SHIPMENT (трансграничная)`,
    },
    {
      name: 'Формат КИЗ кода — расшифровка GS1',
      category: 'Teksher / КИЗ маркировка',
      description: `Стандарт: GS1 DataMatrix. Пример реального кода из кабинета:
  0104703804901035215Ik+Or/ZCNWnK

Расшифровка:
  01  — AI (Application Identifier), означает "дальше идёт GTIN"
  04703804901035  — GTIN-14 (14 цифр)
    047  = префикс КР в системе GS1
    03804901035  = товарный код внутри
  21  — AI, означает "дальше идёт серийный номер"
  5Ik+Or/ZCNWnK  — серийный номер (13 символов, a-zA-Z0-9 + спецсимволы)

Ещё примеры GTIN:
  04703804901035 — ABU MEN джинсы (один артикул+размер)
  04703804904821 — другой SKU (свой GTIN у каждого размера/цвета)

GCP (Global Company Prefix): 470380490
GLN (Global Location Number): 4703804900007

Каждая карточка товара в Teksher = один GTIN. Каждая единица = один серийный номер.`,
    },
    {
      name: 'Статусы КИЗ кода',
      category: 'Teksher / КИЗ маркировка',
      description: `ISSUED  → код заказан и готов. Можно печатать стикер. Нанесение ещё не подтверждено.
APPLIED → нанесение зарегистрировано (операция MARKING выполнена). Товар промаркирован.
SOLD    → продан конечному покупателю. Фиксирует Честный Знак РФ при сканировании на кассе.

Переходы: ISSUED → APPLIED (наша операция MARKING) → SOLD (РФ сканирует при продаже).

При заказе стикеров из ELESTET нужно брать коды со статусом ISSUED.`,
    },
    {
      name: 'Полный цикл маркировки — 6 шагов',
      category: 'Teksher / КИЗ маркировка',
      description: `Шаг 1. Регистрация карточки товара (один раз на артикул/размер)
  → Teksher присваивает GTIN-14 каждому SKU.
  → Заполняем: название, ТН ВЭД, товарный знак, страна, производитель.

Шаг 2. Заказ эмиссии КМ (операция EMISSION)
  → Указываем GTIN + количество нужных кодов.
  → Teksher генерирует N кодов, списывает деньги с баланса.
  → Коды появляются в кабинете со статусом ISSUED.

Шаг 3. Печать стикеров с DataMatrix кодом
  → Каждый КИЗ распечатывается на стикер 4×4 см (термопринтер).
  → Клеится на каждую единицу товара (на упаковку или на ярлык).

Шаг 4. Регистрация Нанесения (операция MARKING)
  → Подтверждаем в Teksher: "эти коды наклеены на товар".
  → Статус: ISSUED → APPLIED.

Шаг 5. Трансграничная отгрузка (операция SHIPMENT / Трансгран)
  → При отправке партии в Россию: регистрируем отгрузку.
  → Указываем коды, страну назначения, перевозчика.

Шаг 6. Продажа в России
  → Продавец сканирует код на кассе.
  → Честный Знак РФ фиксирует: APPLIED → SOLD. Всё, цепочка завершена.`,
    },
    {
      name: 'Pedant.kg — что это',
      category: 'Teksher / КИЗ маркировка',
      description: `Pedant.kg — коммерческий SaaS-сервис (НЕ государственный).

Что делает: предоставляет красивый UI поверх label.teksher.kg с автоматизацией.
Стоимость: 4 000 сом/мес за интеграцию Teksher.
Нет своего API: /ru/api → 404. Только веб-интерфейс.

Наши два аккаунта в Pedant:
  1. ОсОО АЭРОН (sydykovsam@gmail.com) — 55 товаров, 120 операций, баланс 732 шт. / 498.15 сом
  2. Ашимов Кадырали (user93645) — 407 товаров, 1496 операций, баланс 30 шт. / 20.48 сом

Вывод: Pedant делает то же что мы можем делать напрямую через label.teksher.kg/facade/api/v1/.
При интеграции в ELESTET — работаем напрямую с Teksher, Pedant не нужен.`,
    },
    {
      name: 'Безопасность проекта',
      category: 'Инфраструктура',
      description: `Ключевые вопросы безопасности ELESTET. Скажи «задача о безопасности проекта» — и ИИ сразу поймёт контекст.

GITHUB — ПУБЛИЧНЫЙ РЕПО:
  Vercel бесплатный тариф = репо обязан быть публичным. Любой может скачать код.
  Защита: добавить файл LICENSE с запретом использования.
    - Commons Clause поверх MIT: запрет продажи/коммерции
    - «All Rights Reserved» (проприетарная): полный запрет
    Юридический барьер, технически не блокирует скачивание.
  Альтернатива без публичного репо:
    - Vercel Pro ($20/мес) — поддерживает приватные репо
    - vercel deploy через CLI — файлы идут напрямую, GitHub не нужен

SUPABASE — БЕЗОПАСНОСТЬ БД:
  Anon key в коде — НОРМАЛЬНО. Публичный по дизайну Supabase. Безопасен при включённом RLS.
  Service role key — НИКОГДА в фронтенд. Только Edge Functions / серверный .env.
    Если утёк в публичный репо → немедленно ротировать в Supabase Dashboard → Settings → API.
  RLS (Row Level Security) — главная защита. Пока политики правильные — чужие данные закрыты.
  Откат назад:
    Supabase Pro ($25/мес) = PITR (Point-in-time recovery), любая секунда за 7 дней
    Бесплатный = ежедневные бэкапы, восстановление только через поддержку Supabase
  Снапшот БД: supabase db dump (CLI) или pg_dump через дашборд → один SQL файл структуры+данных

ПРИОРИТЕТЫ (в порядке важности):
  1. service_role key нигде нет в коде/репо — КРИТИЧНО
  2. sourcemap: false в vite.config.ts — ✅ сделано. Без этого исходник TypeScript виден через DevTools
  3. Добавить LICENSE файл в репо — правовая защита кода
  4. Supabase Pro — если данные клиентов критически важны (PITR)`,
    },
    {
      name: 'Свернуть / Развернуть список',
      category: 'Логистика',
      description: `Кнопка в тулбаре страницы Логистики (ShipmentsPage). Иконка: двойная стрелка вверх = свернуть, двойная стрелка вниз = развернуть. Стиль: квадратная 40×40 px, variant="secondary", синий фон (#E3EAF6) когда хоть один рейс раскрыт.

СОСТОЯНИЕ:
  expandAllTrips: boolean — в useState, инициализируется из localStorage ('elestet-expand-all')
  collapseSignal: number — счётчик, инкрементируется при принудительном схлопывании
  anyTripExpanded: boolean — true если хоть один рейс раскрыт (приходит через onExpandedCountChange от TripTable)

ЛОГИКА КНОПКИ:
  anyTripExpanded=true  → setExpandAllTrips(false) + setCollapseSignal(n+1) + localStorage='false'
  anyTripExpanded=false → setExpandAllTrips(true)  + localStorage='true'
  Примечание: collapseSignal нужен потому что setExpandAllTrips(false) не форсирует схлопывание если expandAll уже был false

TripTable получает:
  expandAll={expandAllTrips}           → при true все рейсы раскрываются
  collapseAllSignal={collapseSignal}   → при изменении — все рейсы схлопываются
  onExpandedCountChange={(count) => { setAnyTripExpanded(count > 0); if (count===0) setExpandAllTrips(false) }}

ИКОНКА SVG:
  Свернуть (anyTripExpanded=true):  двойные шевроны вверх  (m7.5 11 4.5-4.5 4.5 4.5 / m7.5 17 4.5-4.5 4.5 4.5)
  Развернуть (anyTripExpanded=false): двойные шевроны вниз (m7.5 7 4.5 4.5 4.5-4.5 / m7.5 13 4.5 4.5 4.5-4.5)

ФАЙЛЫ: src/pages/ShipmentsPage.tsx, src/components/trips/TripTable.tsx`,
    },
    {
      name: 'Anchored dropdown (привязанный список)',
      category: 'UI паттерны',
      description: `Кастомный SearchableSelect в KizPage.tsx. Список открывается через createPortal в document.body с position:fixed — не расширяет родителя и не обрезается overflow модалки.

Как работает:
  1. useLayoutEffect при open → getBoundingClientRect() триггера → вычисляет top/bottom+left+width
  2. Если места снизу < 220px и сверху > 220px → список открывается вверх (bottom=...), иначе вниз (top=...)
  3. При любом scroll (capture phase) — список закрывается
  4. Клик вне компонента (mousedown) — закрывается

Файл: src/pages/KizPage.tsx, компонент SearchableSelect (~строка 210)`,
    },
  ]

  const categories = [...new Set(items.map((i) => i.category))]

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Словарь проекта</h1>
        <p className="mt-1 text-sm text-slate-500">Внутренние названия, концепции и паттерны ELESTET. Видно только владельцу.</p>
      </div>
      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat}</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {items.filter((i) => i.category === cat).map((item) => (
              <div key={item.name} className="px-5 py-4">
                <p className="font-semibold text-slate-800">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
