import { useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Энциклопедия КИЗ-процесса — содержимое
───────────────────────────────────────────────────────────────────────────── */

interface EncStage {
  num: number
  icon: string
  title: string
  subtitle: string
  description: string
  details: string[]
  api?: string[]
  tip?: string
  warning?: string
}

const STAGES: EncStage[] = [
  {
    num: 1,
    icon: '🏭',
    title: 'Регистрация в системе Teksher',
    subtitle: 'Подключение организации к национальной системе маркировки',
    description:
      'Прежде чем работать с КИЗами, организация должна быть зарегистрирована в системе Teksher — государственной платформе Кыргызстана для маркировки товаров. После регистрации выдаются логин и пароль.',
    details: [
      'Подать заявку на сайте label.teksher.kg (физлицо-ИП или юрлицо)',
      'Дождаться подтверждения и получить учётные данные (логин + пароль)',
      'Убедиться, что организация является официальным участником маркировки в КР',
      'Пополнить баланс: в системе два типа баланса — балл-коды (единицы маркировки) и денежные средства',
      'Пополнение денежного баланса: прямо в ELESTET — кнопка «+ Пополнить» на вкладке КИЗы → QR-код MegaPay',
      'Подключить магазин в настройках ELESTET: Settings → Teksher → Введите логин/пароль → Подключить',
    ],
    tip: 'После подключения в ELESTET выполните «Синхронизировать» — данные о товарах, кодах и операциях загрузятся автоматически.',
  },
  {
    num: 2,
    icon: '🔑',
    title: 'Идентификаторы участника: GCP и GLN',
    subtitle: 'Глобальный префикс компании и номер местоположения',
    description:
      'GCP (Global Company Prefix) — это уникальный числовой префикс, который GS1 присваивает вашей организации. Он является основой для генерации всех ваших штрихкодов (GTIN). GLN (Global Location Number) — числовой идентификатор конкретного места (склад, офис, магазин).',
    details: [
      'GCP выдаётся организации при регистрации в GS1 Kyrgyzstan или через Teksher',
      'Длина GCP: обычно 9–12 цифр (чем короче, тем больше товаров можно зарегистрировать)',
      'GTIN-13 = GCP + код товара + контрольная цифра',
      'GLN = GCP + код местоположения (00 для головного офиса) + контрольная цифра',
      'Посмотреть свои GCP и GLN: страница КИЗы → вкладка «Товары (GTIN)» → кнопка «Инфо об участнике»',
    ],
    api: [
      'GET /api/v1/participants/{participantId}/identifiers',
      'Возвращает массив: [{gcp, gln, ...}]',
    ],
    tip: 'GCP и GLN нужны при создании нового товара (GTIN). Без них нельзя зарегистрировать продукт.',
  },
  {
    num: 3,
    icon: '📦',
    title: 'Регистрация товара (GTIN)',
    subtitle: 'Создание и публикация позиции в реестре Teksher',
    description:
      'Для каждого уникального товара (артикул + размер + цвет) необходимо создать отдельную запись в Teksher с уникальным GTIN-13 (13-значный штрихкод EAN). Это обязательное условие перед заказом КИЗ-кодов.',
    details: [
      'GTIN-13: 13 цифр, генерируется на основе GCP. Пример: 4600000000000',
      'Каждая уникальная комбинация «товар + размер + цвет» = отдельный GTIN',
      'Атрибуты товара обязательны: как минимум один attribute (тип + значение)',
      'Статус после создания: DRAFT (черновик)',
      'Публикация (PATCH): статус меняется DRAFT → PUBLISHED',
      'Только PUBLISHED товары допускаются к эмиссии кодов',
      'Поля создания: gtin, gcp, fullName, attributes[], trademark, manufacturerFullName, manufacturedCountryId, tnved',
    ],
    api: [
      'POST /api/v1/products/create — создать товар (статус DRAFT)',
      'PATCH /api/v1/products/{id} — опубликовать товар (DRAFT → PUBLISHED)',
      'GET /api/v1/products?page=0&size=N — список всех товаров',
    ],
    warning: 'Нельзя использовать один GTIN для разных товаров. Каждый GTIN должен соответствовать ровно одному SKU.',
  },
  {
    num: 4,
    icon: '🎫',
    title: 'Заказ КИЗ-кодов (Эмиссия)',
    subtitle: 'Запрос на генерацию уникальных кодов маркировки',
    description:
      'После того как товар зарегистрирован и опубликован, можно заказать КИЗ-коды (коды идентификации). Каждый КИЗ — это уникальный код DataMatrix, который наносится на одну единицу товара.',
    details: [
      'Максимум 10 000 кодов за одну операцию',
      'extension: "lp" — лёгкая промышленность (LP)',
      'countryId: 199 — Кыргызстан',
      'dataSupplier: "AUTO" — система сама назначает поставщика данных',
      'template: "SHORT" — короткий шаблон DataMatrix',
      'После запроса создаётся операция со статусом PENDING',
      'Каждый заказ списывает с баланса соответствующее количество балл-кодов',
    ],
    api: [
      'POST /facade/order/api/v1/operations/multi',
      'Body: { extension, countryId, items: [{gtin, markingCodesAmount, dataSupplier, template}] }',
      'Ответ: { data: { [gtin]: operationId } }',
    ],
    tip: 'После создания операции сразу выполните синхронизацию — новая операция появится в списке.',
  },
  {
    num: 5,
    icon: '⏳',
    title: 'Ожидание генерации кодов',
    subtitle: 'Система генерирует уникальные коды DataMatrix',
    description:
      'После заказа система Teksher асинхронно генерирует коды. Это занимает от нескольких секунд до нескольких минут в зависимости от количества. Необходимо дождаться статуса COMPLETED.',
    details: [
      'Статусы операции: PENDING → IN_PROGRESS → COMPLETED (или FAILED)',
      'Проверка готовности: GET /facade/order/api/v1/operations/{orderId}/ready',
      'Поле ready: true означает, что коды готовы к нанесению',
      'При попытке нанесения до готовности — система вернёт ошибку',
      'Обновляйте список операций через кнопку «Синхронизировать»',
    ],
    api: [
      'GET /facade/order/api/v1/operations/{orderId}/ready',
      'Ответ: { ready: true | false }',
    ],
    tip: 'Обычно 100 кодов генерируются за 30–60 секунд. 10 000 кодов могут занять 5–10 минут.',
  },
  {
    num: 6,
    icon: '📄',
    title: 'Скачивание PDF с кодами',
    subtitle: 'Получение файла с DataMatrix-этикетками для печати',
    description:
      'Когда операция переходит в статус COMPLETED, можно скачать PDF-файл с готовыми этикетками DataMatrix. Каждая страница содержит несколько кодов для наклеивания на товар.',
    details: [
      'PDF содержит DataMatrix-коды (не обычные штрихкоды EAN)',
      'Каждый код уникален и привязан к одной единице товара',
      'Размер этикетки зависит от шаблона (SHORT / FULL)',
      'PDF формируется на основе operationId операции',
      'Коды в PDF ещё имеют статус EMITTED (эмиттированы, но не нанесены)',
    ],
    api: [
      'GET /api/v1/marking-codes-pdf?operationId={id}',
      'Ответ: binary PDF file',
    ],
    tip: 'Скачивайте PDF сразу после получения статуса COMPLETED — в системе он хранится ограниченное время.',
  },
  {
    num: 7,
    icon: '🏷️',
    title: 'Нанесение КИЗ-кодов (Утилизация)',
    subtitle: 'Регистрация факта нанесения кодов на физический товар',
    description:
      'После физической наклейки кодов на товар необходимо зарегистрировать этот факт в системе — выполнить «утилизацию» (utilisation). Это переводит коды из статуса EMITTED в APPLIED.',
    details: [
      'Операция нанесения называется "утилизация" (utilisation)',
      'Выполняется PER операция (по orderId)',
      'Перед нанесением система проверяет: /operations/{orderId}/ready',
      'dataSupplier: "AUTO" — режим автоматической поставки',
      'extension: "lp" — для лёгкой промышленности',
      'После нанесения статус кодов меняется: EMITTED → APPLIED',
      'Только APPLIED коды можно включать в трансгран',
    ],
    api: [
      'GET /facade/order/api/v1/operations/{orderId}/ready — проверка готовности',
      'POST /facade/order/api/v1/operations/utilisation',
      'Body: { extension: "lp", dataSupplier: "AUTO", orderId }',
    ],
    warning: 'Не выполняйте нанесение без физической наклейки кодов. После утилизации отменить факт нанесения нельзя.',
  },
  {
    num: 8,
    icon: '📊',
    title: 'Журнал операций и статусы кодов',
    subtitle: 'Контроль всех операций с маркировкой',
    description:
      'В системе ведётся полный журнал всех операций: заказы кодов, нанесения, трансграны. Каждая операция имеет тип и статус. КИЗ-коды также имеют свои статусы жизненного цикла.',
    details: [
      'Типы операций: EMISSION (заказ кодов), UTILISATION (нанесение), TRANSGRAN (трансграничная)',
      'Статусы операций: PENDING → IN_PROGRESS → COMPLETED / FAILED / CANCELLED',
      'Статусы кодов: EMITTED (заказан) → APPLIED (нанесён) → IN_CIRCULATION (в обороте)',
      'Поле kmsCount — количество кодов маркировки в операции',
      'Поле operationId — уникальный идентификатор операции в Teksher',
      'Синхронизация в ELESTET: загружает все операции и коды в локальную БД',
    ],
    api: [
      'GET /api/v1/operations/filter?page=0&size=N — список операций',
      'GET /api/v1/marking_codes/filter?page=0&size=N — список КИЗ-кодов',
      'Параметры фильтра кодов: status, productGroupCode',
    ],
  },
  {
    num: 9,
    icon: '🌍',
    title: 'Трансгран (Трансграничная операция)',
    subtitle: 'Вывод товара из страны — регистрация экспортной отгрузки',
    description:
      'Трансгран — это операция, которая регистрирует факт вывоза маркированного товара за пределы Кыргызстана. Обязательна при экспорте товаров, промаркированных КИЗами. Проводится в 3 шага.',
    details: [
      'ШАГ 1: Загрузка файла с кодами — CSV/TXT с одним КМ-кодом на строку',
      'ШАГ 2: Создание операции трансграна с реквизитами получателя',
      'Обязательные поля: fileId, documentNumber, documentDate, recipientInn, recipientName, shipmentDate',
      'countryCode: код страны-получателя (например, "RU" для России)',
      'recipientKpp: КПП получателя (обязательно для юрлиц РФ)',
      'ШАГ 3: Операция подтверждается системой (PENDING → COMPLETED)',
      'При ошибке — отмена: POST /operations/cancel',
      'В коды включаются только APPLIED (нанесённые) коды',
    ],
    api: [
      'POST /facade/transgran/api/v1/files/marking_code — загрузка CSV с кодами',
      'Ответ: { id: fileId }',
      'POST /facade/transgran/api/v1/operations/create — создание трансграна',
      'POST /facade/transgran/api/v1/operations/cancel — отмена операции',
    ],
    warning: 'Нельзя включать в трансгран коды со статусом EMITTED (не нанесённые). Только APPLIED.',
  },
  {
    num: 10,
    icon: '💰',
    title: 'Баланс и тарификация',
    subtitle: 'Управление балансом кодов и денежным балансом',
    description:
      'В системе Teksher существует два типа баланса: балл-коды (единицы маркировки, списываются при заказе кодов) и денежный баланс (для оплаты за сервис). Необходимо следить за оба видами баланса.',
    details: [
      'Балл-коды (product_groups/balance): основная единица оплаты за КИЗы',
      'Денежный баланс (participants/billing/balance): деньги на лицевом счёте',
      'Стоимость одного КИЗ-кода зависит от тарифного плана организации',
      'При нулевом балансе кодов заказ эмиссии будет отклонён',
      'Пополнение денежного баланса — прямо в ELESTET: кнопка «+ Пополнить» → QR-код MegaPay (сканировать любым банковским приложением)',
      'Альтернативно: пополнение через личный кабинет на label.teksher.kg',
      'В ELESTET: блок «Баланс» на главной вкладке КИЗы',
    ],
    api: [
      'GET /api/v1/product_groups/balance — баланс кодов',
      'GET /api/v1/participants/billing/balance — денежный баланс',
      'POST /api/v1/qrcode?productGroupAlias=lp — QR-код для пополнения (MegaPay)',
    ],
    tip: 'Пополняйте баланс прямо в ELESTET через QR — не нужно заходить на сайт Teksher. Курс обмена (сом → КИЗ) отображается в карточке пополнения.',
  },
  {
    num: 11,
    icon: '🔄',
    title: 'Полная синхронизация данных',
    subtitle: 'Обновление всех данных из Teksher в ELESTET',
    description:
      'ELESTET хранит локальную копию данных из Teksher в БД Supabase. Для актуализации данных (новые товары, коды, операции) необходимо выполнять синхронизацию — как ручную, так и настроить автоматическую.',
    details: [
      'sync (быстрая) — обновляет только первую страницу товаров и кодов',
      'sync_full (полная) — загружает ВСЕ страницы товаров, кодов и операций',
      'Поддерживает пагинацию: за раз загружается по 200 записей, параллельно до 5 страниц',
      'После синхронизации обновляется: participantName, balance, balanceMoney, synced_at',
      'Данные хранятся в таблицах: teksher_products, teksher_codes, teksher_operations',
      'Конфликты разрешаются через upsert по ключу store_id + уникальный ID',
    ],
    api: [
      'Edge Function action: "sync" — быстрая синхронизация',
      'Edge Function action: "sync_full" — полная синхронизация всех страниц',
    ],
    tip: 'Рекомендуется выполнять полную синхронизацию после каждой крупной операции (заказ 1000+ кодов).',
  },
]

/* ─────────────────────────────────────────────────────────────────────────────
   Компонент энциклопедии
───────────────────────────────────────────────────────────────────────────── */

const EncyclopediaModal = ({ onClose }: { onClose: () => void }) => {
  const [activeStage, setActiveStage] = useState<number>(1)
  const stage = STAGES.find((s) => s.num === activeStage) ?? STAGES[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Боковая навигация */}
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-100 bg-slate-50">
          <div className="px-5 pt-6 pb-4 border-b border-slate-200">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Энциклопедия КИЗов</p>
            <p className="mt-1 text-lg font-bold text-slate-800">Путь до Трансграна</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {STAGES.map((s) => (
              <button
                key={s.num}
                type="button"
                onClick={() => setActiveStage(s.num)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  activeStage === s.num
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-base leading-none">{s.icon}</span>
                <span className="flex-1 text-xs font-medium leading-tight">{s.title}</span>
                <span
                  className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    activeStage === s.num ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {s.num}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* ── Основное содержимое */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Шапка */}
          <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-3xl">
                {stage.icon}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                    Этап {stage.num}
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{stage.title}</h2>
                <p className="text-sm text-slate-500">{stage.subtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 shrink-0 flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Контент */}
          <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
            {/* Описание */}
            <p className="text-sm leading-relaxed text-slate-700">{stage.description}</p>

            {/* Пошаговые детали */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Подробности
              </p>
              <ul className="space-y-2">
                {stage.details.map((d, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-700 leading-snug">{d}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* API */}
            {stage.api && stage.api.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  API-эндпоинты
                </p>
                <div className="rounded-xl bg-slate-900 px-4 py-3 space-y-1.5">
                  {stage.api.map((line, i) => (
                    <p key={i} className="font-mono text-xs text-emerald-400 leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Совет */}
            {stage.tip && (
              <div className="flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3">
                <span className="text-base">💡</span>
                <p className="text-sm text-blue-800 leading-relaxed">{stage.tip}</p>
              </div>
            )}

            {/* Предупреждение */}
            {stage.warning && (
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3">
                <span className="text-base">⚠️</span>
                <p className="text-sm text-amber-800 leading-relaxed">{stage.warning}</p>
              </div>
            )}
          </div>

          {/* Навигация между этапами */}
          <div className="flex items-center justify-between border-t border-slate-100 px-8 py-4">
            <button
              type="button"
              disabled={activeStage === 1}
              onClick={() => setActiveStage((p) => p - 1)}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Назад
            </button>
            <span className="text-xs text-slate-400">
              {activeStage} / {STAGES.length}
            </span>
            <button
              type="button"
              disabled={activeStage === STAGES.length}
              onClick={() => setActiveStage((p) => p + 1)}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              Вперёд
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Основной компонент КИЗы 2
───────────────────────────────────────────────────────────────────────────── */

export const KizGuidePage = () => {
  const [encyclopediaOpen, setEncyclopediaOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/* ── Заголовок страницы */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Гайд</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Расширенные инструменты работы с кодами маркировки
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEncyclopediaOpen(true)}
          className="flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition-transform"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Энциклопедия КИЗов
        </button>
      </div>

      {/* ── Обзорные карточки этапов */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((s) => (
          <button
            key={s.num}
            type="button"
            onClick={() => { setEncyclopediaOpen(true) }}
            className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xl group-hover:bg-blue-50 transition-colors">
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">
                  Этап {s.num}
                </span>
              </div>
              <p className="mt-0.5 text-sm font-semibold text-slate-800 leading-snug">{s.title}</p>
              <p className="mt-0.5 text-xs text-slate-500 leading-snug line-clamp-2">{s.subtitle}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Энциклопедия (модалка) */}
      {encyclopediaOpen && <EncyclopediaModal onClose={() => setEncyclopediaOpen(false)} />}
    </div>
  )
}
