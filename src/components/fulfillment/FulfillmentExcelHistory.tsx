import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchFulfillmentExcelActionHistory,
  fetchFulfillmentExcelActionHistoryDetails,
  type FulfillmentExcelActionHistory,
} from '../../services/fulfillmentService'

interface Props {
  supplyId: string
}

interface ContentsSnapshotRow {
  box_number: number
  exists?: boolean
  items?: Array<{ barcode?: string; qty?: number; product_name?: string | null }>
}

interface WbSnapshotRow {
  box_number: number
  wb_barcode?: string | null
  wb_external_barcode?: string | null
}

const historyDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const asContentsRows = (value: unknown): ContentsSnapshotRow[] => Array.isArray(value)
  ? value.filter((row): row is ContentsSnapshotRow => Boolean(row) && typeof row === 'object' && typeof (row as ContentsSnapshotRow).box_number === 'number')
  : []

const asWbRows = (value: unknown): WbSnapshotRow[] => Array.isArray(value)
  ? value.filter((row): row is WbSnapshotRow => Boolean(row) && typeof row === 'object' && typeof (row as WbSnapshotRow).box_number === 'number')
  : []

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'Не удалось загрузить историю Excel.'

function ContentsDetails({ entry }: { entry: FulfillmentExcelActionHistory }) {
  const before = asContentsRows(entry.details?.before)
  const after = asContentsRows(entry.details?.after)
  const beforeByNumber = useMemo(() => new Map(before.map((row) => [row.box_number, row])), [before])
  const afterByNumber = useMemo(() => new Map(after.map((row) => [row.box_number, row])), [after])
  const numbers = useMemo(() => [...new Set([...beforeByNumber.keys(), ...afterByNumber.keys()])].sort((a, b) => a - b), [beforeByNumber, afterByNumber])

  const items = (row: ContentsSnapshotRow | undefined) => {
    if (row?.exists === false) return <p className="text-xs text-slate-400">Короб отсутствовал</p>
    if (!row?.items?.length) return <p className="text-xs text-slate-400">Пустой короб</p>
    return <div className="space-y-1">{row.items.map((item, index) => (
      <p key={`${item.barcode ?? 'item'}-${index}`} className="break-all text-xs text-slate-700">
        <span className="font-semibold">{item.barcode || 'Без баркода'}</span> × {item.qty ?? 0}
        {item.product_name && <span className="ml-1 text-slate-400">· {item.product_name}</span>}
      </p>
    ))}</div>
  }

  return <div className="space-y-2">
    {numbers.map((boxNumber) => <div key={boxNumber} className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-bold text-slate-800">Короб №{boxNumber}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-slate-50 p-2"><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">До загрузки</p>{items(beforeByNumber.get(boxNumber))}</div>
        <div className="min-w-0 rounded-lg bg-blue-50 p-2"><p className="mb-1 text-[10px] font-bold uppercase text-blue-500">После загрузки</p>{items(afterByNumber.get(boxNumber))}</div>
      </div>
    </div>)}
  </div>
}

function WbDetails({ entry }: { entry: FulfillmentExcelActionHistory }) {
  const before = asWbRows(entry.details?.before)
  const after = asWbRows(entry.details?.after)
  const beforeByNumber = new Map(before.map((row) => [row.box_number, row]))

  return <div className="space-y-2">
    {after.map((next) => {
      const previous = beforeByNumber.get(next.box_number)
      const unchanged = previous?.wb_barcode === next.wb_barcode
        && previous?.wb_external_barcode === next.wb_external_barcode
      return <div key={next.box_number} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)]">
        <div><p className="text-xs font-bold text-slate-800">Короб №{next.box_number}</p><p className={`mt-1 text-[10px] font-semibold ${unchanged ? 'text-emerald-600' : 'text-amber-600'}`}>{unchanged ? 'Без изменений' : 'Изменён'}</p></div>
        <div className="min-w-0 rounded-lg bg-slate-50 p-2"><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">До загрузки</p><p className="break-all text-xs text-slate-600"><span className="text-slate-400">ШК WB: </span>{previous?.wb_barcode || 'Не привязан'}</p><p className="mt-1 break-all text-xs text-slate-500"><span className="text-slate-400">Для печати: </span>{previous?.wb_external_barcode || 'Не привязан'}</p></div>
        <div className="min-w-0 rounded-lg bg-violet-50 p-2"><p className="mb-1 text-[10px] font-bold uppercase text-violet-500">После загрузки</p><p className="break-all text-xs font-semibold text-slate-800"><span className="font-normal text-violet-400">ШК WB: </span>{next.wb_barcode || '—'}</p><p className="mt-1 break-all text-xs text-slate-700"><span className="text-violet-400">Для печати: </span>{next.wb_external_barcode || '—'}</p></div>
      </div>
    })}
  </div>
}

