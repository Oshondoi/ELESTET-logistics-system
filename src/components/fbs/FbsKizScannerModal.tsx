import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { invokeFbs } from '../../services/fbsApi'

type ScanSession = {
  id: string
  status: 'active' | 'submitting' | 'partial' | 'completed' | 'cancelled'
  device_id: string
  pending_order_id: string | null
  pending_wb_qr: string | null
  pending_locked_until: string | null
  started_at: string
  last_seen_at?: string
  device_name?: string
}

type ScanPair = {
  id: string
  order_id: string
  wb_qr: string
  sgtin: string
  status: 'draft' | 'sending' | 'sent' | 'error'
  product_snapshot: { nm_id?: number; article?: string; barcode?: string; supply_id?: string }
  error: string | null
  created_at: string
}

type CatalogItem = {
  orderId: string
  qrValue: string
  partA?: string
  partB?: string
}

type OrderView = {
  id: string
  productName: string | null
  productSize: string | null
  productBarcode: string | null
  supply_id: string | null
}

type Props = {
  accountId: string
  storeId: string
  storeName: string
  orders: OrderView[]
  onClose: () => void
}

const DEVICE_KEY = 'elestet_fbs_scanner_device_v1'

function deviceId(): string {
  const saved = localStorage.getItem(DEVICE_KEY)
  if (saved && saved.length >= 8) return saved
  const next = crypto.randomUUID()
  localStorage.setItem(DEVICE_KEY, next)
  return next
}

function cleanScan(value: string, trimSpaces: boolean): string {
  const withoutTerminator = value.replace(/[\r\n]+$/g, '')
  return trimSpaces ? withoutTerminator.trim() : withoutTerminator
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^.*?message["']?\s*:\s*["']?/i, '').replace(/["'}]+$/g, '')
}

function signal(success: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = success ? 880 : 220
    gain.gain.value = 0.08
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + (success ? 0.07 : 0.18))
  } catch {
    // Цвет и текст остаются обязательной обратной связью, даже если звук запрещён браузером.
  }
}

