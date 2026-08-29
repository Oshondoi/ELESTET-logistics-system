import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/userMessage'
import { PhotoThumb } from '../ui/PhotoThumb'

interface DispatchReportRow {
  product_barcode: string
  nm_id: number | null
  article: string | null
  vendor_code: string | null
  product_name: string | null
  brand: string | null
  color: string | null
  tech_size: string | null
  photo_url: string | null
  quantity: number
  orders_count: number
  supplies_count: number
  first_dispatched_at: string
  last_dispatched_at: string
  estimated_quantity: number
}

interface Props {
  accountId: string
  storeId: string
  stores: Array<{ id: string; name: string }>
  onStoreChange: (storeId: string) => void
}

type PeriodPreset = 'week' | 'month' | 'quarter'

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialPeriodFrom() {
  const date = new Date()
  date.setDate(1)
  return localDateValue(date)
}

function presetPeriod(preset: PeriodPreset) {
  const today = new Date()
  const from = new Date(today)

  if (preset === 'week') {
    const dayFromMonday = (today.getDay() + 6) % 7
    from.setDate(today.getDate() - dayFromMonday)
  } else if (preset === 'month') {
    from.setDate(1)
  } else {
    from.setMonth(Math.floor(today.getMonth() / 3) * 3, 1)
  }

  return { from: localDateValue(from), to: localDateValue(today) }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

export function FbsDispatchReport({ accountId, storeId, stores, onStoreChange }: Props) {
  const [periodFrom, setPeriodFrom] = useState(initialPeriodFrom)
  const [periodTo, setPeriodTo] = useState(() => localDateValue(new Date()))
  const [rows, setRows] = useState<DispatchReportRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const activePreset = useMemo<PeriodPreset | null>(() => {
    const presets: PeriodPreset[] = ['week', 'month', 'quarter']
    return presets.find((preset) => {
      const period = presetPeriod(preset)
      return periodFrom === period.from && periodTo === period.to
    }) ?? null
  }, [periodFrom, periodTo])

  const loadReport = useCallback(async (from: string, to: string) => {
    if (!supabase || !accountId || !storeId) return
    setLoading(true)
    setError(null)
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bishkek'
      const { data, error: requestError } = await (supabase as any).rpc('get_fbs_dispatch_report', {
        p_account_id: accountId,
        p_store_id: storeId,
        p_period_from: from,
        p_period_to: to,
        p_timezone: timezone,
      })
      if (requestError) throw requestError
      setRows(((data ?? []) as DispatchReportRow[]).map((row) => ({
        ...row,
        quantity: Number(row.quantity ?? 0),
        orders_count: Number(row.orders_count ?? 0),
        supplies_count: Number(row.supplies_count ?? 0),
        estimated_quantity: Number(row.estimated_quantity ?? 0),
      })))
    } catch (requestError) {
      setRows([])
      setError(toUserMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [accountId, storeId])

  useEffect(() => {
    const from = initialPeriodFrom()
    const to = localDateValue(new Date())
    setPeriodFrom(from)
    setPeriodTo(to)
    setSearch('')
    void loadReport(from, to)
  }, [loadReport])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    if (!query) return rows
    return rows.filter((row) => [
      row.product_barcode,
      row.product_name,
      row.vendor_code,
      row.article,
      row.nm_id,
      row.brand,
      row.color,
      row.tech_size,
    ].some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(query)))
  }, [rows, search])

  const totals = useMemo(() => rows.reduce((result, row) => ({
    quantity: result.quantity + row.quantity,
    orders: result.orders + row.orders_count,
    estimated: result.estimated + row.estimated_quantity,
  }), { quantity: 0, orders: 0, estimated: 0 }), [rows])

  const applyPeriod = () => {
    if (!periodFrom || !periodTo || periodFrom > periodTo) {
      setError('Дата начала не может быть позже даты окончания.')
      return
    }
    void loadReport(periodFrom, periodTo)
  }

  const applyPreset = (preset: PeriodPreset) => {
    const period = presetPeriod(preset)
    setPeriodFrom(period.from)
    setPeriodTo(period.to)
    void loadReport(period.from, period.to)
  }

  const handleCopy = async (value: string) => {
    if (!value) return
    try {
      await copyText(value)
      setCopied(value)
      window.setTimeout(() => setCopied((current) => current === value ? null : current), 1600)
    } catch {
      setError('Не удалось скопировать баркод. Разрешите браузеру доступ к буферу обмена.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 p-5">
      <div className="shrink-0 space-y-4 pb-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              <span className="block">Магазин</span>
              <select
                value={storeId}
                onChange={(event) => onStoreChange(event.target.value)}
                className="h-9 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
              >
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-600">Быстрый период</span>
              <div className="flex h-9 items-center rounded-xl bg-slate-100 p-1">
                {([
                  { key: 'week' as const, label: 'Неделя' },
                  { key: 'month' as const, label: 'Месяц' },
                  { key: 'quarter' as const, label: 'Квартал' },
                ]).map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={loading || !storeId}
                    onClick={() => applyPreset(preset.key)}
                    className={`h-7 cursor-pointer rounded-lg px-3 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-50 ${activePreset === preset.key
                      ? 'bg-white text-violet-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              <span className="block">С даты</span>
              <input
                type="date"
                value={periodFrom}
                max={periodTo}
                onChange={(event) => setPeriodFrom(event.target.value)}
                className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
              />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              <span className="block">По дату</span>
              <input
                type="date"
                value={periodTo}
                min={periodFrom}
                max={localDateValue(new Date())}
                onChange={(event) => setPeriodTo(event.target.value)}
                className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
              />
            </label>
            <button
              type="button"
              disabled={loading || !storeId}
              onClick={applyPeriod}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-50"
            >
              {loading && <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>}
              {loading ? 'Загрузка...' : 'Показать'}
            </button>
            <div className="min-w-[240px] flex-1" />
            <div className="relative min-w-[260px] flex-1 xl:max-w-md">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Баркод, товар, артикул, размер..."
                className="h-9 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none transition focus:border-violet-400"
              />
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            Здесь учитываются все заказы, переданные в доставку Wildberries, даже если товар не выбирали из короба ELESTET.
            Передачи, найденные по истории статусов WB, помечены как приблизительные по времени.
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-2xl font-bold text-violet-700">{totals.quantity.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">товаров передано в WB</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-2xl font-bold text-slate-900">{rows.length.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">уникальных баркодов</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className={`text-2xl font-bold ${totals.estimated > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totals.estimated.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">с приблизительным временем</div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>
              Загружаем отчёт...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-slate-400">
              {rows.length === 0 ? 'За выбранный период отгрузок не найдено' : 'По вашему запросу ничего не найдено'}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
              <table className="min-w-[1080px] w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Товар</th>
                    <th className="px-4 py-3 font-semibold">Баркод</th>
                    <th className="px-4 py-3 font-semibold">Артикулы</th>
                    <th className="px-4 py-3 font-semibold">Размер / цвет</th>
                    <th className="px-4 py-3 text-right font-semibold">Передано</th>
                    <th className="px-4 py-3 text-right font-semibold">Заказов</th>
                    <th className="px-5 py-3 font-semibold">Время</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const partlyEstimated = row.estimated_quantity > 0
                    return (
                      <tr key={row.product_barcode || `${row.nm_id}:${row.tech_size}`} className="border-t border-slate-100 transition hover:bg-slate-50/70">
                        <td className="px-5 py-3">
                          <div className="flex min-w-[260px] items-center gap-3">
                            <PhotoThumb url={row.photo_url} className="h-11 w-11 shrink-0 rounded-lg" />
                            <div className="min-w-0">
                              <div className="max-w-[320px] truncate font-semibold text-slate-900">{row.product_name || `Товар WB ${row.nm_id ?? '—'}`}</div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-400">{row.brand || 'Бренд не указан'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {row.product_barcode ? (
                            <button
                              type="button"
                              title="Скопировать баркод"
                              onClick={() => void handleCopy(row.product_barcode)}
                              className="cursor-copy rounded-md px-1.5 py-1 font-mono font-semibold text-blue-600 transition hover:bg-blue-50"
                            >
                              {row.product_barcode}
                              {copied === row.product_barcode && <span className="ml-2 font-sans text-[10px] text-emerald-600">Скопировано</span>}
                            </button>
                          ) : <span className="font-semibold text-red-500">Не определён</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>WB: <span className="font-medium text-slate-800">{row.nm_id ?? '—'}</span></div>
                          <div className="mt-1">Продавца: <span className="font-medium text-slate-800">{row.vendor_code || row.article || '—'}</span></div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-lg bg-blue-50 px-2 py-1 font-bold text-blue-700">{row.tech_size || '—'}</span>
                            <span className="rounded-lg bg-violet-50 px-2 py-1 font-semibold text-violet-700">{row.color || '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-lg font-extrabold text-slate-900">{row.quantity.toLocaleString('ru-RU')}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-600">{row.orders_count.toLocaleString('ru-RU')}</td>
                        <td className="px-5 py-3">
                          <div className="whitespace-nowrap text-slate-700">{formatDateTime(row.last_dispatched_at)}</div>
                          {partlyEstimated ? (
                            <div className="mt-1 inline-flex rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700" title="WB не передаёт точное время действия для старой истории. Использовано время, когда сервис увидел статус.">
                              Примерно: {row.estimated_quantity} шт.
                            </div>
                          ) : (
                            <div className="mt-1 text-[10px] font-semibold text-emerald-600">Точное время</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}
