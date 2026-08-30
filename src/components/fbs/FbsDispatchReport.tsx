import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  dispatched_quantity: number
  accepted_quantity: number
}

interface Props {
  accountId: string
  storeId: string
  stores: Array<{ id: string; name: string }>
  wbDestinations: Array<{ id: number; name: string }>
  onStoreChange: (storeId: string) => void
  periodControlsContainerId: string
}

type PeriodPreset = 'week' | 'month' | 'quarter'

const PERIOD_PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
]

interface SavedDispatchFilters {
  periodFrom: string
  periodTo: string
  wbOfficeId: string
  selectedPreset: PeriodPreset | null
  search: string
}

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

function defaultDispatchFilters(): SavedDispatchFilters {
  return {
    periodFrom: initialPeriodFrom(),
    periodTo: localDateValue(new Date()),
    wbOfficeId: '',
    selectedPreset: null,
    search: '',
  }
}

function loadDispatchFilters(storageKey: string): SavedDispatchFilters {
  const fallback = defaultDispatchFilters()
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<SavedDispatchFilters>
    const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    const periodFrom = validDate(saved.periodFrom) ? saved.periodFrom : fallback.periodFrom
    const periodTo = validDate(saved.periodTo) ? saved.periodTo : fallback.periodTo
    const selectedPreset = PERIOD_PRESETS.some((preset) => preset.key === saved.selectedPreset)
      ? saved.selectedPreset as PeriodPreset
      : null
    return {
      periodFrom: periodFrom <= periodTo ? periodFrom : fallback.periodFrom,
      periodTo: periodFrom <= periodTo ? periodTo : fallback.periodTo,
      wbOfficeId: typeof saved.wbOfficeId === 'string' ? saved.wbOfficeId : '',
      selectedPreset,
      search: typeof saved.search === 'string' ? saved.search : '',
    }
  } catch {
    return fallback
  }
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

