import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { kizValidationError, normalizeKizCode } from '../../lib/kizCode'
import { showScanSuccess } from '../ui/ScanSuccessOverlay'
import {
  deleteFulfillmentKizPair,
  relinkFulfillmentKizPair,
  type FulfillmentKizAuditContext,
} from '../../services/fulfillmentService'
import type { FulfillmentKizPair } from '../../types'

const GS = '\u001d'

interface Props {
  open: boolean
  boxId: string
  barcode: string
  productName: string | null
  pairs: FulfillmentKizPair[]
  auditContext: FulfillmentKizAuditContext
  readOnly?: boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
}

function KizValue({ value }: { value: string }) {
  const parts = value.split(GS)
  return (
    <span className="break-all font-mono text-[11px] leading-5 text-slate-100">
      {parts.map((part, index) => (
        <span key={`${index}-${part}`}>
          {index > 0 && <span className="mx-1 rounded bg-amber-400 px-1 py-0.5 text-[9px] font-black text-slate-950">GS</span>}
          {part}
        </span>
      ))}
    </span>
  )
}

function PairDetails({ pair, onClose }: { pair: FulfillmentKizPair; onClose: () => void }) {
  const snapshot = pair.product_snapshot ?? {}
  const hierarchy = pair.hierarchy_snapshot ?? {}
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-3" onMouseDown={onClose}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900">Данные скана</h3>
            <p className="mt-0.5 text-xs text-slate-400">{new Date(pair.created_at).toLocaleString('ru-RU')}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">×</button>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-950 p-4">
          <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            <span>КИЗ, сохранённый системой</span>
            <span>Байт: {pair.kiz_raw.length} · GS: {Math.max(0, pair.kiz_raw.split(GS).length - 1)}</span>
          </div>
          <KizValue value={pair.kiz_raw} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">GTIN</span><b className="mt-1 block font-mono text-slate-800">{pair.gtin}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Серийный номер</span><b className="mt-1 block break-all font-mono text-slate-800">{pair.serial_number}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Баркод товара</span><b className="mt-1 block font-mono text-slate-800">{pair.barcode}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Статус</span><b className="mt-1 block text-slate-800">{pair.status === 'committed' ? 'Записан в короб' : 'Ожидает записи в короб'}</b></div>
          <div className="col-span-2 rounded-xl bg-emerald-50 p-3"><span className="text-emerald-600">Товар «Честного знака»</span><b className="mt-1 block text-emerald-950">{String(snapshot.honest_sign_name || snapshot.honest_sign_full_name || snapshot.product_name || '—')}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Артикул ЧЗ</span><b className="mt-1 block text-slate-800">{String(snapshot.honest_sign_article || '—')}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Размер / цвет</span><b className="mt-1 block text-slate-800">{[snapshot.size, snapshot.color].filter(Boolean).join(' · ') || '—'}</b></div>
          <div className="col-span-2 rounded-xl bg-blue-50 p-3"><span className="text-blue-500">Положение</span><b className="mt-1 block text-blue-950">P-{String(hierarchy.batch_short_id ?? '?')} · S-{String(hierarchy.supply_number ?? '?')} · Короб №{String(hierarchy.box_number ?? '?')}</b><span className="mt-1 block font-mono text-[10px] text-blue-500">{String(hierarchy.box_barcode ?? '')}</span></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Сотрудник</span><b className="mt-1 block text-slate-800">{pair.actor_name || pair.actor_email || '—'}</b></div>
          <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Устройство</span><b className="mt-1 block text-slate-800">{pair.device_name || '—'}</b><span className="block text-[10px] text-slate-400">{pair.scanner_model || pair.device_id}</span></div>
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white">Закрыть</button>
      </div>
    </div>,
    document.body,
  )
}

