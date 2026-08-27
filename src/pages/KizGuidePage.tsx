import { useEffect, useState } from 'react'

interface Source { label: string; href: string }
interface Stage {
  num: number
  icon: string
  title: string
  subtitle: string
  description: string
  details: string[]
  technical?: string[]
  tip?: string
  warning?: string
  sources: Source[]
}

const MANUAL = 'https://main.teksher.kg/files/rukovodstva-polzovatelyz-mzkm-v0.8.pdf'
const FAQ = 'https://main.teksher.kg/faq.html'
const BUSINESS = 'https://main.teksher.kg/business.html'
const GS1 = 'https://www.gs1.org/standards/gs1-datamatrix-guideline/25'
const WB = 'https://dev.wildberries.ru/openapi/orders-fbs/'

const STAGES: Stage[] = [
  {
    num: 1, icon: '🧭', title: 'Определить схему маркировки', subtitle: 'Для какого рынка выпускается код',
    description: 'Сначала определяется рынок назначения, а не только страна производства. Товар может быть произведён в Кыргызстане, а российский код для него — выпущен через Teksher.',
    details: [
      'Внутренняя маркировка применяется для оборота товара в Кыргызстане.',
      'Внешняя маркировка применяется при выпуске кодов страны назначения, например России.',
      'Страна производства не определяет формат КИЗ сама по себе: важны товарная группа, рынок назначения и правила его системы маркировки.',
      'Для лёгкой промышленности, отправляемой в Россию, выбирается соответствующая российская товарная группа (в системе встречается обозначение LP RF).',
      'До заказа кодов согласуйте с получателем, кто создаёт трансгран и кто принимает его в стране назначения.',
    ],
    warning: 'Не выбирайте товарную группу «по похожему названию»: неверные группа или ТН ВЭД делают дальнейшую работу с кодами невозможной.',
    sources: [{ label: 'FAQ Teksher', href: FAQ }, { label: 'Руководство Teksher', href: MANUAL }],
  },
  {
    num: 2, icon: '🏢', title: 'Подключить участника Teksher', subtitle: 'Учётная запись и магазин ELESTET',
    description: 'Для работы нужна активная учётная запись участника оборота. ELESTET обращается к Teksher от имени выбранного магазина и показывает его товары, коды, операции и баланс.',
    details: [
      'Получите у оператора Teksher данные авторизации зарегистрированного участника.',
      'При первом входе смените выданный пароль. Он должен содержать не менее 8 символов, строчные и заглавные латинские буквы, цифру и специальный символ.',
      'Откройте «Стикеры и КИЗы» → «КИЗы», выберите магазин и подключите нужного участника.',
      'Сверьте имя участника рядом с индикатором «Teksher подключён», чтобы не заказать коды на другую организацию.',
      'После смены пароля Teksher переподключите магазин в ELESTET.',
    ],
    tip: 'Перед крупной операцией всегда сверяйте магазин ELESTET, участника Teksher и товарную группу.',
    sources: [{ label: 'Вход и пароль Teksher', href: MANUAL }],
  },
  {
    num: 3, icon: '🔑', title: 'Проверить GCP и GLN', subtitle: 'Идентификаторы компании и места производства',
    description: 'GCP и GLN — идентификаторы GS1, связывающие товар с организацией и местом производства. Они должны принадлежать участнику, от имени которого ведётся работа.',
    details: [
      'GCP — префикс компании GS1, используемый при формировании идентификаторов товаров.',
      'GLN — идентификатор организации или места: производства, склада либо подразделения.',
      'Организация получает идентификаторы через GS1 Kyrgyzstan; Teksher использует уже присвоенные данные.',
      'В ELESTET откройте «Товары (GTIN)» → «Инфо об участнике» и сверьте GCP, GLN, ИНН и наименование.',
      'Нельзя использовать GCP или GLN другой организации.',
    ],
    technical: ['ELESTET получает идентификаторы из Teksher и подставляет их при создании карточки товара.'],
    sources: [{ label: 'GTIN и GS1 — Teksher', href: FAQ }, { label: 'Руководство Teksher', href: MANUAL }],
  },
  {
    num: 4, icon: '📦', title: 'Создать и опубликовать товар', subtitle: 'Отдельный GTIN для каждого варианта',
    description: 'До заказа КИЗов товар регистрируется в Teksher. У каждого уникального варианта должен быть собственный GTIN и корректные характеристики.',
    details: [
      'Создайте карточку через «Товары (GTIN)» → «Новый товар». После сохранения она получает статус «Черновик».',
      'Заполните GTIN, наименование, ТН ВЭД, страну производства, производителя и обязательные атрибуты категории.',
      'Размер, цвет и другие признаки варианта должны соответствовать именно этому GTIN.',
      'Черновик можно исправить или удалить. После публикации редактирование ограничено.',
      'Проверьте данные и опубликуйте карточку: для эмиссии доступен только опубликованный товар.',
      'При ошибке публикации исправьте GTIN и обязательные данные, затем опубликуйте снова.',
      'GTIN-13 внутри GS1 DataMatrix записывается как 14 цифр с ведущим нулём. Это тот же товар.',
    ],
    warning: 'Один GTIN нельзя использовать для разных размеров или цветов; дубликаты карточек запрещены.',
    sources: [{ label: 'Операции с товарами — Teksher', href: MANUAL }],
  },
  {
    num: 5, icon: '💳', title: 'Проверить баланс', subtitle: 'КИЗ-единицы и денежный баланс',
    description: 'До эмиссии проверьте баланс кодов нужной товарной группы и денежный баланс участника. ELESTET показывает оба значения на главной вкладке КИЗов.',
    details: [
      'Баланс КИЗ-единиц показывает доступное количество кодов.',
      'Денежный баланс показывает средства участника в Teksher.',
      'Кнопка пополнения получает у Teksher единый платёжный QR выбранной товарной группы.',
      'Отсканируйте QR банковским приложением, укажите сумму и подтвердите платёж.',
      'После оплаты обновите данные и убедитесь, что баланс реально изменился.',
      'Используйте курс, который Teksher показывает в момент оплаты: не фиксируйте его вручную.',
    ],
    sources: [{ label: 'Баланс и пополнение — Teksher', href: MANUAL }],
  },
  {
    num: 6, icon: '🎟️', title: 'Заказать КИЗы — эмиссия', subtitle: 'Автоматический серийный номер или CSV',
    description: 'Эмиссия создаёт уникальные коды для опубликованных товаров. Для обычной работы надёжнее автоматическое формирование серийных номеров.',
    details: [
      'Актуальный лимит: до 1000 КМ и до 10 GTIN одной товарной группы и одного ТН ВЭД в заказе.',
      'Выберите опубликованный товар, количество и способ формирования серийного номера.',
      'В автоматическом режиме серийные номера создаёт система.',
      'Собственные номера загружаются CSV: один уникальный номер в строке, без заголовка, UTF-8.',
      'Для указанных в руководстве групп лёгкой промышленности собственный серийный номер имеет 12 символов. Это правило входного файла, не длина полного КМ.',
      'После сохранения дождитесь фактической готовности операции; фиксированного времени генерации нет.',
      'При отказе исправьте указанную причину, не создавая подряд одинаковые заказы.',
    ],
    technical: ['В живых данных Teksher операции встречаются со статусами ACCEPTED и REJECTED. ELESTET должен показывать фактический ответ, а не выдуманную цепочку статусов.'],
    warning: 'Лимит руководства Teksher — 1000 КМ на заказ и на PDF, не 10 000.',
    sources: [{ label: 'Заказ КМ — Teksher', href: MANUAL }],
  },
  {
    num: 7, icon: '🧩', title: 'Понимать состав КИЗ', subtitle: 'Идентификация, криптохвост и разделители',
    description: 'Полный российский КМ содержит идентификационную часть и блок проверки. DataMatrix также несёт служебные признаки GS1, которые сканер может передать управляющими символами.',
    details: [
      'Идентификационная часть: AI 01 + GTIN из 14 цифр + AI 21 + серийный номер.',
      'Полный КМ дополнительно содержит AI 91 с ключом и AI 92 с криптографической подписью.',
      'Поля переменной длины разделяет GS — ASCII 29. Он не печатается как обычный символ, но является частью структуры.',
      'FNC1 обозначает GS1 DataMatrix. Сканер может показать его как префикс ]d2 либо не выводить вовсе.',
      'API может возвращать короткую идентификационную часть, а CSV печати — полный КМ. Они могут относиться к одному коду, но применяются для разных задач.',
      'Не удаляйте управляющие разделители из исходного файла и не заменяйте их пробелами.',
      'Ручная перепечатка текста с этикетки не равна скану DataMatrix: служебные символы потеряются.',
    ],
    tip: 'Используйте сканер с поддержкой GS1 DataMatrix и передачей ASCII 29. В интерфейсе разделитель можно визуализировать, но отправлять нужно исходный символ.',
    sources: [{ label: 'Состав КМ — Teksher', href: BUSINESS }, { label: 'GS1 DataMatrix Guideline', href: GS1 }],
  },
  {
    num: 8, icon: '🖨️', title: 'Первичная печать и нанесение', subtitle: 'Первая выгрузка создаёт операцию нанесения',
    description: 'При первичной печати действие «Печать и нанесение» формирует файл, автоматически создаёт операцию нанесения и отправляет отчёт системе-эмитенту.',
    details: [
      'Дождитесь готовности заказа и откройте его.',
      'При первой выгрузке выберите «Печать и нанесение», затем PDF или CSV.',
      'Из заказа выгружаются сразу все коды; частичная первичная печать не предусмотрена.',
      'PDF — готовая печатная форма. CSV содержит полные КМ для оборудования, своего шаблона и последующих операций.',
      'После скачивания проверьте созданную операцию «Нанесение»: получение файла ещё не гарантирует успешный отчёт.',
      'Каждую этикетку нанесите ровно на одну единицу соответствующего товара без повторов.',
    ],
    warning: 'Не запускайте «Печать и нанесение», пока не готовы обработать весь заказ: действие регистрирует нанесение.',
    sources: [{ label: 'Первичная печать — Teksher', href: MANUAL }],
  },
  {
    num: 9, icon: '📄', title: 'CSV и повторная печать', subtitle: 'Как сохранить полный код без повреждения',
    description: 'Вторичная печать повторно выгружает уже полученные коды и не создаёт новую операцию нанесения. CSV остаётся техническим файлом с точной структурой КМ.',
    details: [
      'Для повторной выгрузки откройте исходный заказ на эмиссию и выберите PDF или CSV.',
      'Повторная печать не разрешает наносить один КИЗ на несколько единиц товара.',
      'Не открывайте и не пересохраняйте исходный CSV в Excel: он может изменить длинные строки, кавычки и управляющие символы.',
      'Для просмотра используйте текстовый редактор с сохранением UTF-8 и управляющих символов.',
      'Внешние кавычки могут быть обычным CSV-экранированием. Парсер снимает оболочку, но не изменяет данные КМ.',
      'Для трансграна и повторной регистрации нанесения берите выгрузку Teksher, а не текст с экрана.',
    ],
    tip: 'Храните оригинальный CSV неизменным, а для просмотра делайте копию.',
    sources: [{ label: 'Вторичная печать — Teksher', href: MANUAL }],
  },
  {
    num: 10, icon: '🛠️', title: 'Проверить нанесение и исправить отказ', subtitle: 'История и повторная регистрация',
    description: 'После первичной печати проверьте операцию нанесения. При отказе Teksher позволяет повторно зарегистрировать нанесение через исходный CSV.',
    details: [
      'Найдите операцию нанесения и откройте общие данные, список кодов и историю.',
      'Смотрите фактический статус и сообщение обработки; технические значения могут быть ACCEPTED и REJECTED.',
      'Сначала устраните причину: неверный товар, повреждённый файл, статус или структура КМ.',
      'Скачайте CSV из первоначального заказа на эмиссию.',
      'Создайте «Регистрацию нанесения», выберите товарную группу и загрузите исходный CSV.',
      'После сохранения снова проверьте результат и историю проблемных кодов.',
      'Не подменяйте полный КМ его короткой идентификационной частью.',
    ],
    warning: 'Не повторяйте операцию вслепую: сначала прочитайте причину отказа.',
    sources: [{ label: 'Нанесение и исправление — Teksher', href: MANUAL }],
  },
  {
    num: 11, icon: '🌍', title: 'Подготовить трансгран', subtitle: 'Полные нанесённые КМ и получатель',
    description: 'Трансгран передаёт сведения о маркированном товаре между странами. Для него нужен CSV с полными кодами, успешно зарегистрированными как нанесённые.',
    details: [
      'Возьмите CSV из первичной или вторичной печати исходного заказа.',
      'Файл должен содержать полный КМ с блоком проверки, а не только 01 + GTIN + 21 + серийный номер.',
      'Проверьте принадлежность кодов партии и успешное нанесение.',
      'Подготовьте номер и дату документа, дату отгрузки, страну и реквизиты получателя.',
      'Для российского юрлица заполните КПП, когда это требует форма.',
      'Не объединяйте в одном файле разные фактические отгрузки или получателей.',
      'Сохраните неизменную резервную копию CSV.',
    ],
    sources: [{ label: 'Подготовка трансграна — Teksher', href: MANUAL }],
  },
  {
    num: 12, icon: '🚚', title: 'Создать и завершить трансгран', subtitle: 'От отправителя до принятия импортёром',
    description: 'Создание отправителем — первая половина процесса. Получатель вручную принимает трансграничную операцию, поэтому её нужно передать ему и контролировать итог.',
    details: [
      'Загрузите CSV, заполните документ, отгрузку и получателя, затем создайте операцию.',
      'Проверьте принятые и отклонённые коды внутри операции.',
      'Сообщите импортёру об операции: автоматическое принятие руководством не предусмотрено.',
      'При поставке на маркетплейс дождитесь фактической приёмки складом.',
      'Отмена доступна только пока операция имеет статус «ВЫПОЛНЯЕТСЯ».',
      'Храните документ, исходный CSV и идентификатор операции вместе.',
    ],
    warning: 'Трансгран не завершён сразу после отправки формы: нужны успешная обработка и действие импортёра.',
    sources: [{ label: 'Полный цикл трансграна — Teksher', href: MANUAL }],
  },
  {
    num: 13, icon: '🔎', title: 'Контроль в ELESTET и работа с WB', subtitle: 'Как проверять и передавать КИЗ в FBS',
    description: 'ELESTET показывает данные Teksher и использует их в рабочих процессах. Источником статуса маркировки остаётся Teksher, а требования к заказу определяет Wildberries.',
    details: [
      'Перед проверкой важного результата обновите вкладки товаров, КИЗ-кодов и операций.',
      'Сверьте магазин, участника, GTIN, серийный номер, статус и связанную операцию.',
      'Для маркируемого FBS-товара WB ожидает КИЗ именно этого товара. Нельзя использовать чужой или уже переданный код.',
      'Не путайте EAN товара, QR заказа WB и DataMatrix КИЗ — это разные идентификаторы и этапы.',
      'Если камера не распознала КИЗ, сравните результат с оригинальным CSV: сохранились ли 01, 21, 91, 92 и разделители.',
      'При расхождении с кабинетом Teksher сначала обновите данные и откройте исходную операцию. Не исправляйте КМ вручную.',
    ],
    technical: ['В API WB поле sgtins передаёт КИЗы FBS-заказа; допустимость определяется метаданными конкретного задания.'],
    tip: 'Диагностика: этикетка → результат сканера → оригинальный CSV → операция Teksher → требование заказа WB.',
    sources: [{ label: 'Документация WB FBS', href: WB }, { label: 'GS1 DataMatrix Guideline', href: GS1 }],
  },
]

