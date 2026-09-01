import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ensureAuthenticatedSession } from '../../lib/authSession'
import { invokeFbs } from '../../services/fbsApi'
import { kizValidationError, normalizeKizCode } from '../../lib/kizCode'
import { showToast } from '../ui/Toast'

type ScanSession = {
  id: string
  status: 'active' | 'submitting' | 'partial' | 'completed' | 'cancelled'
  device_id: string
  pending_order_id: string | null
  pending_wb_qr: string | null
  pending_product_barcode: string | null
  pending_locked_until: string | null
  box_scan_enabled: boolean
  barcode_scan_enabled: boolean
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

type ScanQrDiagnosis = {
  found: boolean
  orderId?: string
  supportsSgtin?: boolean
  orderFound?: boolean
  isLatest?: boolean
  supplierStatus?: string
  wbStatus?: string
}

type ActiveBoxInfo = {
  boxId: string
  barcode: string
  boxNumber: number
  supplyNumber: number
  batchNumber: number
  batchName: string
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
  const withoutTerminator = value.replace(/[\r\n]+$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  return trimSpaces ? withoutTerminator.trim() : withoutTerminator
}

const RU_TO_EN_KEYBOARD: Record<string, string> = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
  'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
  'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.', 'ё': '`',
  'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '{', 'Ъ': '}',
  'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ':', 'Э': '"',
  'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M', 'Б': '<', 'Ю': '>', 'Ё': '~',
}

function scanCandidates(value: string): string[] {
  const cleaned = cleanScan(value, true)
  const withoutScannerPrefix = /^\][A-Za-z]\d/.test(cleaned) ? cleaned.slice(3) : cleaned
  const values = [cleaned, withoutScannerPrefix]
  for (const candidate of [...values]) {
    values.push([...candidate].map((char) => RU_TO_EN_KEYBOARD[char] ?? char).join(''))
  }
  return [...new Set(values.filter(Boolean))]
}

function buildCatalogMap(items: CatalogItem[]): Map<string, CatalogItem> {
  const map = new Map<string, CatalogItem>()
  for (const item of items) {
    const aliases = [item.qrValue, `${item.partA ?? ''}${item.partB ?? ''}`]
    for (const alias of aliases) if (alias) map.set(cleanScan(alias, true), item)
  }
  return map
}

function errorText(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null
      ? String((error as { message?: unknown; details?: unknown; hint?: unknown }).message
        ?? (error as { details?: unknown }).details
        ?? (error as { hint?: unknown }).hint
        ?? JSON.stringify(error))
      : String(error)
  return raw.replace(/^.*?message["']?\s*:\s*["']?/i, '').replace(/["'}]+$/g, '')
}

function scanErrorText(error: unknown, contextualFallback: string): string {
  const message = errorText(error).trim()
  const unreadable = !message
    || /\?{2,}|�|(?:Р.|С.){4,}/u.test(message)
    || (!/[А-Яа-яЁё]/u.test(message) && /[A-Za-z]/.test(message))
  return unreadable ? contextualFallback : message
}

function qrDiagnosisError(diagnosis: ScanQrDiagnosis): string {
  if (!diagnosis.found) return 'Этот код отсутствует в каталоге официальных QR выбранного магазина.'
  const orderId = diagnosis.orderId || 'неизвестен'
  if (!diagnosis.orderFound) return `QR принадлежит заказу №${orderId}, но заказ отсутствует в данных выбранного магазина.`
  if (!diagnosis.isLatest) return `Заказ №${orderId} не входит в актуальную синхронизацию магазина.`
  if (diagnosis.supplierStatus === 'complete') {
    return `Заказ №${orderId} уже передан «В доставку». WB разрешает привязать КИЗ только пока заказ находится «На сборке».`
  }
  if (diagnosis.supplierStatus !== 'confirm' || diagnosis.wbStatus !== 'waiting') {
    return `Заказ №${orderId} недоступен для КИЗ: статус продавца «${diagnosis.supplierStatus || 'не указан'}», статус WB «${diagnosis.wbStatus || 'не указан'}».`
  }
  if (!diagnosis.supportsSgtin) return `Для заказа №${orderId} Wildberries не разрешает метаданные КИЗ.`
  return `QR заказа №${orderId} найден, но отсутствует в актуальном каталоге сканера.`
}