export function FulfillmentExcelHistory({ supplyId }: Props) {
  const [entries, setEntries] = useState<FulfillmentExcelActionHistory[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailsById, setDetailsById] = useState<Record<string, NonNullable<FulfillmentExcelActionHistory['details']>>>({})
  const [detailsLoadingById, setDetailsLoadingById] = useState<Record<string, boolean>>({})
  const [detailsErrorById, setDetailsErrorById] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setEntries(await fetchFulfillmentExcelActionHistory(supplyId)) }
    catch (reason) { setError(errorText(reason)) }
    finally { setLoading(false) }
  }, [supplyId])

  useEffect(() => { void load() }, [load])

  const loadEntryDetails = async (entry: FulfillmentExcelActionHistory) => {
    setDetailsErrorById((current) => ({ ...current, [entry.id]: false }))
    setDetailsLoadingById((current) => ({ ...current, [entry.id]: true }))
    try {
      const details = await fetchFulfillmentExcelActionHistoryDetails(entry.id, supplyId)
      setDetailsById((current) => ({ ...current, [entry.id]: details }))
    } catch {
      setDetailsErrorById((current) => ({ ...current, [entry.id]: true }))
    } finally {
      setDetailsLoadingById((current) => ({ ...current, [entry.id]: false }))
    }
  }

  const toggleEntry = (entry: FulfillmentExcelActionHistory) => {
    if (expandedId === entry.id) { setExpandedId(null); return }
    setExpandedId(entry.id)
    if (!detailsById[entry.id]) void loadEntryDetails(entry)
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-400">Загрузка истории…</div>
  if (error) return <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"><p className="text-sm text-red-600">{error}</p><button type="button" onClick={() => void load()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Повторить</button></div>
  if (entries.length === 0) return <div className="flex min-h-64 flex-col items-center justify-center text-center"><p className="text-sm font-semibold text-slate-600">История Excel пока пуста</p><p className="mt-1 text-xs text-slate-400">Здесь появятся загрузки содержимого коробов и WB ШК.</p></div>

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-800">История Excel</p><p className="text-xs text-slate-400">Последние 100 загрузок этой поставки</p></div><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Обновить</button></div>
    {entries.map((entry) => {
      const expanded = expandedId === entry.id
      const isWb = entry.action_type === 'wb_box_codes_import'
      const summary = entry.summary ?? {}
      const total = Number(summary.total ?? summary.affected_boxes ?? 0)
      const detailedEntry = detailsById[entry.id] ? { ...entry, details: detailsById[entry.id] } : entry
      return <article key={entry.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <button type="button" onClick={() => void toggleEntry(entry)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-white">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${isWb ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>XLS</span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-800">{isWb ? 'Загрузка WB ШК' : 'Загрузка содержимого коробов'}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.result === 'unchanged' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{entry.result === 'unchanged' ? 'Без изменений' : 'Применено'}</span></span><span className="mt-1 block truncate text-xs text-slate-500">{entry.source_filename || 'Имя файла не указано'}{total > 0 ? ` · ${total} кор.` : ''}</span><span className="mt-1 block text-[11px] text-slate-400">{entry.actor_name || entry.actor_email || 'Пользователь не указан'} · {historyDate.format(new Date(entry.created_at))}</span></span>
          <svg viewBox="0 0 24 24" className={`mt-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {expanded && <div className="border-t border-slate-200 bg-slate-50 p-3">
          {detailsLoadingById[entry.id]
            ? <p className="py-6 text-center text-xs font-semibold text-slate-400">Загрузка подробностей…</p>
            : detailsErrorById[entry.id]
              ? <button type="button" onClick={() => void loadEntryDetails(entry)} className="w-full py-6 text-center text-xs font-semibold text-red-600">Не удалось загрузить подробности. Нажмите, чтобы повторить.</button>
              : isWb ? <WbDetails entry={detailedEntry} /> : <ContentsDetails entry={detailedEntry} />}
        </div>}
      </article>
    })}
  </div>
}