export function FbsDispatchReport({
  accountId,
  storeId,
  stores,
  wbDestinations,
  onStoreChange,
  periodControlsContainerId,
}: Props) {
  const filtersStorageKey = useMemo(() => `fbs_dispatch_filters_${accountId}_${storeId}`, [accountId, storeId])
  const initialFilters = useMemo(() => loadDispatchFilters(filtersStorageKey), [filtersStorageKey])
  const [periodFrom, setPeriodFrom] = useState(initialFilters.periodFrom)
  const [periodTo, setPeriodTo] = useState(initialFilters.periodTo)
  const [wbOfficeId, setWbOfficeId] = useState(initialFilters.wbOfficeId)
  const [selectedPreset, setSelectedPreset] = useState<PeriodPreset | null>(initialFilters.selectedPreset)
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const [rows, setRows] = useState<DispatchReportRow[]>([])
  const [search, setSearch] = useState(initialFilters.search)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [periodControlsTarget, setPeriodControlsTarget] = useState<HTMLElement | null>(null)
  const reportRequestIdRef = useRef(0)

  useEffect(() => {
    setPeriodControlsTarget(document.getElementById(periodControlsContainerId))
  }, [periodControlsContainerId])

  const loadReport = useCallback(async (
    from: string,
    to: string,
    selectedWbOfficeId: string,
  ) => {
    if (!supabase || !accountId || !storeId) return
    const requestId = ++reportRequestIdRef.current
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
        p_internal_warehouse_id: null,
        p_wb_office_id: selectedWbOfficeId ? Number(selectedWbOfficeId) : null,
      })
      if (requestError) throw requestError
      if (requestId !== reportRequestIdRef.current) return
      setRows(((data ?? []) as DispatchReportRow[]).map((row) => ({
        ...row,
        dispatched_quantity: Number(row.dispatched_quantity ?? 0),
        accepted_quantity: Number(row.accepted_quantity ?? 0),
      })))
    } catch (requestError) {
      if (requestId !== reportRequestIdRef.current) return
      setRows([])
      setError(toUserMessage(requestError))
    } finally {
      if (requestId === reportRequestIdRef.current) setLoading(false)
    }
  }, [accountId, storeId])

  useEffect(() => {
    void loadReport(
      initialFilters.periodFrom,
      initialFilters.periodTo,
      initialFilters.wbOfficeId,
    )
  }, [initialFilters, loadReport])

  useEffect(() => {
    try {
      localStorage.setItem(filtersStorageKey, JSON.stringify({
        periodFrom,
        periodTo,
        wbOfficeId,
        selectedPreset,
        search,
      } satisfies SavedDispatchFilters))
    } catch {
      // Настройки продолжают работать в текущей вкладке без localStorage.
    }
  }, [filtersStorageKey, periodFrom, periodTo, search, selectedPreset, wbOfficeId])

  useEffect(() => {
    if (wbDestinations.length > 0 && wbOfficeId
      && !wbDestinations.some((warehouse) => String(warehouse.id) === wbOfficeId)) {
      setWbOfficeId('')
    }
  }, [wbDestinations, wbOfficeId])

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
    dispatched: result.dispatched + row.dispatched_quantity,
    accepted: result.accepted + row.accepted_quantity,
  }), { dispatched: 0, accepted: 0 }), [rows])

  const applyPeriod = () => {
    if (!periodFrom || !periodTo || periodFrom > periodTo) {
      setError('Дата начала не может быть позже даты окончания.')
      return
    }
    void loadReport(periodFrom, periodTo, wbOfficeId)
  }

  const applyPreset = (preset: PeriodPreset) => {
    const period = presetPeriod(preset)
    setPeriodFrom(period.from)
    setPeriodTo(period.to)
    setSelectedPreset(preset)
    setPresetMenuOpen(false)
    void loadReport(period.from, period.to, wbOfficeId)
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

  const periodControls = (
    <div className="flex items-end gap-3">
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-slate-600">
        <span className="whitespace-nowrap">С</span>
        <input
          type="date"
          value={periodFrom}
          max={periodTo}
          onChange={(event) => { setPeriodFrom(event.target.value); setSelectedPreset(null) }}
          className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
        />
      </label>
      <label className="flex h-9 items-center gap-2 text-xs font-semibold text-slate-600">
        <span className="whitespace-nowrap">По</span>
        <input
          type="date"
          value={periodTo}
          min={periodFrom}
          max={localDateValue(new Date())}
          onChange={(event) => { setPeriodTo(event.target.value); setSelectedPreset(null) }}
          className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
        />
      </label>
      <div className={`flex h-9 items-center gap-2 ${presetMenuOpen ? 'relative z-30' : ''}`}>
        <span className="whitespace-nowrap text-xs font-semibold text-slate-600">Период</span>
        <div className="relative h-9 w-[132px]">
          {presetMenuOpen && (
            <button
              type="button"
              aria-label="Закрыть меню периода"
              onClick={() => setPresetMenuOpen(false)}
              className="fixed inset-0 z-20 cursor-default"
            />
          )}
          <button
            type="button"
            disabled={loading || !storeId}
            onClick={() => setPresetMenuOpen((open) => !open)}
            className="relative z-30 flex h-9 w-[132px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-violet-300 disabled:cursor-wait disabled:opacity-50"
          >
            <span>{PERIOD_PRESETS.find((preset) => preset.key === selectedPreset)?.label ?? 'Выбрать'}</span>
            <svg viewBox="0 0 24 24" className={`h-4 w-4 text-slate-400 transition-transform ${presetMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {presetMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              {PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.key)}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${selectedPreset === preset.key
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                >
                  {preset.label}
                  {selectedPreset === preset.key && <span className="h-2 w-2 rounded-full bg-violet-500" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={loading || !storeId}
        onClick={applyPeriod}
        className="relative flex h-9 w-[108px] shrink-0 cursor-pointer items-center justify-center rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-50"
      >
        {loading && <svg className="absolute left-2.5 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>}
        <span>Показать</span>
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 p-5">
      {periodControlsTarget && createPortal(periodControls, periodControlsTarget)}
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
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              <span className="block">На склад WB</span>
              <select
                value={wbOfficeId}
                onChange={(event) => setWbOfficeId(event.target.value)}
                className="h-9 min-w-[280px] max-w-[380px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
              >
                <option value="">Все склады</option>
                {wbDestinations.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
            <div className="flex-1" />
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
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-2xl font-bold text-violet-700">{totals.dispatched.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">товаров передано в доставку</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-2xl font-bold text-emerald-700">{totals.accepted.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">товаров принято WB</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-2xl font-bold text-slate-900">{rows.length.toLocaleString('ru-RU')}</div>
            <div className="mt-1 text-xs text-slate-500">уникальных баркодов</div>
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
              {rows.length === 0
                ? 'За выбранный период передач или приёмок WB не найдено'
                : 'По вашему запросу ничего не найдено'}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
              <table className="min-w-[920px] w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Товар</th>
                    <th className="px-4 py-3 font-semibold">Баркод</th>
                    <th className="px-4 py-3 font-semibold">Артикулы</th>
                    <th className="px-4 py-3 font-semibold">Размер / цвет</th>
                    <th className="px-4 py-3 text-right font-semibold">Передано</th>
                    <th className="px-4 py-3 text-right font-semibold">Принято WB</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
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
                              title={copied === row.product_barcode ? 'Скопировано' : 'Скопировать баркод'}
                              aria-label={copied === row.product_barcode ? 'Баркод скопирован' : 'Скопировать баркод'}
                              onClick={() => void handleCopy(row.product_barcode)}
                              className={`cursor-copy whitespace-nowrap rounded-md px-1.5 py-1 font-mono font-semibold transition-colors ${copied === row.product_barcode
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'text-blue-600 hover:bg-blue-50'}`}
                            >
                              {row.product_barcode}
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
                        <td className="px-4 py-3 text-right text-lg font-extrabold text-violet-700">{row.dispatched_quantity.toLocaleString('ru-RU')}</td>
                        <td className="px-4 py-3 text-right text-lg font-extrabold text-emerald-700">{row.accepted_quantity.toLocaleString('ru-RU')}</td>
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