const Sources = ({ items }: { items: Source[] }) => (
  <div>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Проверенные источники</p>
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a key={item.href + item.label} href={item.href} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-50">
          {item.label} ↗
        </a>
      ))}
    </div>
  </div>
)

const GuideModal = ({ initialStage, onClose }: { initialStage: number; onClose: () => void }) => {
  const [active, setActive] = useState(initialStage)
  const stage = STAGES[active - 1]

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', keydown)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 md:p-3" onClick={onClose}>
      <div className="flex h-full w-full max-w-6xl overflow-hidden bg-white shadow-2xl md:max-h-[92vh] md:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-100 bg-slate-50 md:flex">
          <div className="border-b border-slate-200 px-5 pb-4 pt-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Практический справочник</p>
            <p className="mt-1 text-lg font-bold text-slate-800">Полный цикл маркировки</p>
            <p className="mt-1 text-xs text-slate-500">От схемы до трансграна и WB</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {STAGES.map((item) => (
              <button key={item.num} type="button" onClick={() => setActive(item.num)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${active === item.num ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                <span>{item.icon}</span><span className="flex-1 text-xs font-medium leading-tight">{item.title}</span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${active === item.num ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{item.num}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-slate-100 px-4 pb-4 pt-4 sm:px-6 md:px-8 md:pb-5 md:pt-7">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-2xl md:h-14 md:w-14 md:text-3xl">{stage.icon}</div>
                <div className="min-w-0">
                  <span className="rounded-lg bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">Раздел {stage.num}</span>
                  <h2 className="mt-1 text-lg font-bold leading-tight text-slate-900 md:text-xl">{stage.title}</h2>
                  <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">{stage.subtitle}</p>
                </div>
              </div>
              <button type="button" onClick={onClose} aria-label="Закрыть справочник" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <select value={active} onChange={(event) => setActive(Number(event.target.value))} aria-label="Раздел справочника" className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 md:hidden">
              {STAGES.map((item) => <option key={item.num} value={item.num}>{item.num}. {item.title}</option>)}
            </select>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 md:px-8 md:py-6">
            <p className="text-sm leading-relaxed text-slate-700">{stage.description}</p>
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Что делать и учитывать</p>
              <ul className="space-y-2.5">
                {stage.details.map((detail, index) => (
                  <li key={detail} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">{index + 1}</span>
                    <span className="text-sm leading-relaxed text-slate-700">{detail}</span>
                  </li>
                ))}
              </ul>
            </section>
            {stage.technical && <section><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Техническая справка</p><div className="space-y-2 rounded-2xl bg-slate-900 px-4 py-3.5">{stage.technical.map((line) => <p key={line} className="text-xs leading-relaxed text-emerald-300">{line}</p>)}</div></section>}
            {stage.tip && <div className="flex gap-3 rounded-2xl bg-blue-50 px-4 py-3"><span>💡</span><p className="text-sm leading-relaxed text-blue-800">{stage.tip}</p></div>}
            {stage.warning && <div className="flex gap-3 rounded-2xl bg-amber-50 px-4 py-3"><span>⚠️</span><p className="text-sm leading-relaxed text-amber-800">{stage.warning}</p></div>}
            <Sources items={stage.sources} />
          </div>

          <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 sm:px-6 md:px-8">
            <button type="button" disabled={active === 1} onClick={() => setActive((value) => value - 1)} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30">← Назад</button>
            <span className="text-xs text-slate-400">{active} / {STAGES.length}</span>
            <button type="button" disabled={active === STAGES.length} onClick={() => setActive((value) => value + 1)} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30">Вперёд →</button>
          </footer>
        </main>
      </div>
    </div>
  )
}

export const KizGuidePage = () => {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(1)
  const openStage = (stage: number) => { setSelected(stage); setOpen(true) }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Гайд по КИЗам</h1><p className="mt-0.5 text-sm text-slate-500">Полный цикл Teksher: от GTIN до трансграна и WB</p></div>
        <button type="button" onClick={() => openStage(1)} className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">Открыть полный справочник</button>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:px-5">
        <div className="flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" /><div><p className="text-sm font-semibold text-emerald-900">Сведения проверены по актуальному процессу</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Руководство Teksher V1.2 от 21.08.2025; фактическая интеграция ELESTET и Teksher проверена 27.08.2026. Правила GS1 и WB отмечены отдельно.</p></div></div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['GTIN', 'вариант товара'], ['КИЗ / КМ', 'код одной единицы'], ['GS / FNC1', 'служебные признаки GS1'], ['Трансгран', 'передача между странами']].map(([term, text]) => <div key={term} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="text-sm font-bold text-slate-900">{term}</p><p className="mt-1 text-xs text-slate-500">{text}</p></div>)}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((stage) => (
          <button key={stage.num} type="button" onClick={() => openStage(stage.num)} className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xl group-hover:bg-blue-50">{stage.icon}</div>
            <div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Раздел {stage.num}</span><p className="mt-0.5 text-sm font-semibold leading-snug text-slate-800">{stage.title}</p><p className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-500">{stage.subtitle}</p></div>
          </button>
        ))}
      </div>
      {open && <GuideModal initialStage={selected} onClose={() => setOpen(false)} />}
    </div>
  )
}
