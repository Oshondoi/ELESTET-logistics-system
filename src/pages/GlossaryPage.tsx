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