function pairErrorText(error: string, orderId: string): string {
  const message = error.trim()
  if (/FailedToUpdateMeta|Processing status/i.test(message)) {
    return `Заказ №${orderId} уже не находится «На сборке». После передачи «В доставку» WB не разрешает изменять КИЗ.`
  }
  if (/\b429\b|Too Many Requests|rate limit exceeded/i.test(message)) {
    return 'WB временно ограничил частоту запросов (HTTP 429). Повторите отправку после снятия лимита.'
  }
  const httpStatus = message.match(/\bWB\s+(\d{3})\b/i)?.[1]
  if (httpStatus) return `WB отклонил КИЗ заказа №${orderId} (HTTP ${httpStatus}).`
  return message
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
  const [activeBox, setActiveBox] = useState<ActiveBoxInfo | null>(null)
  const [selectingBox, setSelectingBox] = useState(false)
  const [recoverableSessions, setRecoverableSessions] = useState<ScanSession[]>([])
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const altNumpadDigitsRef = useRef('')
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraResultRef = useRef<(value: string) => void>(() => undefined)
  const sessionRef = useRef<ScanSession | null>(null)
  sessionRef.current = session

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const catalogByScan = useMemo(() => buildCatalogMap(catalog), [catalog])
  const knownProductBarcodes = useMemo(() => new Set(catalog.flatMap((item) => {
    const barcode = cleanScan(ordersById.get(item.orderId)?.productBarcode ?? '', true)
    return barcode ? [barcode] : []
  })), [catalog, ordersById])
  const pendingOrder = session?.pending_order_id ? ordersById.get(session.pending_order_id) : null

  useEffect(() => {
    if (error) showToast(error, 'error')
  }, [error])

  useEffect(() => {
    if (notice) showToast(notice, 'success')
  }, [notice])

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

  const loadActiveBox = useCallback(async (sessionId: string) => {
    if (!supabase) return
    const { data, error: loadError } = await (supabase as any).rpc('fbs_marking_box_info', {
      p_session_id: sessionId,
      p_device_id: stableDeviceId,
    })
    if (loadError) throw loadError
    setActiveBox((data as ActiveBoxInfo | null) ?? null)
  }, [stableDeviceId])

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
    const candidates = (data ?? []) as ScanSession[]
    if (candidates.length === 0) {
      setRecoverableSessions([])
      return
    }
    const { data: pairRows, error: pairsError } = await (supabase as any)
      .from('fbs_marking_pairs')
      .select('session_id')
      .in('session_id', candidates.map((candidate) => candidate.id))
      .in('status', ['draft', 'error'])
    const sessionsWithWork = new Set<string>((pairRows ?? []).map((row: { session_id: string }) => row.session_id))
    setRecoverableSessions(candidates.filter((candidate) => Boolean(candidate.pending_order_id || candidate.pending_product_barcode) || (!pairsError && sessionsWithWork.has(candidate.id))))
  }, [storeId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!supabase) throw new Error('Supabase не настроен')
      setLoading(true)
      try {
        await ensureAuthenticatedSession()
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
        const preferenceResult = await (supabase as any).rpc('apply_fbs_marking_preferences', {
          p_session_id: (sessionResult.data as ScanSession).id,
          p_device_id: stableDeviceId,
        })
        if (preferenceResult.error) throw preferenceResult.error
        const nextSession = preferenceResult.data as ScanSession
        setSession(nextSession)
        setCatalog((catalogResult.catalog ?? []) as CatalogItem[])
        setCatalogMissing(Number(catalogResult.missing ?? 0))
        await Promise.all([loadPairs(nextSession.id), loadRecoverableSessions(nextSession.id), loadActiveBox(nextSession.id)])
      } catch (loadError) {
        if (!cancelled) setError(`Не удалось открыть сканирование: ${errorText(loadError)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, loadActiveBox, loadPairs, loadRecoverableSessions, stableDeviceId, storeId])

  useEffect(() => {
    if (!supabase || !session?.id) return
    const client = supabase
    const channel = client
      .channel(`fbs-marking-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fbs_marking_pairs', filter: `session_id=eq.${session.id}` }, () => {
        void loadPairs(session.id)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fbs_marking_sessions', filter: `id=eq.${session.id}` }, () => {
        void Promise.all([loadSession(session.id), loadActiveBox(session.id)])
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [loadActiveBox, loadPairs, loadSession, session?.id])

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
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
    if (!coarsePointer && !cameraOpen && !busy && !loading && session?.status !== 'completed') inputRef.current?.focus()
  }, [busy, cameraOpen, loading, session?.pending_order_id, session?.pending_product_barcode, session?.status])

  const setBarcodeMode = async (enabled: boolean) => {
    if (!supabase || !session || busy) return
    setBusy(true)
    setError('')
    try {
      const { data, error: modeError } = await (supabase as any).rpc('set_fbs_marking_barcode_mode', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
        p_enabled: enabled,
      })
      if (modeError) throw modeError
      setSession(data as ScanSession)
      setNotice(enabled ? 'Контрольный скан баркода включён' : 'Контрольный скан баркода отключён')
    } catch (modeError) {
      setError(errorText(modeError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const setBoxMode = async (enabled: boolean) => {
    if (!supabase || !session || busy) return
    setBusy(true)
    setError('')
    try {
      const { data, error: modeError } = await (supabase as any).rpc('set_fbs_marking_box_mode', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
        p_enabled: enabled,
      })
      if (modeError) throw modeError
      setSession(data as ScanSession)
      if (!enabled) {
        setActiveBox(null)
        setSelectingBox(false)
      }
      setNotice(enabled ? 'Скан короба включён' : 'Скан короба отключён')
    } catch (modeError) {
      setError(errorText(modeError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const handleScan = async (rawValue?: string) => {
    if (!supabase || !session || busy || session.status === 'completed') return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const candidates = scanCandidates(rawValue ?? value)
      const isKnownOrderQr = candidates.some((candidate) => catalogByScan.has(candidate))
      const isActiveBoxQr = Boolean(activeBox && candidates.includes(cleanScan(activeBox.barcode, true)))
      const isKnownProductBarcode = candidates.some((candidate) => knownProductBarcodes.has(candidate))
      const boxScanMode = Boolean((session.box_scan_enabled ?? true) && (!activeBox || selectingBox))
      if (boxScanMode) {
        if (isKnownOrderQr) throw new Error('Вы отсканировали QR заказа WB. Сейчас нужен QR короба.')
        if (isKnownProductBarcode) throw new Error('Вы отсканировали баркод товара. Сейчас нужен QR короба.')
        let selectedBox: ActiveBoxInfo | null = null
        let lastBoxError: unknown = null
        for (const candidate of candidates) {
          const result = await (supabase as any).rpc('set_fbs_marking_active_box', {
            p_session_id: session.id,
            p_device_id: stableDeviceId,
            p_box_barcode: candidate,
          })
          if (!result.error && result.data) {
            selectedBox = result.data as ActiveBoxInfo
            break
          }
          lastBoxError = result.error
        }
        if (!selectedBox) throw new Error(scanErrorText(
          lastBoxError,
          'QR короба не найден. Сейчас нужен QR действующего короба ELESTET. Проверьте код или выберите другой короб.',
        ))
        setActiveBox(selectedBox)
        setSelectingBox(false)
        setValue('')
        setNotice(`Активен короб №${selectedBox.boxNumber}. Теперь сканируйте ${session.barcode_scan_enabled ? 'баркод товара' : 'QR WB'}`)
        signal(true)
        return
      }
      if (session.barcode_scan_enabled && !session.pending_product_barcode && !session.pending_order_id) {
        if (isKnownOrderQr) throw new Error('Вы отсканировали QR заказа WB. Сейчас нужен баркод товара.')
        if (isActiveBoxQr) throw new Error('Вы повторно отсканировали QR короба. Сейчас нужен баркод товара.')
        let barcodeResult: { barcode: string; available: number | null } | null = null
        let lastBarcodeError: unknown = null
        for (const candidate of candidates) {
          const result = await (supabase as any).rpc('scan_fbs_product_barcode', {
            p_session_id: session.id,
            p_device_id: stableDeviceId,
            p_barcode: candidate,
          })
          if (!result.error && result.data) {
            barcodeResult = result.data as { barcode: string; available: number | null }
            break
          }
          lastBarcodeError = result.error
        }
        if (!barcodeResult) throw new Error(scanErrorText(
          lastBarcodeError,
          'Баркод товара не найден в активном коробе. Сейчас нужен баркод товара из выбранного короба.',
        ))
        setSession((current) => current ? {
          ...current,
          pending_product_barcode: barcodeResult!.barcode,
          pending_locked_until: new Date(Date.now() + 120_000).toISOString(),
        } : current)
        setValue('')
        setNotice(barcodeResult.available == null
          ? 'Баркод принят. Теперь сканируйте QR WB'
          : `Баркод найден в коробе · доступно ${barcodeResult.available}. Теперь сканируйте QR WB`)
        signal(true)
        return
      }
      if (!session.pending_order_id) {
        if (!isKnownOrderQr && isActiveBoxQr) throw new Error('Вы повторно отсканировали QR короба. Сейчас нужен QR заказа WB.')
        if (!isKnownOrderQr && isKnownProductBarcode) throw new Error('Вы отсканировали баркод товара. Сейчас нужен QR заказа WB.')
        let item = candidates.map((candidate) => catalogByScan.get(candidate)).find(Boolean)
        if (!item) {
          const refreshed = await invokeFbs(storeId, { action: 'get_scan_catalog' })
          const refreshedCatalog = (refreshed.catalog ?? []) as CatalogItem[]
          setCatalog(refreshedCatalog)
          setCatalogMissing(Number(refreshed.missing ?? 0))
          const refreshedMap = buildCatalogMap(refreshedCatalog)
          item = candidates.map((candidate) => refreshedMap.get(candidate)).find(Boolean)
        }
        if (!item) {
          const diagnosis = await invokeFbs(storeId, { action: 'diagnose_scan_qr', scan_values: candidates }) as ScanQrDiagnosis
          throw new Error(qrDiagnosisError(diagnosis))
        }
        const { data, error: scanError } = await (supabase as any).rpc('scan_fbs_wb_qr', {
          p_session_id: session.id,
          p_device_id: stableDeviceId,
          p_order_id: item.orderId,
          p_wb_qr: item.qrValue,
        })
        if (scanError) throw new Error(scanErrorText(
          scanError,
          'QR заказа WB не принят серверной проверкой.',
        ))
        setSession((current) => current ? {
          ...current,
          pending_order_id: String(data.order_id),
          pending_wb_qr: String(data.wb_qr),
          pending_locked_until: String(data.locked_until),
        } : current)
        setNotice(`Заказ №${item.orderId} найден. Теперь сканируйте КИЗ`)
      } else {
        const scannedKiz = normalizeKizCode(rawValue ?? value)
        if (isKnownOrderQr || scannedKiz === session.pending_wb_qr) {
          throw new Error('Вы повторно отсканировали QR заказа WB. Сейчас нужен КИЗ товара.')
        }
        if (isActiveBoxQr) throw new Error('Вы отсканировали QR короба. Сейчас нужен КИЗ товара.')
        if (isKnownProductBarcode || scannedKiz === session.pending_product_barcode) {
          throw new Error('Вы отсканировали баркод товара. Сейчас нужен КИЗ товара.')
        }
        const validationError = kizValidationError(scannedKiz)
        if (validationError) throw new Error(validationError)
        if (pairs.some((pair) => pair.sgtin === scannedKiz)) throw new Error('Этот КИЗ уже есть в текущей сессии')
        const { error: scanError } = await (supabase as any).rpc('scan_fbs_kiz', {
          p_session_id: session.id,
          p_device_id: stableDeviceId,
          p_sgtin: scannedKiz,
        })
        if (scanError) throw new Error(scanErrorText(
          scanError,
          'КИЗ не принят. Сейчас нужен КИЗ товара для выбранного заказа WB. Проверьте код и повторите сканирование.',
        ))
        await Promise.all([loadPairs(session.id), loadSession(session.id)])
        setNotice(`Пара сохранена. Сканируйте следующий ${session.barcode_scan_enabled ? 'баркод товара' : 'QR WB'}`)
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

  cameraResultRef.current = (scannedValue: string) => { void handleScan(scannedValue) }

  useEffect(() => {
    if (!cameraOpen) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      return
    }

    let cancelled = false
    let handled = false
    let controls: { stop(): void } | null = null
    setCameraError('')
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера не поддерживается браузером')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        cameraStreamRef.current = stream
        if (!cameraVideoRef.current) return
        cameraVideoRef.current.srcObject = stream
        await cameraVideoRef.current.play()
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled || !cameraVideoRef.current) return
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromStream(stream, cameraVideoRef.current, (result) => {
          if (!result || handled || cancelled) return
          handled = true
          const scannedValue = (result as unknown as { getText(): string }).getText()
          setCameraOpen(false)
          cameraResultRef.current(scannedValue)
        })
      } catch {
        if (!cancelled) setCameraError('Не удалось открыть камеру. Разрешите доступ к камере в браузере или используйте сканер.')
      }
    })()

    return () => {
      cancelled = true
      controls?.stop()
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
  }, [cameraOpen])

  // Аппаратный сканер работает как клавиатура. Даже если сотрудник случайно
  // кликнул по заголовку, списку или кнопке, первый символ следующего скана
  // возвращает ввод в единственное рабочее поле этой модалки.
  useEffect(() => {
    if (cameraOpen || busy || loading || session?.status === 'completed') return

    const focusInput = () => inputRef.current?.focus({ preventScroll: true })
    const appendScannerValue = (chunk: string) => {
      focusInput()
      setValue((current) => current + chunk)
    }
    const handleWindowFocus = () => window.requestAnimationFrame(focusInput)
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current
      if (!input || input.disabled || event.isComposing) return

      // WB-compatible GS1 scanner modes. WB accepts the group separator as
      // either F8 or Alt+0029 and converts it to ASCII 29.
      if (event.key === 'F8') {
        event.preventDefault()
        event.stopPropagation()
        appendScannerValue('\u001d')
        return
      }
      if (event.altKey && /^Numpad\d$/.test(event.code)) {
        event.preventDefault()
        event.stopPropagation()
        altNumpadDigitsRef.current += event.code.slice(-1)
        return
      }

      if (document.activeElement === input) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key.length === 1) {
        event.preventDefault()
        appendScannerValue(event.key)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        focusInput()
      }
    }
    const handleDocumentKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || altNumpadDigitsRef.current.length === 0) return
      const digits = altNumpadDigitsRef.current
      altNumpadDigitsRef.current = ''
      if (digits.replace(/^0+/, '') === '29') {
        event.preventDefault()
        event.stopPropagation()
        appendScannerValue('\u001d')
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    document.addEventListener('keyup', handleDocumentKeyUp, true)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
      document.removeEventListener('keyup', handleDocumentKeyUp, true)
      altNumpadDigitsRef.current = ''
    }
  }, [busy, cameraOpen, loading, session?.status])

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
    if (session.pending_order_id || session.pending_product_barcode) {
      setError('Сначала завершите текущую пару или сбросьте её')
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
        const messages = [...new Set(((result.failures ?? []) as Array<{ error?: string }>).map((failure) => String(failure.error ?? '').trim()).filter(Boolean))]
        setError(messages.length === 1
          ? `${messages[0]} Ошибок: ${result.failed}.`
          : `Отправлено: ${result.sent}. С ошибкой: ${result.failed}. Причины указаны у заказов.`)
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
  const boxEnabled = session?.box_scan_enabled ?? true
  const boxScanMode = Boolean(boxEnabled && (!activeBox || selectingBox))
  const barcodeStep = Boolean(session?.barcode_scan_enabled && !session.pending_product_barcode && !session.pending_order_id && !boxScanMode)
  const totalSteps = 2 + (boxEnabled ? 1 : 0) + (session?.barcode_scan_enabled ? 1 : 0)
  const currentStep = boxScanMode
    ? 1
    : session?.pending_order_id
      ? totalSteps
      : barcodeStep
        ? (boxEnabled ? 2 : 1)
        : totalSteps - 1
  const scanTarget = boxScanMode ? 'QR короба' : barcodeStep ? 'баркод товара' : session?.pending_order_id ? 'КИЗ' : 'QR WB'
  const openCamera = () => {
    inputRef.current?.blur()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setCameraOpen(true)
  }
  const scanSteps = [
    ...(boxEnabled ? [{ key: 'box', label: 'Короб' }] : []),
    ...(session?.barcode_scan_enabled ? [{ key: 'barcode', label: 'Баркод товара' }] : []),
    { key: 'wb', label: 'QR заказа WB' },
    { key: 'kiz', label: 'КИЗ' },
  ]
  const allScanSteps = [
    { key: 'box', label: 'Короб', visible: boxEnabled },
    { key: 'barcode', label: 'Баркод товара', visible: Boolean(session?.barcode_scan_enabled) },
    { key: 'wb', label: 'QR заказа WB', visible: true },
    { key: 'kiz', label: 'КИЗ', visible: true },
  ]

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] bg-white" onClick={onClose}>
      <div
        className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-white"
        onClick={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => {
          if (cameraOpen || (window.matchMedia?.('(pointer: coarse)').matches ?? false)) return
          const target = event.target as HTMLElement
          if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
          window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
        }}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Сканирование КИЗ</h2>
            <p className="mt-1 text-xs text-slate-500">{storeName} · устройство {stableDeviceId.slice(0, 6)}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Подготавливаем QR заказов…</div>
          ) : (
            <>
              <section className={`rounded-2xl border-2 p-3 text-center sm:rounded-3xl sm:p-6 ${session?.pending_order_id ? 'border-emerald-300 bg-emerald-50' : 'border-violet-300 bg-violet-50'}`}>
                <div className="mx-auto mb-3 max-w-xl sm:mb-4 sm:px-2">
                  <div className="fbs-scan-steps flex items-start">
                    {allScanSteps.map((step) => {
                      const visibleIndex = scanSteps.findIndex((visibleStep) => visibleStep.key === step.key)
                      const completed = step.visible && (session?.status === 'completed' || visibleIndex + 1 < currentStep)
                      const current = step.visible && session?.status !== 'completed' && visibleIndex + 1 === currentStep
                      return (
                        <div
                          key={step.key}
                          className={`fbs-scan-step relative flex min-w-0 flex-col items-center ${step.visible ? 'fbs-scan-step-visible' : 'fbs-scan-step-hidden'}`}
                          aria-hidden={!step.visible}
                        >
                          {step.visible && visibleIndex < scanSteps.length - 1 && (
                            <div className={`absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-[15px] h-[3px] rounded-full transition-colors ${
                              completed ? 'bg-emerald-400' : 'bg-blue-200'
                            }`} />
                          )}
                          <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all ${
                            completed
                              ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-200'
                              : current
                                ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-200 ring-[3px] ring-blue-100'
                                : 'border-blue-300 bg-blue-50 text-blue-500'
                          }`}>
                            {completed ? (
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : current ? (
                              <span className="h-2 w-2 rounded-full bg-white" />
                            ) : visibleIndex + 1}
                          </div>
                          <span className={`mt-1.5 max-w-[78px] text-[10px] font-semibold leading-tight sm:max-w-[110px] sm:text-[11px] ${
                            completed ? 'text-emerald-600' : current ? 'text-blue-700' : 'text-blue-500'
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {session?.status !== 'completed' && (
                  <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2 sm:gap-3">
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-left sm:rounded-2xl sm:px-4 sm:py-3">
                      <span className="text-xs font-semibold text-slate-800 sm:text-sm">Короб</span>
                      <input
                        type="checkbox"
                        checked={boxEnabled}
                        disabled={busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)}
                        onChange={(event) => void setBoxMode(event.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-violet-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-left sm:rounded-2xl sm:px-4 sm:py-3">
                      <span className="text-xs font-semibold text-slate-800 sm:text-sm">Баркод</span>
                      <input
                        type="checkbox"
                        checked={Boolean(session?.barcode_scan_enabled)}
                        disabled={busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)}
                        onChange={(event) => void setBarcodeMode(event.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-violet-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
                    </label>
                  </div>
                )}
                {boxEnabled && activeBox && !boxScanMode && session?.status !== 'completed' && (
                  <div className="mx-auto mt-3 flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-left">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Активный короб</div>
                      <div className="mt-0.5 truncate text-sm font-bold text-slate-900">P-{activeBox.batchNumber} · S-{activeBox.supplyNumber} · Короб {activeBox.boxNumber}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{activeBox.barcode}</div>
                    </div>
                    <button type="button" disabled={busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)} onClick={() => { setSelectingBox(true); setValue(''); window.requestAnimationFrame(() => inputRef.current?.focus()) }} className="shrink-0 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40">Сменить</button>
                  </div>
                )}
                {session?.pending_product_barcode && !session.pending_order_id && (
                  <div className="mt-2 text-sm text-slate-600">Баркод товара: <b className="font-mono">{session.pending_product_barcode}</b></div>
                )}
                {session?.pending_order_id && (
                  <div className="mt-2 text-sm text-slate-600">
                    Заказ № <b>{session.pending_order_id}</b>
                    {pendingOrder && <> · {pendingOrder.productName || 'Товар'}{pendingOrder.productSize ? ` · ${pendingOrder.productSize}` : ''}</>}
                  </div>
                )}
                {session?.status !== 'completed' && (
                  <form className="mx-auto mt-3 grid max-w-2xl grid-cols-[minmax(0,1fr)_48px] gap-2 sm:mt-5 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); void handleScan() }}>
                    <input
                      ref={inputRef}
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={boxScanMode ? 'QR короба' : barcodeStep ? 'Баркод товара' : session?.pending_order_id ? 'КИЗ' : 'QR заказа WB'}
                      className="h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:opacity-60 sm:h-auto sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={openCamera}
                      className="flex h-12 w-12 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-3"
                      title="Сканировать камерой телефона"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"/><circle cx="12" cy="13" r="3"/></svg>
                      <span className="hidden sm:inline">Камера</span>
                    </button>
                    <button type="submit" disabled={busy || value.length === 0} className="col-span-2 h-12 rounded-xl bg-violet-600 px-6 text-sm font-semibold text-white disabled:opacity-40 sm:col-span-1 sm:h-auto sm:rounded-2xl sm:py-3">{busy ? 'Сохраняем…' : 'Принять'}</button>
                  </form>
                )}
                {(session?.pending_order_id || session?.pending_product_barcode) && session.status !== 'completed' && (
                  <button type="button" onClick={() => void releasePending()} disabled={busy} className="mt-3 text-xs font-medium text-slate-500 underline hover:text-red-600">Сбросить текущую пару</button>
                )}
              </section>

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

              <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-3">
                {[['Ожидают', draftCount, 'text-violet-700'], ['Отправлено', sentCount, 'text-emerald-700'], ['Ошибки', errorCount, 'text-red-600']].map(([label, count, color]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 px-2 py-3 text-center sm:rounded-2xl sm:p-4"><b className={`block text-xl sm:text-2xl ${color}`}>{count}</b><span className="mt-0.5 block text-[10px] leading-tight text-slate-500 sm:text-xs">{label}</span></div>
                ))}
              </div>

              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 sm:mt-5">
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
                            {pair.error && <div className="mt-1 text-xs font-medium text-red-600">{pairErrorText(pair.error, pair.order_id)}</div>}
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

        <footer className="grid shrink-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-2 border-t border-slate-100 px-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:justify-between sm:px-6 sm:py-4">
          <span className="hidden text-xs text-slate-500 sm:block">QR WB и КИЗ уникальны. Товарный баркод можно повторять в следующей паре.</span>
          <div className="contents sm:flex sm:gap-2">
            <button type="button" onClick={onClose} className={`h-12 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 sm:h-auto sm:px-4 sm:py-2.5 ${session?.status === 'completed' ? 'col-span-2' : ''}`}>Закрыть</button>
            {session?.status !== 'completed' && <button type="button" onClick={() => void finish()} disabled={busy || loading || pairs.length === 0} className="h-12 whitespace-nowrap rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-40 sm:h-auto sm:px-5 sm:py-2.5"><span className="sm:hidden">Отправить в WB</span><span className="hidden sm:inline">Завершить и отправить в WB</span></button>}
          </div>
        </footer>

        {cameraOpen && session?.status !== 'completed' && (
          <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label={`Сканирование камерой: ${scanTarget}`}>
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Наведите камеру на {scanTarget}</div>
                <div className="mt-0.5 text-[11px] text-white/60">Код распознается автоматически</div>
              </div>
              <button type="button" onClick={() => setCameraOpen(false)} className="flex h-10 shrink-0 items-center rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">Закрыть</button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
              <video ref={cameraVideoRef} autoPlay muted playsInline className="h-full w-full bg-black object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                <div className="aspect-square w-full max-w-[300px] rounded-3xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
              </div>
              {cameraError && <div className="absolute inset-x-4 bottom-6 rounded-2xl bg-red-500/90 px-4 py-3 text-center text-xs font-medium text-white">{cameraError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
