type StatusInfo = {
  code: string
  name: string
  description: string
}

const supplierStatuses: StatusInfo[] = [
  { code: 'new', name: 'Новый', description: 'Заказ появился у продавца, но ещё не добавлен в поставку.' },
  { code: 'confirm', name: 'На сборке', description: 'Заказ добавлен в открытую поставку. Его можно собирать, печатать и переносить между открытыми поставками.' },
  { code: 'complete', name: 'В доставке', description: 'Поставка передана в доставку и закрыта. Добавлять в неё новые заказы уже нельзя.' },
  { code: 'cancel', name: 'Отменён продавцом', description: 'Продавец отменил заказ. WB автоматически удаляет его из поставки.' },
]

const wbStatuses: StatusInfo[] = [
  { code: 'waiting', name: 'В работе', description: 'WB ещё не принял или не завершил обработку заказа. Встречается вместе с new, confirm и complete.' },
  { code: 'sorted', name: 'Отсортирован WB', description: 'WB принял товар и отсортировал его на своей стороне.' },
  { code: 'sold', name: 'Получен покупателем', description: 'Финальный успешный статус: покупатель забрал заказ.' },
  { code: 'canceled', name: 'Отменён', description: 'Система WB подтвердила отмену заказа, обычно после отмены продавцом.' },
  { code: 'canceled_by_client', name: 'Отказ при получении', description: 'Заказ дошёл до покупателя, но покупатель отказался от него.' },
  { code: 'declined_by_client', name: 'Отмена в первый час', description: 'Покупатель отменил заказ до перевода на сборку.' },
  { code: 'defect', name: 'Отмена из-за брака', description: 'Заказ завершён отменой или возвратом по причине брака.' },
  { code: 'ready_for_pickup', name: 'Готов к получению', description: 'Заказ прибыл в ПВЗ и ожидает покупателя.' },
  { code: 'postponed_delivery', name: 'Доставка перенесена', description: 'Курьерская доставка заказа отложена.' },
  { code: 'accepted_by_carrier', name: 'Принят перевозчиком', description: 'Перевозчик принял заказ в стране продавца.' },
  { code: 'sent_to_carrier', name: 'Отправлен перевозчику', description: 'Заказ направляется на склад службы доставки в стране продавца.' },
]

const combinations = [
  ['new + waiting', 'Новые'],
  ['confirm + waiting', 'На сборке'],
  ['complete + waiting', 'В доставке'],
  ['complete + sorted', 'WB принял и сортирует'],
  ['complete + ready_for_pickup', 'Заказ ожидает покупателя в ПВЗ'],
  ['complete + postponed_delivery', 'Курьерская доставка перенесена'],
  ['complete + accepted_by_carrier', 'Заказ принят перевозчиком в стране продавца'],
  ['complete + sent_to_carrier', 'Заказ направляется на склад перевозчика'],
  ['complete + sold', 'Завершён успешно'],
  ['complete + canceled_by_client', 'Завершён отказом покупателя'],
  ['complete + defect', 'Завершён из-за брака'],
  ['cancel + canceled', 'Отменён продавцом'],
]

function StatusList({ statuses, tone }: { statuses: StatusInfo[]; tone: 'violet' | 'blue' }) {
  const badge = tone === 'violet' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {statuses.map((status, index) => (
        <div key={status.code} className={`grid gap-2 px-4 py-3 sm:grid-cols-[210px_1fr] ${index > 0 ? 'border-t border-slate-100' : ''}`}>
          <div className="flex min-w-0 items-center gap-2">
            <code className={`rounded-md px-2 py-1 text-[11px] font-semibold ${badge}`}>{status.code}</code>
            <span className="text-xs font-semibold text-slate-800">{status.name}</span>
          </div>
          <p className="text-xs leading-5 text-slate-500">{status.description}</p>
        </div>
      ))}
    </div>
  )
}

export function FbsInfoPage() {
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-5 lg:p-7">
        <section className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Статусы заказов и поставок FBS</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                У заказа FBS одновременно два статуса: <code className="font-semibold text-violet-700">supplierStatus</code> показывает действие продавца,
                а <code className="font-semibold text-blue-700">wbStatus</code> — состояние заказа внутри Wildberries.
              </p>
            </div>
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-medium text-violet-700">Актуально: 20.08.2026</span>
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
            Это не 15 последовательных этапов. WB возвращает пару значений, например <strong>complete + waiting</strong>.
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">Статусы продавца — supplierStatus</h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">4</span>
          </div>
          <StatusList statuses={supplierStatuses} tone="violet" />
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800">Статусы системы WB — wbStatus</h2>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">11</span>
          </div>
          <StatusList statuses={wbStatuses} tone="blue" />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-800">Основные сочетания</h2>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {combinations.map(([pair, result], index) => (
              <div key={pair} className={`grid gap-1 px-4 py-2.5 sm:grid-cols-[280px_1fr] ${index > 0 ? 'border-t border-slate-100' : ''}`}>
                <code className="text-xs font-semibold text-slate-700">{pair}</code>
                <span className="text-xs text-slate-500">{result}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-800">Состояние поставки</h2>
            <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
              <p><code className="font-semibold text-emerald-700">done: false</code> — поставка открыта: можно добавлять и переносить заказы.</p>
              <p><code className="font-semibold text-slate-700">done: true</code> — поставка закрыта: добавлять заказы нельзя.</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">Закрытая поставка сама не сообщает, доставляются её заказы или уже завершены. Это определяется по статусам вложенных заказов.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-800">Основные переходы API</h2>
            <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
              <p><strong>Добавить в поставку:</strong> переводит заказ из <code>new</code> в <code>confirm</code>.</p>
              <p><strong>Передать поставку в доставку:</strong> закрывает её и переводит заказы в <code>complete</code>.</p>
              <p><strong>Отменить заказ:</strong> переводит его в <code>cancel</code> и удаляет из поставки.</p>
              <p><strong>Стикеры заказов:</strong> доступны в статусах <code>confirm</code> и <code>complete</code>.</p>
            </div>
          </div>
        </section>

        <p className="pb-4 text-[11px] text-slate-400">Источник: официальная документация Wildberries API — Заказы FBS.</p>
      </div>
    </div>
  )
}