export function FbsKizScannerModal({ accountId, storeId, storeName, orders, onClose }: Props) {
  const stableDeviceId = useMemo(deviceId, [])
  const [session, setSession] = useState<ScanSession | null>(null)
  const [pairs, setPairs] = useState<ScanPair[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogMissing, setCatalogMissing] = useState(0)
  const [recoverableSessions, setRecoverableSessions] = useState<ScanSession[]>([])
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sessionRef = useRef<ScanSession | null>(null)
  sessionRef.current = session

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const catalogByScan = useMemo(() => {
    const map = new Map<string, CatalogItem>()
    for (const item of catalog) {
      const aliases = [item.qrValue, item.orderId, `${item.partA ?? ''}${item.partB ?? ''}`]
      for (const alias of aliases) if (alias) map.set(cleanScan(alias, true), item)
    }
    return map
  }, [catalog])
  const pendingOrder = session?.pending_order_id ? ordersById.get(session.pending_order_id) : null

  const loadPairs = useCallback(async (sessionId: string) => {
    if (!supabase) return
    const { data, error: loadError } = await (supabase as any)
      .from('fbs_marking_pairs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
    if (loadError) throw loadError
    setPairs((data ?? []) as ScanPair[])
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    if (!supabase) return
    const { data, error: loadError } = await (supabase as any)
      .from('fbs_marking_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    if (loadError) throw loadError
    setSession(data as ScanSession)
  }, [])

  const loadRecoverableSessions = useCallback(async (currentSessionId: string) => {
    if (!supabase) return
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString()
    const { data } = await (supabase as any)
      .from('fbs_marking_sessions')
      .select('*')
      .eq('store_id', storeId)
      .in('status', ['active', 'partial'])
      .neq('id', currentSessionId)
      .lt('last_seen_at', staleBefore)
      .order('last_seen_at', { ascending: false })
    setRecoverableSessions((data ?? []) as ScanSession[])
  }, [storeId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!supabase) throw new Error('Supabase не настроен')
      setLoading(true)
      try {
        const [sessionResult, catalogResult] = await Promise.all([
          (supabase as any).rpc('start_fbs_marking_session', {
            p_account_id: accountId,
            p_store_id: storeId,
            p_device_id: stableDeviceId,
            p_device_name: `Браузер ${stableDeviceId.slice(0, 6)}`,
          }),
          invokeFbs(storeId, { action: 'get_scan_catalog' }),
        ])
        if (sessionResult.error) throw sessionResult.error
        if (cancelled) return
        const nextSession = sessionResult.data as ScanSession
        setSession(nextSession)
        setCatalog((catalogResult.catalog ?? []) as CatalogItem[])
        setCatalogMissing(Number(catalogResult.missing ?? 0))
        await Promise.all([loadPairs(nextSession.id), loadRecoverableSessions(nextSession.id)])
      } catch (loadError) {
        if (!cancelled) setError(`Не удалось открыть сканирование: ${errorText(loadError)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, loadPairs, loadRecoverableSessions, stableDeviceId, storeId])

  useEffect(() => {
    if (!supabase || !session?.id) return
    const client = supabase
    const channel = client
      .channel(`fbs-marking-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fbs_marking_pairs', filter: `session_id=eq.${session.id}` }, () => {
        void loadPairs(session.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fbs_marking_sessions', filter: `id=eq.${session.id}` }, () => {
        void loadSession(session.id)
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [loadPairs, loadSession, session?.id])

  useEffect(() => {
    if (!supabase || !session?.id || !['active', 'partial'].includes(session.status)) return
    const heartbeat = window.setInterval(() => {
      void (supabase as any).rpc('touch_fbs_marking_session', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
      }).then(({ data }: { data: ScanSession | null }) => { if (data) setSession(data) })
    }, 30_000)
    return () => window.clearInterval(heartbeat)
  }, [session?.id, session?.status, stableDeviceId])

  useEffect(() => {
    if (!busy && !loading && session?.status !== 'completed') inputRef.current?.focus()
  }, [busy, loading, session?.pending_order_id, session?.status])

  const handleScan = async () => {
    if (!supabase || !session || busy || session.status === 'completed') return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (!session.pending_order_id) {
        const scannedQr = cleanScan(value, true)
        const item = catalogByScan.get(scannedQr)
        if (!item) throw new Error('QR WB не найден среди заказов «На сборке» этого магазина')
        const { data, error: scanError } = await (supabase as any).rpc('scan_fbs_wb_qr', {
          p_session_id: session.id,
          p_device_id: stableDeviceId,
          p_order_id: item.orderId,
          p_wb_qr: scannedQr,
        })
        if (scanError) throw scanError
        setSession((current) => current ? {
          ...current,
          pending_order_id: String(data.order_id),
          pending_wb_qr: String(data.wb_qr),
          pending_locked_until: String(data.locked_until),
        } : current)
        setNotice(`Заказ №${item.orderId} найден. Теперь сканируйте КИЗ`)
      } else {
        const scannedKiz = cleanScan(value, false)
        if (pairs.some((pair) => pair.sgtin === scannedKiz)) throw new Error('Этот КИЗ уже есть в текущей сессии')
        const { error: scanError } = await (supabase as any).rpc('scan_fbs_kiz', {
          p_session_id: session.id,
          p_device_id: stableDeviceId,
          p_sgtin: scannedKiz,
        })
        if (scanError) throw scanError
        await Promise.all([loadPairs(session.id), loadSession(session.id)])
        setNotice('Пара сохранена. Сканируйте следующий QR WB')
      }
      setValue('')
      signal(true)
    } catch (scanError) {
      setValue('')
      setError(errorText(scanError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const releasePending = async () => {
    if (!supabase || !session || busy) return
    setBusy(true)
    setError('')
    try {
      const { error: releaseError } = await (supabase as any).rpc('release_fbs_marking_pending', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
      })
      if (releaseError) throw releaseError
      await loadSession(session.id)
      setNotice('Ожидающий заказ освобождён')
    } catch (releaseError) {
      setError(errorText(releaseError))
    } finally {
      setBusy(false)
    }
  }

  const removePair = async (pair: ScanPair) => {
    if (!supabase || !session || !['draft', 'error'].includes(pair.status) || !window.confirm(`Удалить пару заказа №${pair.order_id}?`)) return
    setBusy(true)
    try {
      const { error: removeError } = await (supabase as any).rpc('delete_fbs_marking_pair', {
        p_pair_id: pair.id,
        p_device_id: stableDeviceId,
      })
      if (removeError) throw removeError
      await loadPairs(session.id)
    } catch (removeError) {
      setError(errorText(removeError))
    } finally {
      setBusy(false)
    }
  }

  const recoverSession = async (source: ScanSession) => {
    if (!supabase || !session || busy || !window.confirm(`Забрать сохранённые пары с устройства ${source.device_name || source.device_id.slice(0, 6)}?`)) return
    setBusy(true)
    setError('')
    try {
      const { data, error: recoverError } = await (supabase as any).rpc('recover_fbs_marking_session', {
        p_target_session_id: session.id,
        p_source_session_id: source.id,
        p_device_id: stableDeviceId,
      })
      if (recoverError) throw recoverError
      await Promise.all([loadPairs(session.id), loadRecoverableSessions(session.id)])
      setNotice(`Восстановлено пар: ${Number(data ?? 0)}`)
    } catch (recoverError) {
      setError(errorText(recoverError))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!session || busy) return
    if (session.pending_order_id) {
      setError('Сначала отсканируйте КИЗ или сбросьте ожидающий заказ')
      signal(false)
      return
    }
    if (!pairs.some((pair) => pair.status === 'draft' || pair.status === 'error')) {
      setError('Нет новых пар для отправки')
      return
    }
    setBusy(true)
    setError('')
    setNotice('Отправляем КИЗ в Wildberries…')
    try {
      const result = await invokeFbs(storeId, {
        action: 'submit_marking_session', session_id: session.id, device_id: stableDeviceId,
      })
      await Promise.all([loadPairs(session.id), loadSession(session.id)])
      if (Number(result.failed ?? 0) > 0) {
        setError(`Отправлено: ${result.sent}. С ошибкой: ${result.failed}. Исправьте ошибки и повторите.`)
        signal(false)
      } else {
        setNotice(`Готово. В Wildberries отправлено КИЗ: ${result.sent}`)
        signal(true)
      }
    } catch (submitError) {
      setError(errorText(submitError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const draftCount = pairs.filter((pair) => pair.status === 'draft').length
  const sentCount = pairs.filter((pair) => pair.status === 'sent').length
  const errorCount = pairs.filter((pair) => pair.status === 'error').length

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Сканирование КИЗ</h2>
            <p className="mt-1 text-xs text-slate-500">{storeName} · устройство {stableDeviceId.slice(0, 6)}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Подготавливаем QR заказов…</div>
          ) : (
            <>
              <section className={`rounded-3xl border-2 p-6 text-center ${session?.pending_order_id ? 'border-emerald-300 bg-emerald-50' : 'border-violet-300 bg-violet-50'}`}>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {session?.status === 'completed' ? 'Сессия завершена' : session?.pending_order_id ? 'Шаг 2 из 2' : 'Шаг 1 из 2'}
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {session?.status === 'completed'
                    ? 'КИЗ отправлены в Wildberries'
                    : session?.pending_order_id ? 'Сканируйте КИЗ' : 'Сканируйте QR WB'}
                </div>
                {session?.pending_order_id && (
                  <div className="mt-2 text-sm text-slate-600">
                    Заказ № <b>{session.pending_order_id}</b>
                    {pendingOrder && <> · {pendingOrder.productName || 'Товар'}{pendingOrder.productSize ? ` · ${pendingOrder.productSize}` : ''}</>}
                  </div>
                )}
                {session?.status !== 'completed' && (
                  <form className="mx-auto mt-5 flex max-w-2xl gap-2" onSubmit={(event) => { event.preventDefault(); void handleScan() }}>
                    <input
                      ref={inputRef}
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={session?.pending_order_id ? 'КИЗ' : 'QR заказа WB'}
                      className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-4 font-mono text-base outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:opacity-60"
                    />
                    <button type="submit" disabled={busy || value.length === 0} className="rounded-2xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Сохраняем…' : 'Принять'}</button>
                  </form>
                )}
                {session?.pending_order_id && session.status !== 'completed' && (
                  <button type="button" onClick={() => void releasePending()} disabled={busy} className="mt-3 text-xs font-medium text-slate-500 underline hover:text-red-600">Сбросить ожидающий заказ</button>
                )}
              </section>

              {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
              {notice && !error && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
              {catalogMissing > 0 && <div className="mt-3 rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700">WB не вернул QR для {catalogMissing} заказов. Остальные доступны для сканирования.</div>}

              {recoverableSessions.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">Есть прерванная работа на другом устройстве</div>
                  <div className="mt-2 space-y-2">
                    {recoverableSessions.map((source) => (
                      <div key={source.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                        <span>{source.device_name || `Устройство ${source.device_id.slice(0, 6)}`} · нет связи более 2 минут</span>
                        <button type="button" onClick={() => void recoverSession(source)} disabled={busy} className="shrink-0 font-semibold text-violet-700 hover:underline">Забрать работу</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[['Ожидают отправки', draftCount, 'text-violet-700'], ['Отправлено в WB', sentCount, 'text-emerald-700'], ['С ошибкой', errorCount, 'text-red-600']].map(([label, count, color]) => (
                  <div key={String(label)} className="rounded-2xl border border-slate-200 p-4 text-center"><b className={`block text-2xl ${color}`}>{count}</b><span className="text-xs text-slate-500">{label}</span></div>
                ))}
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Отсканированные пары</div>
                {pairs.length === 0 ? <div className="px-4 py-8 text-center text-sm text-slate-400">Пока ничего не отсканировано</div> : (
                  <div className="divide-y divide-slate-100">
                    {pairs.map((pair) => {
                      const order = ordersById.get(pair.order_id)
                      return (
                        <div key={pair.id} className="flex items-center gap-4 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-800">Заказ № {pair.order_id}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-500">{order?.productName || pair.product_snapshot.article || 'Товар'} · КИЗ: <span className="font-mono">{pair.sgtin}</span></div>
                            {pair.error && <div className="mt-1 text-xs font-medium text-red-600">{pair.error}</div>}
                          </div>
                          <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${pair.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : pair.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'}`}>
                            {pair.status === 'sent' ? 'В WB' : pair.status === 'error' ? 'Ошибка' : 'Готово'}
                          </span>
                          {['draft', 'error'].includes(pair.status) && <button type="button" title="Удалить ошибочную пару" onClick={() => void removePair(pair)} disabled={busy} className="text-lg text-slate-300 hover:text-red-500">×</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <span className="text-xs text-slate-500">Каждый QR WB и каждый КИЗ можно использовать только один раз.</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600">Закрыть</button>
            {session?.status !== 'completed' && <button type="button" onClick={() => void finish()} disabled={busy || loading || pairs.length === 0} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Завершить и отправить в WB</button>}
          </div>
        </footer>
      </div>
    </div>
  )
}