export function FulfillmentKizPairsModal({ open, boxId, barcode, productName, pairs, auditContext, readOnly = false, onClose, onChanged }: Props) {
  const [selectedPair, setSelectedPair] = useState<FulfillmentKizPair | null>(null)
  const [relinkPairId, setRelinkPairId] = useState<string | null>(null)
  const [highlightedPairId, setHighlightedPairId] = useState<string | null>(null)
  const [busyPairId, setBusyPairId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const bufferRef = useRef('')
  const clearBufferTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const altNumpadDigitsRef = useRef('')
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const activePairs = useMemo(
    () => pairs.filter((pair) => pair.box_id === boxId && pair.barcode === barcode && (pair.status === 'draft' || pair.status === 'committed')),
    [barcode, boxId, pairs],
  )

  const highlightPair = useCallback((pairId: string) => {
    setHighlightedPairId(pairId)
    window.requestAnimationFrame(() => rowRefs.current.get(pairId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => setHighlightedPairId(null), 2500)
  }, [])

  const processScan = useCallback(async (rawValue: string) => {
    const normalized = normalizeKizCode(rawValue)
    if (relinkPairId) {
      const validationError = kizValidationError(normalized)
      if (validationError) {
        setMessage(validationError)
        return
      }
      setBusyPairId(relinkPairId)
      setMessage('')
      try {
        const updated = await relinkFulfillmentKizPair(relinkPairId, rawValue, normalized, auditContext)
        setRelinkPairId(null)
        await onChanged()
        highlightPair(updated.id)
        showScanSuccess({
          kind: 'kiz',
          primary: String(updated.product_snapshot.honest_sign_article || updated.product_snapshot.size || 'КИЗ'),
          details: [updated.product_snapshot.size, updated.product_snapshot.color, updated.product_snapshot.honest_sign_article].filter(Boolean).map(String),
          title: 'КИЗ пересвязан',
        })
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Не удалось пересвязать КИЗ')
      } finally {
        setBusyPairId(null)
      }
      return
    }

    const found = activePairs.find((pair) => pair.kiz_normalized === normalized)
    if (!found) {
      setMessage('В списке этого товара такой КИЗ не найден')
      return
    }
    setMessage('')
    highlightPair(found.id)
    showScanSuccess({
      kind: 'kiz',
      primary: String(found.product_snapshot.honest_sign_article || found.product_snapshot.size || 'КИЗ'),
      details: [found.product_snapshot.size, found.product_snapshot.color, found.product_snapshot.honest_sign_article].filter(Boolean).map(String),
      title: 'КИЗ найден',
    })
  }, [activePairs, auditContext, highlightPair, onChanged, relinkPairId])

  useEffect(() => {
    if (!open || selectedPair) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'F8') {
        bufferRef.current += GS
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.altKey && /^Numpad\d$/.test(event.code)) {
        altNumpadDigitsRef.current += event.code.slice(-1)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Enter') {
        const value = bufferRef.current
        bufferRef.current = ''
        if (clearBufferTimerRef.current) window.clearTimeout(clearBufferTimerRef.current)
        if (value) void processScan(value)
        event.preventDefault()
        return
      }
      if (event.key.length === 1) {
        bufferRef.current += event.key
        if (clearBufferTimerRef.current) window.clearTimeout(clearBufferTimerRef.current)
        clearBufferTimerRef.current = window.setTimeout(() => { bufferRef.current = '' }, 220)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || altNumpadDigitsRef.current.length === 0) return
      const digits = altNumpadDigitsRef.current
      altNumpadDigitsRef.current = ''
      if (digits.replace(/^0+/, '') === '29') {
        bufferRef.current += GS
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      altNumpadDigitsRef.current = ''
    }
  }, [open, processScan, selectedPair])

  useEffect(() => () => {
    if (clearBufferTimerRef.current) window.clearTimeout(clearBufferTimerRef.current)
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
  }, [])

  if (!open) return null
  return createPortal(
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
        <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="font-black text-slate-900">КИЗы товара</h3>
              <p className="mt-0.5 text-sm text-slate-500">{productName || 'Товар'} · <span className="font-mono">{barcode}</span></p>
              <p className="mt-1 text-xs text-blue-600">Сканируйте КИЗ в любом месте окна — система прокрутит список к нему.</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">×</button>
          </div>
          {message && <div className="mx-5 mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{message}</div>}
          {relinkPairId && <div className="mx-5 mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><span>Отсканируйте новый КИЗ для выбранной пары</span><button type="button" onClick={() => setRelinkPairId(null)} className="text-xs underline">Отмена</button></div>}
          <div className="flex-1 space-y-2 overflow-y-auto p-5">
            {activePairs.map((pair, index) => (
              <div
                key={pair.id}
                ref={(node) => { if (node) rowRefs.current.set(pair.id, node); else rowRefs.current.delete(pair.id) }}
                onClick={() => setSelectedPair(pair)}
                className={`cursor-pointer rounded-2xl border p-3 transition-all ${highlightedPairId === pair.id ? 'border-emerald-500 bg-emerald-100 ring-2 ring-emerald-400' : pair.status === 'draft' ? 'border-amber-200 bg-amber-50/70 hover:border-amber-400' : 'border-emerald-200 bg-white hover:bg-emerald-50/50'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-slate-500 shadow-sm">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><b className="text-sm text-slate-800">{pair.status === 'draft' ? 'Не записан в короб' : 'Записан в короб'}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${pair.status === 'draft' ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-700'}`}>{pair.status === 'draft' ? 'ЧЕРНОВИК' : 'ЗАПИСАН'}</span></div>
                    <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{pair.kiz_raw.split(GS).join(' ‹GS› ')}</div>
                    <div className="mt-1 text-[10px] text-slate-400">GTIN {pair.gtin} · {new Date(pair.created_at).toLocaleString('ru-RU')}</div>
                  </div>
                  {!readOnly && (
                    <div className="flex shrink-0 gap-1" onClick={(event) => event.stopPropagation()}>
                      <button type="button" disabled={busyPairId === pair.id} onClick={() => { setMessage(''); setRelinkPairId(pair.id) }} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-40">Пересвязать</button>
                      <button type="button" disabled={busyPairId === pair.id} onClick={async () => {
                        if (!window.confirm('Удалить эту пару КИЗ? Запись останется в истории.')) return
                        setBusyPairId(pair.id)
                        setMessage('')
                        try {
                          await deleteFulfillmentKizPair(pair.id, 'Пара удалена оператором в окне короба', auditContext)
                          await onChanged()
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : 'Не удалось удалить пару')
                        } finally { setBusyPairId(null) }
                      }} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 disabled:opacity-40">Удалить пару</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {activePairs.length === 0 && <div className="py-12 text-center text-sm text-slate-400">Для этого баркода пары КИЗ ещё не создавались</div>}
          </div>
        </div>
      </div>
      {selectedPair && <PairDetails pair={selectedPair} onClose={() => setSelectedPair(null)} />}
    </>,
    document.body,
  )
}
