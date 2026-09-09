import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { QRCodeCanvas } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { ensureAuthenticatedSession } from '../../lib/authSession'
import { invokeFbs } from '../../services/fbsApi'
import { fetchActiveScannerModels, readCachedActiveScannerModels } from '../../services/scannerModelService'
import type { ScannerModelProfile } from '../../services/scannerModelService'
import { kizValidationError, normalizeKizCode, normalizeScannerKeyboardLayout } from '../../lib/kizCode'
import { showToast } from '../ui/Toast'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

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
  device_named: boolean
  device_identity_required: boolean
  active_scanner_model: string | null
  scanner_test_status: ScannerTestStatus
  scanner_tested_at?: string | null
}

type ScanPair = {
  id: string
  order_id: string
  wb_qr: string
  sgtin: string
  status: 'draft' | 'sending' | 'sent' | 'error'
  product_snapshot: {
    nm_id?: number
    chrt_id?: number
    article?: string
    barcode?: string
    supply_id?: string
    source_box_id?: string
  }
  error: string | null
  created_at: string
}

type RecoverableScanSession = ScanSession & {
  recoverable_pair_count: number
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
  nmId?: number
  article?: string
  photoUrl?: string | null
  productBrand?: string | null
  productColor?: string | null
  productVendorCode?: string | null
}

type Props = {
  accountId: string
  storeId: string
  storeName: string
  orders: OrderView[]
  onClose: () => void
  onKizStatesUpdated?: () => void | Promise<void>
}

const DEVICE_KEY = 'elestet_fbs_scanner_device_v1'
const DEVICE_PROFILE_KEY = 'elestet_fbs_scanner_profile_v1'
const GS = '\u001d'
type ScannerTestStatus = 'untested' | 'passed' | 'failed'
type SerialConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unsupported' | 'error'
type SerialPacketTerminator = 'cr_lf' | 'cr' | 'lf' | 'tab' | 'etx'

type BrowserSerialReader = ReadableStreamDefaultReader<Uint8Array>

type BrowserSerialPort = {
  readable: ReadableStream<Uint8Array> | null
  open(options: {
    baudRate: number
    dataBits?: 7 | 8
    stopBits?: 1 | 2
    parity?: 'none' | 'even' | 'odd'
    flowControl?: 'none' | 'hardware'
  }): Promise<void>
  close(): Promise<void>
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
}

type BrowserSerialApi = {
  requestPort(): Promise<BrowserSerialPort>
  getPorts?(): Promise<BrowserSerialPort[]>
}

type DeviceProfile = {
  deviceName: string
  scannerModel: string | null
  scannerTestStatus: ScannerTestStatus
}

const EMPTY_DEVICE_PROFILE: DeviceProfile = {
  deviceName: '',
  scannerModel: null,
  scannerTestStatus: 'untested',
}

function readDeviceProfile(): DeviceProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_PROFILE_KEY) ?? '{}') as Partial<DeviceProfile>
    return {
      deviceName: typeof saved.deviceName === 'string' ? saved.deviceName.trim().slice(0, 80) : '',
      scannerModel: typeof saved.scannerModel === 'string' && saved.scannerModel.trim().length <= 200
        ? saved.scannerModel.trim()
        : null,
      scannerTestStatus: saved.scannerTestStatus === 'passed' || saved.scannerTestStatus === 'failed'
        ? saved.scannerTestStatus
        : 'untested',
    }
  } catch {
    return EMPTY_DEVICE_PROFILE
  }
}

function writeDeviceProfile(profile: DeviceProfile) {
  localStorage.setItem(DEVICE_PROFILE_KEY, JSON.stringify(profile))
}

function scannerSearchKey(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, '')
}

function browserSerialApi(): BrowserSerialApi | null {
  return ((navigator as Navigator & { serial?: BrowserSerialApi }).serial ?? null)
}

function supportsUsbScannerSelection(): boolean {
  const userAgent = navigator.userAgent || ''
  const ipadInDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1
  return !ipadInDesktopMode && !/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(userAgent)
}

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

function scannerBytesToString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

function serialPacketTerminator(value: unknown): SerialPacketTerminator {
  return value === 'cr' || value === 'lf' || value === 'tab' || value === 'etx' ? value : 'cr_lf'
}

function endsSerialPacket(character: string, terminator: SerialPacketTerminator) {
  if (terminator === 'tab') return character === '\t'
  if (terminator === 'etx') return character === '\u0003'
  if (terminator === 'cr') return character === '\r'
  if (terminator === 'lf') return character === '\n'
  return character === '\r' || character === '\n'
}

function ScannerSetupBarcode({ value, label, format }: { value: string; label: string; format: 'CODE128' | 'QR' }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renderError, setRenderError] = useState(false)

  useEffect(() => {
    if (format === 'QR') {
      setRenderError(false)
      return
    }
    if (!canvasRef.current) return
    try {
      JsBarcode(canvasRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 54,
        displayValue: true,
        font: 'Arial',
        fontSize: 13,
        margin: 8,
      })
      setRenderError(false)
    } catch {
      setRenderError(true)
    }
  }, [format, value])

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 text-center">
      <figcaption className="mb-1 text-[11px] font-semibold text-slate-600">{label}</figcaption>
      <div className="overflow-x-auto">
        {format === 'QR'
          ? <QRCodeCanvas value={value} size={180} marginSize={2} className="mx-auto block" />
          : renderError
            ? <div className="px-3 py-4 text-xs text-rose-600">Не удалось построить штрихкод. Проверьте значение в админке.</div>
            : <canvas ref={canvasRef} className="mx-auto block max-w-none" />}
      </div>
    </figure>
  )
}

function scanTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function scanCandidates(value: string): string[] {
  const cleaned = cleanScan(value, true)
  const withoutScannerPrefix = /^\][A-Za-z]\d/.test(cleaned) ? cleaned.slice(3) : cleaned
  const values = [cleaned, withoutScannerPrefix]
  for (const candidate of [...values]) {
    values.push(normalizeScannerKeyboardLayout(candidate))
  }
  return [...new Set(values.filter(Boolean))]
}

const US_PRINTABLE_BY_CODE: Record<string, readonly [string, string]> = {
  Backquote: ['`', '~'], Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'],
  Digit4: ['4', '$'], Digit5: ['5', '%'], Digit6: ['6', '^'], Digit7: ['7', '&'],
  Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'], Minus: ['-', '_'], Equal: ['=', '+'],
  BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
  Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
  Numpad0: ['0', '0'], Numpad1: ['1', '1'], Numpad2: ['2', '2'], Numpad3: ['3', '3'],
  Numpad4: ['4', '4'], Numpad5: ['5', '5'], Numpad6: ['6', '6'], Numpad7: ['7', '7'],
  Numpad8: ['8', '8'], Numpad9: ['9', '9'], NumpadDecimal: ['.', '.'], NumpadDivide: ['/', '/'],
  NumpadMultiply: ['*', '*'], NumpadSubtract: ['-', '-'], NumpadAdd: ['+', '+'],
}

function usAsciiFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) {
    const letter = event.code.slice(3).toLowerCase()
    return event.shiftKey ? letter.toUpperCase() : letter
  }
  const pair = US_PRINTABLE_BY_CODE[event.code]
  return pair ? pair[event.shiftKey ? 1 : 0] : null
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

export function FbsKizScannerModal({ accountId, storeId, storeName, orders, onClose, onKizStatesUpdated }: Props) {
  const stableDeviceId = useMemo(deviceId, [])
  const scannerSelectionVisible = useMemo(supportsUsbScannerSelection, [])
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>(readDeviceProfile)
  const [scannerModels, setScannerModels] = useState<ScannerModelProfile[]>(readCachedActiveScannerModels)
  const [scannerCatalogLoading, setScannerCatalogLoading] = useState(false)
  const [scannerCatalogError, setScannerCatalogError] = useState('')
  const [session, setSession] = useState<ScanSession | null>(null)
  const [pairs, setPairs] = useState<ScanPair[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogMissing, setCatalogMissing] = useState(0)
  const [activeBox, setActiveBox] = useState<ActiveBoxInfo | null>(null)
  const [selectingBox, setSelectingBox] = useState(false)
  const [recoverableSessions, setRecoverableSessions] = useState<RecoverableScanSession[]>([])
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedPair, setSelectedPair] = useState<ScanPair | null>(null)
  const [selectedPairBox, setSelectedPairBox] = useState<ActiveBoxInfo | null>(null)
  const [selectedPairBoxLoading, setSelectedPairBoxLoading] = useState(false)
  const [selectedPairBoxError, setSelectedPairBoxError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraLoading, setCameraLoading] = useState(false)
  const [deviceNameDialogOpen, setDeviceNameDialogOpen] = useState(false)
  const [deviceNameInput, setDeviceNameInput] = useState('')
  const [scannerDialogOpen, setScannerDialogOpen] = useState(false)
  const [scannerSearch, setScannerSearch] = useState('')
  const [serialStatus, setSerialStatus] = useState<SerialConnectionStatus>(() => browserSerialApi() ? 'disconnected' : 'unsupported')
  const [serialError, setSerialError] = useState('')
  const [serialPortLabel, setSerialPortLabel] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const deviceNameInputRef = useRef<HTMLInputElement | null>(null)
  const altNumpadDigitsRef = useRef('')
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraResultRef = useRef<(value: string) => void>(() => undefined)
  const serialPortRef = useRef<BrowserSerialPort | null>(null)
  const serialReaderRef = useRef<BrowserSerialReader | null>(null)
  const serialReadActiveRef = useRef(false)
  const serialConnectedProfileKeyRef = useRef('')
  const serialScanHandlerRef = useRef<(value: string) => Promise<void>>(async () => undefined)
  const sessionRef = useRef<ScanSession | null>(null)
  const pairDetailsRequestRef = useRef(0)
  sessionRef.current = session

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const catalogByScan = useMemo(() => buildCatalogMap(catalog), [catalog])
  const knownProductBarcodes = useMemo(() => new Set(catalog.flatMap((item) => {
    const barcode = cleanScan(ordersById.get(item.orderId)?.productBarcode ?? '', true)
    return barcode ? [barcode] : []
  })), [catalog, ordersById])
  const filteredScannerModels = useMemo(() => {
    const query = scannerSearchKey(scannerSearch)
    if (!query) return scannerModels
    return scannerModels.filter((model) => scannerSearchKey(`${model.brand} ${model.model} ${model.displayName}`).includes(query))
  }, [scannerModels, scannerSearch])
  const pendingOrder = session?.pending_order_id ? ordersById.get(session.pending_order_id) : null
  const deviceReady = Boolean(session?.device_identity_required && session.device_named)
  const selectedScannerProfile = scannerModels.find((model) => model.displayName === deviceProfile.scannerModel) ?? null
  const serialScannerSelected = selectedScannerProfile?.connectionType === 'web_serial'
  const selectedSerialProfileKey = serialScannerSelected && selectedScannerProfile
    ? `${selectedScannerProfile.id}:${selectedScannerProfile.profileVersion}`
    : ''
  const selectedScannerHasDetails = Boolean(selectedScannerProfile && (
    selectedScannerProfile.connectionType === 'web_serial'
    || selectedScannerProfile.setupBarcodes.length > 0
    || selectedScannerProfile.restoreBarcodes.length > 0
    || selectedScannerProfile.instructions
    || selectedScannerProfile.warningText
  ))
  const childDialogOpen = deviceNameDialogOpen || scannerDialogOpen || Boolean(selectedPair)

  useEffect(() => {
    if (error) showToast(error, 'error')
  }, [error])

  useEffect(() => {
    if (notice) showToast(notice, 'success')
  }, [notice])

  useEffect(() => {
    if (!scannerSelectionVisible) return
    let cancelled = false
    setScannerCatalogLoading(true)
    setScannerCatalogError('')
    void fetchActiveScannerModels()
      .then((models) => {
        if (!cancelled) setScannerModels(models)
      })
      .catch((loadError) => {
        if (!cancelled) setScannerCatalogError(errorText(loadError))
      })
      .finally(() => {
        if (!cancelled) setScannerCatalogLoading(false)
      })
    return () => { cancelled = true }
  }, [scannerSelectionVisible])

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
    const pairCounts = new Map<string, number>()
    for (const row of (pairRows ?? []) as Array<{ session_id: string }>) {
      pairCounts.set(row.session_id, (pairCounts.get(row.session_id) ?? 0) + 1)
    }
    setRecoverableSessions(candidates.flatMap((candidate) => {
      const pairCount = pairCounts.get(candidate.id) ?? 0
      const hasPendingScan = Boolean(candidate.pending_order_id || candidate.pending_product_barcode)
      return hasPendingScan || (!pairsError && pairCount > 0)
        ? [{ ...candidate, recoverable_pair_count: pairCount }]
        : []
    }))
  }, [storeId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!supabase) throw new Error('Supabase не настроен')
      setLoading(true)
      try {
        await ensureAuthenticatedSession()
        const localProfile = readDeviceProfile()
        setDeviceProfile(localProfile)
        const [sessionResult, catalogResult] = await Promise.all([
          (supabase as any).rpc('start_fbs_marking_session', {
            p_account_id: accountId,
            p_store_id: storeId,
            p_device_id: stableDeviceId,
            p_device_name: localProfile.deviceName || `Браузер ${stableDeviceId.slice(0, 6)}`,
          }),
          invokeFbs(storeId, { action: 'get_scan_catalog' }),
        ])
        if (sessionResult.error) throw sessionResult.error
        if (cancelled) return
        const startedSession = sessionResult.data as ScanSession
        const configuredResult = await (supabase as any).rpc('configure_fbs_marking_device', {
          p_session_id: startedSession.id,
          p_device_id: stableDeviceId,
          p_device_name: localProfile.deviceName,
          p_device_named: Boolean(localProfile.deviceName),
          p_scanner_model: scannerSelectionVisible ? localProfile.scannerModel : null,
          p_scanner_test_status: scannerSelectionVisible ? localProfile.scannerTestStatus : 'untested',
        })
        if (configuredResult.error) throw configuredResult.error
        let nextSession = configuredResult.data as ScanSession
        if (nextSession.device_named) {
          const preferenceResult = await (supabase as any).rpc('apply_fbs_marking_preferences', {
            p_session_id: nextSession.id,
            p_device_id: stableDeviceId,
          })
          if (preferenceResult.error) throw preferenceResult.error
          nextSession = preferenceResult.data as ScanSession
        }
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
  }, [accountId, loadActiveBox, loadPairs, loadRecoverableSessions, scannerSelectionVisible, stableDeviceId, storeId])

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
    if (deviceReady && !coarsePointer && !cameraOpen && !childDialogOpen && !busy && !loading && session?.status !== 'completed') inputRef.current?.focus()
  }, [busy, cameraOpen, childDialogOpen, deviceReady, loading, session?.pending_order_id, session?.pending_product_barcode, session?.status])

  useEffect(() => {
    if (!deviceNameDialogOpen) return
    const frame = window.requestAnimationFrame(() => {
      deviceNameInputRef.current?.focus()
      deviceNameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [deviceNameDialogOpen])

  const openDeviceNameDialog = () => {
    setDeviceNameInput(deviceProfile.deviceName || (session?.device_named ? session.device_name ?? '' : ''))
    setDeviceNameDialogOpen(true)
  }

  const saveDeviceName = async () => {
    if (!supabase || !session || busy) return
    const nextName = deviceNameInput.trim().slice(0, 80)
    if (nextName.length < 2) {
      setError('Введите понятное имя устройства: минимум 2 символа')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const nextProfile: DeviceProfile = { ...deviceProfile, deviceName: nextName }
      const { data, error: configureError } = await (supabase as any).rpc('configure_fbs_marking_device', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
        p_device_name: nextName,
        p_device_named: true,
        p_scanner_model: scannerSelectionVisible ? nextProfile.scannerModel : null,
        p_scanner_test_status: scannerSelectionVisible ? nextProfile.scannerTestStatus : 'untested',
      })
      if (configureError) throw configureError

      let nextSession = data as ScanSession
      writeDeviceProfile(nextProfile)
      setDeviceProfile(nextProfile)
      setSession(nextSession)
      setDeviceNameDialogOpen(false)
      if (!session.device_named && ['active', 'partial', 'submitting'].includes(nextSession.status)) {
        const preferenceResult = await (supabase as any).rpc('apply_fbs_marking_preferences', {
          p_session_id: nextSession.id,
          p_device_id: stableDeviceId,
        })
        if (preferenceResult.error) throw preferenceResult.error
        nextSession = preferenceResult.data as ScanSession
        setSession(nextSession)
      }

      setNotice(session.device_named ? 'Имя устройства изменено' : 'Устройство готово к работе')
      window.requestAnimationFrame(() => inputRef.current?.focus())
    } catch (saveError) {
      setError(errorText(saveError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const selectScannerModel = async (model: ScannerModelProfile | null) => {
    if (!supabase || !session || busy || !deviceReady || !scannerSelectionVisible) return
    const modelName = model?.displayName ?? null
    if (modelName === deviceProfile.scannerModel) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const nextProfile: DeviceProfile = {
        ...deviceProfile,
        scannerModel: modelName,
        scannerTestStatus: 'untested',
      }
      const { data, error: configureError } = await (supabase as any).rpc('configure_fbs_marking_device', {
        p_session_id: session.id,
        p_device_id: stableDeviceId,
        p_device_name: deviceProfile.deviceName,
        p_device_named: true,
        p_scanner_model: modelName,
        p_scanner_test_status: 'untested',
      })
      if (configureError) throw configureError
      writeDeviceProfile(nextProfile)
      setDeviceProfile(nextProfile)
      setSession(data as ScanSession)
      setNotice(modelName ? `Выбран сканер: ${modelName}` : 'Сканер не выбран. Обычный ввод и камера доступны')
    } catch (configureError) {
      setError(errorText(configureError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const setBarcodeMode = async (enabled: boolean) => {
    if (!supabase || !session || busy || !deviceReady) return
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
    if (!supabase || !session || busy || !deviceReady) return
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
    if (!supabase || !session || busy || !deviceReady || session.status === 'completed') return
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
  serialScanHandlerRef.current = async (scannedValue: string) => {
    if (childDialogOpen) return
    await handleScan(scannedValue)
  }

  const disconnectSerial = useCallback(async () => {
    serialReadActiveRef.current = false
    serialConnectedProfileKeyRef.current = ''
    const reader = serialReaderRef.current
    serialReaderRef.current = null
    try {
      await reader?.cancel()
    } catch {
      // Порт мог быть физически отключён раньше нажатия кнопки.
    }
    if (!reader) {
      const port = serialPortRef.current
      serialPortRef.current = null
      try {
        await port?.close()
      } catch {
        // Уже закрытый порт не требует дополнительной обработки.
      }
    }
    setSerialStatus(browserSerialApi() ? 'disconnected' : 'unsupported')
    setSerialPortLabel('')
  }, [])

  const readSerialPort = async (port: BrowserSerialPort, maxPacketLength: number, packetTerminator: SerialPacketTerminator) => {
    if (!port.readable) throw new Error('COM-порт открыт без канала чтения')
    const reader = port.readable.getReader()
    serialReaderRef.current = reader
    let buffer = ''
    let ignoreLineFeedAfterCarriageReturn = false
    let failed = false
    try {
      while (serialReadActiveRef.current) {
        const result = await reader.read()
        if (result.done) break
        const chunk = result.value ? scannerBytesToString(result.value) : ''
        for (const character of chunk) {
          if (ignoreLineFeedAfterCarriageReturn && character === '\n') {
            ignoreLineFeedAfterCarriageReturn = false
            continue
          }
          ignoreLineFeedAfterCarriageReturn = false
          if (endsSerialPacket(character, packetTerminator)) {
            ignoreLineFeedAfterCarriageReturn = character === '\r'
            if (!buffer) continue
            const scannedValue = buffer
            buffer = ''
            await serialScanHandlerRef.current(scannedValue)
          } else {
            buffer += character
            if (buffer.length > maxPacketLength) throw new Error('Сканер передал слишком длинный пакет. Переподключите COM-порт.')
          }
        }
      }
    } catch (readError) {
      if (serialReadActiveRef.current) {
        failed = true
        setSerialStatus('error')
        setSerialError(errorText(readError))
      }
    } finally {
      serialReadActiveRef.current = false
      serialReaderRef.current = null
      try {
        reader.releaseLock()
      } catch {
        // Блокировка уже освобождена браузером.
      }
      try {
        await port.close()
      } catch {
        // Физически отключённый порт уже закрыт.
      }
      if (serialPortRef.current === port) serialPortRef.current = null
      serialConnectedProfileKeyRef.current = ''
      if (!failed) {
        setSerialStatus(browserSerialApi() ? 'disconnected' : 'unsupported')
        setSerialPortLabel('')
      }
    }
  }

  const connectScannerSerial = async () => {
    if (!serialScannerSelected || !selectedScannerProfile || serialStatus === 'connecting' || serialStatus === 'connected') return
    const serial = browserSerialApi()
    if (!serial) {
      setSerialStatus('unsupported')
      setSerialError('COM-подключение доступно в Chrome или Edge на компьютере')
      return
    }

    setSerialStatus('connecting')
    setSerialError('')
    try {
      const port = await serial.requestPort()
      await port.open(selectedScannerProfile.serialOptions)
      const info = port.getInfo?.() ?? {}
      const id = info.usbVendorId == null
        ? 'COM-порт'
        : `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
      serialPortRef.current = port
      serialConnectedProfileKeyRef.current = selectedSerialProfileKey
      serialReadActiveRef.current = true
      setSerialPortLabel(id)
      setSerialStatus('connected')
      setNotice('COM подключён. Сканер передаёт данные напрямую в ELESTET')
      const configuredMaxPacketLength = Number(selectedScannerProfile.scanOptions.maxPacketLength)
      const maxPacketLength = Number.isFinite(configuredMaxPacketLength)
        ? Math.max(256, Math.trunc(configuredMaxPacketLength))
        : 4096
      void readSerialPort(port, maxPacketLength, serialPacketTerminator(selectedScannerProfile.scanOptions.packetTerminator))
    } catch (connectError) {
      serialReadActiveRef.current = false
      serialPortRef.current = null
      const cancelled = connectError instanceof DOMException && connectError.name === 'NotFoundError'
      setSerialStatus('error')
      setSerialError(cancelled ? 'Выбор COM-порта отменён' : errorText(connectError))
    }
  }

  useEffect(() => {
    if (serialPortRef.current && serialConnectedProfileKeyRef.current !== selectedSerialProfileKey) void disconnectSerial()
  }, [disconnectSerial, selectedSerialProfileKey])

  useEffect(() => () => {
    serialReadActiveRef.current = false
    void serialReaderRef.current?.cancel().catch(() => undefined)
    if (!serialReaderRef.current) void serialPortRef.current?.close().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!cameraOpen || !deviceReady) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      setCameraLoading(false)
      if (!deviceReady) setCameraOpen(false)
      return
    }

    let cancelled = false
    let handled = false
    let controls: { stop(): void } | null = null
    let scanTimer: number | null = null
    const useRawKizDecoder = Boolean(sessionRef.current?.pending_order_id)
    setCameraError('')
    setCameraLoading(useRawKizDecoder)
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
        if (useRawKizDecoder) {
          const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader')
          await prepareZXingModule({
            fireImmediately: true,
            overrides: {
              locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? zxingReaderWasmUrl : `${prefix}${path}`,
            },
          })
          if (cancelled || !cameraVideoRef.current) return
          setCameraLoading(false)

          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) throw new Error('Canvas недоступен')

          const scanFrame = async () => {
            if (cancelled || handled) return
            const video = cameraVideoRef.current
            if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
              const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
              const width = Math.max(1, Math.round(video.videoWidth * scale))
              const height = Math.max(1, Math.round(video.videoHeight * scale))
              if (canvas.width !== width) canvas.width = width
              if (canvas.height !== height) canvas.height = height
              context.drawImage(video, 0, 0, width, height)
              try {
                const results = await readBarcodes(context.getImageData(0, 0, width, height), {
                  formats: ['DataMatrix'],
                  maxNumberOfSymbols: 1,
                  textMode: 'Plain',
                  tryHarder: true,
                  tryRotate: true,
                  tryInvert: true,
                })
                const result = results.find((candidate) => candidate.isValid && candidate.bytes.length > 0)
                if (result && !cancelled && !handled) {
                  handled = true
                  setCameraOpen(false)
                  cameraResultRef.current(scannerBytesToString(result.bytes))
                  return
                }
              } catch {
                if (!cancelled) setCameraError('Не удалось прочитать КИЗ. Наведите камеру ровно на DataMatrix и повторите.')
              }
            }
            if (!cancelled && !handled) scanTimer = window.setTimeout(() => { void scanFrame() }, 140)
          }
          void scanFrame()
        } else {
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
        }
      } catch {
        if (!cancelled) {
          setCameraLoading(false)
          setCameraError(useRawKizDecoder
            ? 'Не удалось запустить сканирование КИЗа. Повторите или введите КИЗ сканером.'
            : 'Не удалось открыть камеру. Разрешите доступ к камере в браузере или используйте сканер.')
        }
      }
    })()

    return () => {
      cancelled = true
      if (scanTimer !== null) window.clearTimeout(scanTimer)
      controls?.stop()
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
  }, [cameraOpen, deviceReady])

  // Аппаратный сканер работает как клавиатура. Даже если сотрудник случайно
  // кликнул по заголовку, списку или кнопке, первый символ следующего скана
  // возвращает ввод в единственное рабочее поле этой модалки.
  useEffect(() => {
    if (!deviceReady || cameraOpen || childDialogOpen || busy || loading || session?.status === 'completed') return

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

      if (event.ctrlKey || event.metaKey || event.altKey) return

      const ascii = usAsciiFromKeyboardEvent(event)
      if (ascii !== null) {
        event.preventDefault()
        event.stopPropagation()
        appendScannerValue(ascii)
      } else if (event.key === 'Enter') {
        if (document.activeElement !== input) {
          event.preventDefault()
          focusInput()
        }
      } else if (document.activeElement !== input && event.key.length === 1) {
        event.preventDefault()
        appendScannerValue(normalizeScannerKeyboardLayout(event.key))
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
  }, [busy, cameraOpen, childDialogOpen, deviceReady, loading, session?.status])

  const releasePending = async () => {
    if (!supabase || !session || busy || !deviceReady) return
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
    if (!supabase || !session || !deviceReady || !['draft', 'error'].includes(pair.status) || !window.confirm(`Удалить пару заказа №${pair.order_id}?`)) return
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

  const removeAllPairs = async () => {
    if (!supabase || !session || busy || !deviceReady) return
    const removablePairs = pairs.filter((pair) => pair.status === 'draft' || pair.status === 'error')
    if (removablePairs.length === 0) return
    if (!window.confirm(`Удалить все неотправленные пары: ${removablePairs.length}? Отменить это действие нельзя.`)) return

    setBusy(true)
    setError('')
    setNotice('')
    let removed = 0
    const failures: string[] = []
    try {
      for (let index = 0; index < removablePairs.length; index += 20) {
        const chunk = removablePairs.slice(index, index + 20)
        const results = await Promise.all(chunk.map((pair) => (supabase as any).rpc('delete_fbs_marking_pair', {
          p_pair_id: pair.id,
          p_device_id: stableDeviceId,
        })))
        results.forEach((result: { error?: unknown }) => {
          if (result.error) failures.push(errorText(result.error))
          else removed += 1
        })
      }
      setSelectedPair(null)
      await loadPairs(session.id)
      if (failures.length > 0) {
        setError(`Удалено пар: ${removed}. Не удалено: ${failures.length}. ${failures[0]}`)
        signal(false)
      } else {
        setNotice(`Очередь очищена. Удалено пар: ${removed}`)
        signal(true)
      }
    } catch (removeError) {
      await loadPairs(session.id)
      setError(errorText(removeError))
      signal(false)
    } finally {
      setBusy(false)
    }
  }

  const recoverSession = async (source: RecoverableScanSession) => {
    if (!supabase || !session || busy || !deviceReady || !window.confirm(`Забрать сохранённые пары с устройства ${source.device_name || source.device_id.slice(0, 6)}?`)) return
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

  const discardSession = async (source: RecoverableScanSession) => {
    if (!supabase || !session || busy || !deviceReady) return
    const pendingText = source.pending_order_id || source.pending_product_barcode
      ? ' Незавершённое текущее сканирование также будет сброшено.'
      : ''
    if (!window.confirm(`Удалить неотправленные пары: ${source.recoverable_pair_count}?${pendingText} Отменить это действие нельзя.`)) return
    setBusy(true)
    setError('')
    try {
      const { data, error: discardError } = await (supabase as any).rpc('discard_fbs_marking_session', {
        p_source_session_id: source.id,
        p_target_session_id: session.id,
        p_device_id: stableDeviceId,
      })
      if (discardError) throw discardError
      await loadRecoverableSessions(session.id)
      setNotice(`Удалено неотправленных пар: ${Number(data ?? 0)}`)
    } catch (discardError) {
      setError(errorText(discardError))
    } finally {
      setBusy(false)
    }
  }

  const openPairDetails = async (pair: ScanPair) => {
    if (!supabase) return
    const requestId = pairDetailsRequestRef.current + 1
    pairDetailsRequestRef.current = requestId
    setSelectedPair(pair)
    setSelectedPairBox(null)
    setSelectedPairBoxError('')
    const sourceBoxId = pair.product_snapshot.source_box_id
    if (!sourceBoxId) {
      setSelectedPairBoxLoading(false)
      return
    }
    if (activeBox?.boxId === sourceBoxId) {
      setSelectedPairBox(activeBox)
      setSelectedPairBoxLoading(false)
      return
    }

    setSelectedPairBoxLoading(true)
    try {
      const { data: box, error: boxError } = await (supabase as any)
        .from('fulfillment_boxes')
        .select('id, barcode, box_number, supply_id')
        .eq('id', sourceBoxId)
        .maybeSingle()
      if (boxError) throw boxError
      if (!box) throw new Error('Короб не найден')
      const { data: supply, error: supplyError } = await (supabase as any)
        .from('fulfillment_supplies')
        .select('supply_number, batch_id')
        .eq('id', box.supply_id)
        .maybeSingle()
      if (supplyError) throw supplyError
      if (!supply) throw new Error('Приёмка короба не найдена')
      const { data: batch, error: batchError } = await (supabase as any)
        .from('fulfillment_batches')
        .select('short_id, name')
        .eq('id', supply.batch_id)
        .maybeSingle()
      if (batchError) throw batchError
      if (!batch) throw new Error('Партия короба не найдена')
      if (pairDetailsRequestRef.current !== requestId) return
      setSelectedPairBox({
        boxId: String(box.id),
        barcode: String(box.barcode ?? ''),
        boxNumber: Number(box.box_number),
        supplyNumber: Number(supply.supply_number),
        batchNumber: Number(batch.short_id),
        batchName: String(batch.name ?? ''),
      })
    } catch (boxLoadError) {
      if (pairDetailsRequestRef.current === requestId) setSelectedPairBoxError(errorText(boxLoadError))
    } finally {
      if (pairDetailsRequestRef.current === requestId) setSelectedPairBoxLoading(false)
    }
  }

  const finish = async () => {
    if (!session || busy || !deviceReady) return
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
      if (Number(result.sent ?? 0) > 0 && onKizStatesUpdated) {
        try {
          await onKizStatesUpdated()
        } catch (refreshError) {
          console.warn('Не удалось перечитать подтверждённые статусы КИЗ:', refreshError)
        }
      }
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
  const selectedPairOrder = selectedPair ? ordersById.get(selectedPair.order_id) : null
  const selectedKizParts = selectedPair?.sgtin.split(GS) ?? []
  const selectedKizMatch = selectedPair ? /^01(\d{14})21([^\u001d]+)/.exec(selectedPair.sgtin) : null
  const scannerStatusLabel = deviceProfile.scannerTestStatus === 'passed'
    ? 'Проверен'
    : deviceProfile.scannerTestStatus === 'failed'
      ? 'Тест не пройден'
      : 'Не проверен'
  const scannerStatusClass = deviceProfile.scannerTestStatus === 'passed'
    ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
    : deviceProfile.scannerTestStatus === 'failed'
      ? 'border-red-200 bg-red-100 text-red-700'
      : 'border-slate-200 bg-slate-100 text-slate-600'
  const openCamera = () => {
    if (!deviceReady) return
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
          if (!deviceReady || cameraOpen || childDialogOpen || (window.matchMedia?.('(pointer: coarse)').matches ?? false)) return
          const target = event.target as HTMLElement
          if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
          window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
        }}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Сканирование КИЗ</h2>
            <p className="mt-1 text-xs text-slate-500">{storeName} · {session?.device_named ? session.device_name : 'имя устройства не задано'}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Подготавливаем QR заказов…</div>
          ) : (
            <>
              <section className={`rounded-2xl border-2 p-3 text-center sm:rounded-3xl sm:p-6 ${session?.pending_order_id ? 'border-emerald-300 bg-emerald-50' : 'border-violet-300 bg-violet-50'}`}>
                {!deviceReady && (
                  <div className="mx-auto mb-3 max-w-2xl rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 sm:mb-4 sm:text-sm">
                    Сначала назовите устройство кнопкой внизу. До этого сканирование заблокировано.
                  </div>
                )}
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
                        disabled={!deviceReady || busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)}
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
                        disabled={!deviceReady || busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)}
                        onChange={(event) => void setBarcodeMode(event.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-violet-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
                    </label>
                    {scannerSelectionVisible && (
                      <button
                        type="button"
                        disabled={!deviceReady || busy || cameraOpen}
                        onClick={() => setScannerDialogOpen(true)}
                        className="col-span-2 flex min-h-[58px] items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-center transition-colors hover:border-violet-300 disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-2xl sm:px-4 sm:py-3"
                      >
                        {deviceProfile.scannerModel ? (
                          <span className={`inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold sm:text-sm ${scannerStatusClass}`}>
                            <span className="truncate">{deviceProfile.scannerModel}</span>
                            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-bold uppercase sm:text-[10px]">{scannerStatusLabel}</span>
                            {serialScannerSelected && serialStatus === 'connected' && (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold uppercase text-white sm:text-[10px]">COM</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-500 sm:text-sm">Сканер не выбран</span>
                        )}
                      </button>
                    )}
                  </div>
                )}
                {boxEnabled && activeBox && !boxScanMode && session?.status !== 'completed' && (
                  <div className="mx-auto mt-3 flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-left">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Активный короб</div>
                      <div className="mt-0.5 truncate text-sm font-bold text-slate-900">P-{activeBox.batchNumber} · S-{activeBox.supplyNumber} · Короб {activeBox.boxNumber}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{activeBox.barcode}</div>
                    </div>
                    <button type="button" disabled={!deviceReady || busy || Boolean(session?.pending_order_id || session?.pending_product_barcode)} onClick={() => { setSelectingBox(true); setValue(''); window.requestAnimationFrame(() => inputRef.current?.focus()) }} className="shrink-0 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40">Сменить</button>
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
                      onChange={(event) => setValue(normalizeScannerKeyboardLayout(event.target.value))}
                      disabled={!deviceReady || busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={boxScanMode ? 'QR короба' : barcodeStep ? 'Баркод товара' : session?.pending_order_id ? 'КИЗ' : 'QR заказа WB'}
                      className="h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:opacity-60 sm:h-auto sm:rounded-2xl sm:px-5 sm:py-4 sm:text-base"
                    />
                    <button
                      type="button"
                      disabled={!deviceReady || busy}
                      onClick={openCamera}
                      className="flex h-12 w-12 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-3"
                      title="Сканировать камерой телефона"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"/><circle cx="12" cy="13" r="3"/></svg>
                      <span className="hidden sm:inline">Камера</span>
                    </button>
                    <button type="submit" disabled={!deviceReady || busy || value.length === 0} className="col-span-2 h-12 rounded-xl bg-violet-600 px-6 text-sm font-semibold text-white disabled:opacity-40 sm:col-span-1 sm:h-auto sm:rounded-2xl sm:py-3">{busy ? 'Сохраняем…' : 'Принять'}</button>
                  </form>
                )}
                {(session?.pending_order_id || session?.pending_product_barcode) && session.status !== 'completed' && (
                  <button type="button" onClick={() => void releasePending()} disabled={!deviceReady || busy} className="mt-3 text-xs font-medium text-slate-500 underline hover:text-red-600 disabled:opacity-40">Сбросить текущую пару</button>
                )}
              </section>

              {catalogMissing > 0 && <div className="mt-3 rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700">WB не вернул QR для {catalogMissing} заказов. Остальные доступны для сканирования.</div>}

              {recoverableSessions.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">Есть прерванная работа на другом устройстве</div>
                  <div className="mt-2 space-y-2">
                    {recoverableSessions.map((source) => (
                      <div key={source.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                        <span>{source.device_name || `Устройство ${source.device_id.slice(0, 6)}`} · сохранено пар: {source.recoverable_pair_count}</span>
                        <div className="flex shrink-0 items-center gap-3">
                          <button type="button" onClick={() => void recoverSession(source)} disabled={!deviceReady || busy} className="font-semibold text-violet-700 hover:underline disabled:opacity-40">Забрать работу</button>
                          <button type="button" onClick={() => void discardSession(source)} disabled={!deviceReady || busy} className="font-semibold text-red-600 hover:underline disabled:opacity-40">Удалить</button>
                        </div>
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
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-700">Отсканированные пары</span>
                  <div className="flex min-w-0 items-center justify-end gap-3">
                    {pairs.length > 0 && <span className="hidden text-xs font-semibold text-emerald-700 sm:inline">Нажмите на заказ — покажем данные скана</span>}
                    {(draftCount + errorCount) > 0 && (
                      <button
                        type="button"
                        onClick={() => void removeAllPairs()}
                        disabled={!deviceReady || busy}
                        className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Очистить очередь
                      </button>
                    )}
                  </div>
                </div>
                {pairs.length === 0 ? <div className="px-4 py-8 text-center text-sm text-slate-400">Пока ничего не отсканировано</div> : (
                  <div className="divide-y divide-slate-100">
                    {pairs.map((pair) => {
                      const order = ordersById.get(pair.order_id)
                      return (
                        <div
                          key={pair.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => void openPairDetails(pair)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void openPairDetails(pair)
                            }
                          }}
                          className="flex cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-emerald-50/60 focus:bg-emerald-50/60 focus:outline-none sm:gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-800">Заказ № {pair.order_id}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-500">{order?.productName || pair.product_snapshot.article || 'Товар'} · КИЗ: <span className="font-mono">{pair.sgtin}</span></div>
                            {pair.error && <div className="mt-1 text-xs font-medium text-red-600">{pairErrorText(pair.error, pair.order_id)}</div>}
                          </div>
                          <span className="hidden text-xs font-semibold text-emerald-700 sm:inline">Данные</span>
                          <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${pair.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : pair.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'}`}>
                            {pair.status === 'sent' ? 'В WB' : pair.status === 'error' ? 'Ошибка' : 'Готово'}
                          </span>
                          {['draft', 'error'].includes(pair.status) && <button type="button" title="Удалить ошибочную пару" onClick={(event) => { event.stopPropagation(); void removePair(pair) }} disabled={!deviceReady || busy} className="text-lg text-slate-300 hover:text-red-500 disabled:opacity-40">×</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-100 px-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={openDeviceNameDialog}
            disabled={loading || busy || !session}
            className={`flex h-12 min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold transition-colors disabled:opacity-40 sm:h-auto sm:max-w-sm sm:px-4 sm:py-2.5 sm:text-sm ${
              deviceReady
                ? 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-700'
                : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></svg>
            <span className="min-w-0 truncate">{deviceReady ? session?.device_name : 'Назвать устройство'}</span>
            {deviceReady && <span className="shrink-0 text-[10px] font-medium text-slate-400">Изменить</span>}
          </button>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className={`h-12 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 sm:h-auto sm:px-4 sm:py-2.5 ${session?.status === 'completed' ? 'col-span-2' : ''}`}>Закрыть</button>
            {session?.status !== 'completed' && <button type="button" onClick={() => void finish()} disabled={!deviceReady || busy || loading || pairs.length === 0} className="h-12 whitespace-nowrap rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-40 sm:h-auto sm:px-5 sm:py-2.5"><span className="sm:hidden">Отправить</span><span className="hidden sm:inline">Завершить и отправить в WB</span></button>}
          </div>
        </footer>

        {deviceNameDialogOpen && (
          <div className="fixed inset-0 z-[130] flex h-[100dvh] items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Имя устройства" onClick={() => { if (!busy) setDeviceNameDialogOpen(false) }}>
            <form className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void saveDeviceName() }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Имя устройства</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">Например: «Ноутбук упаковки» или «Телефон склада».</p>
                </div>
                <button type="button" disabled={busy} onClick={() => setDeviceNameDialogOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200 disabled:opacity-40">×</button>
              </div>
              <input
                ref={deviceNameInputRef}
                autoFocus
                value={deviceNameInput}
                onChange={(event) => setDeviceNameInput(event.target.value.slice(0, 80))}
                disabled={busy}
                maxLength={80}
                placeholder="Введите имя устройства"
                className="mt-5 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:opacity-50"
              />
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={() => setDeviceNameDialogOpen(false)} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 disabled:opacity-40">Отмена</button>
                <button type="submit" disabled={busy || deviceNameInput.trim().length < 2} className="h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        )}

        {scannerDialogOpen && scannerSelectionVisible && (
          <div className="fixed inset-0 z-[125] flex h-[100dvh] items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Выбор USB-сканера" onClick={() => { if (!busy) setScannerDialogOpen(false) }}>
            <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">USB-сканер</h3>
                  <p className="mt-1 text-xs text-slate-500">На этом устройстве одновременно выбирается одна модель.</p>
                </div>
                <button type="button" disabled={busy} onClick={() => setScannerDialogOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200 disabled:opacity-40">×</button>
              </div>
              <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
                <label className="relative block">
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                  <input
                    value={scannerSearch}
                    onChange={(event) => setScannerSearch(event.target.value)}
                    placeholder="Поиск по бренду или модели"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void selectScannerModel(null)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors disabled:opacity-40 ${deviceProfile.scannerModel === null ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:border-violet-300'}`}
                >
                  <span>Сканер не выбран</span>
                  {deviceProfile.scannerModel === null && <span className="text-violet-600">✓</span>}
                </button>
                {filteredScannerModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void selectScannerModel(model)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors disabled:opacity-40 ${deviceProfile.scannerModel === model.displayName ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:border-violet-300'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{model.displayName}</span>
                      <span className="mt-0.5 block text-[10px] font-medium text-slate-400">{model.connectionType === 'web_serial' ? 'COM через браузер' : 'Обычный USB'}</span>
                    </span>
                    {deviceProfile.scannerModel === model.displayName && <span className="shrink-0 text-violet-600">✓</span>}
                  </button>
                ))}
                {scannerCatalogLoading && scannerModels.length === 0 && (
                  <div className="py-4 text-center text-xs text-slate-400">Загрузка моделей…</div>
                )}
                {scannerCatalogError && scannerModels.length === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs leading-5 text-amber-700">
                    Каталог временно не загрузился. Оставьте «Сканер не выбран» — работа не блокируется.
                  </div>
                )}
                {!scannerCatalogLoading && !scannerCatalogError && filteredScannerModels.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs leading-5 text-slate-500">
                    Такой модели пока нет. Оставьте «Сканер не выбран» — обычный режим продолжит работать.
                  </div>
                )}

                {selectedScannerProfile && selectedScannerHasDetails && (
                  <section className="mt-4 space-y-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-3 sm:p-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Настройка {selectedScannerProfile.displayName}</h4>
                      {selectedScannerProfile.instructions && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{selectedScannerProfile.instructions}</p>}
                    </div>
                    {selectedScannerProfile.setupBarcodes.length > 0 && (
                      <div className="grid gap-2">
                        {selectedScannerProfile.setupBarcodes.map((code, index) => <ScannerSetupBarcode key={`${index}-${code.value}`} value={code.value} label={code.label} format={code.format} />)}
                      </div>
                    )}
                    {selectedScannerProfile.warningText && (
                      <div className="whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                        {selectedScannerProfile.warningText}
                      </div>
                    )}
                    {selectedScannerProfile.connectionType === 'web_serial' && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {serialStatus === 'connected' ? (
                          <button type="button" onClick={() => void disconnectSerial()} className="h-11 flex-1 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-50">Отключить COM</button>
                        ) : (
                          <button
                            type="button"
                            disabled={serialStatus === 'connecting' || serialStatus === 'unsupported'}
                            onClick={() => void connectScannerSerial()}
                            className="h-11 flex-1 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {serialStatus === 'connecting' ? 'Подключаем…' : 'Подключить COM к ELESTET'}
                          </button>
                        )}
                        <div className={`flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-center text-xs font-semibold ${
                          serialStatus === 'connected'
                            ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                            : serialStatus === 'error'
                              ? 'border-red-200 bg-red-50 text-red-600'
                              : 'border-slate-200 bg-white text-slate-500'
                        }`}>
                          {serialStatus === 'connected'
                            ? `COM подключён · ${serialPortLabel}`
                            : serialStatus === 'unsupported'
                              ? 'Нужен Chrome или Edge на ПК'
                              : serialStatus === 'error'
                                ? serialError
                                : 'COM не подключён'}
                        </div>
                      </div>
                    )}
                    {selectedScannerProfile.restoreBarcodes.length > 0 && (
                      <details className="rounded-xl border border-slate-200 bg-white">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Вернуть обычный USB-режим</summary>
                        <div className="grid gap-2 border-t border-slate-100 p-3">
                          {selectedScannerProfile.restoreBarcodes.map((code, index) => <ScannerSetupBarcode key={`${index}-${code.value}`} value={code.value} label={code.label} format={code.format} />)}
                        </div>
                      </details>
                    )}
                  </section>
                )}
              </div>
              <div className="border-t border-slate-100 px-4 py-3 text-center text-[11px] text-slate-500 sm:px-5">
                Нет модели в списке — оставьте «Сканер не выбран». Работа не блокируется.
              </div>
            </div>
          </div>
        )}

        {selectedPair && (
          <div className="fixed inset-0 z-[110] flex h-[100dvh] items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={`Данные скана заказа ${selectedPair.order_id}`} onClick={() => setSelectedPair(null)}>
            <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-6">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900">Данные скана</h3>
                  <div className="mt-1 text-xs text-slate-500">Заказ № {selectedPair.order_id} · {scanTime(selectedPair.created_at)}</div>
                </div>
                <button type="button" onClick={() => setSelectedPair(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200">×</button>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:space-y-4 sm:p-5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Магазин WB</div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-800">{storeName}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Состояние пары</div>
                    <div className={`mt-1 text-sm font-semibold ${selectedPair.status === 'sent' ? 'text-emerald-700' : selectedPair.status === 'error' ? 'text-red-600' : 'text-violet-700'}`}>
                      {selectedPair.status === 'sent' ? 'Передана в WB' : selectedPair.status === 'error' ? 'Ошибка отправки' : selectedPair.status === 'sending' ? 'Отправляется' : 'Ожидает отправки'}
                    </div>
                  </div>
                </div>

                <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-violet-500">QR заказа WB</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">Задание № {selectedPair.order_id}</div>
                    </div>
                    <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-violet-600 shadow-sm">QR принят</span>
                  </div>
                  <div className="mt-2 break-all rounded-xl bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-600">{selectedPair.wb_qr}</div>
                </section>

                <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">КИЗ, сохранённый системой</div>
                    <div className="text-[10px] font-semibold text-emerald-700">Байт: {selectedPair.sgtin.length} · GS: {Math.max(0, selectedKizParts.length - 1)}</div>
                  </div>
                  <div className="mt-2 break-all rounded-xl bg-slate-950 px-3 py-3 font-mono text-xs leading-6 text-emerald-200">
                    {selectedKizParts.map((part, index) => (
                      <span key={`${index}-${part}`}>
                        {index > 0 && <span className="mx-1 inline-flex rounded bg-amber-400 px-1.5 py-0.5 align-middle text-[9px] font-black leading-none text-slate-950">GS</span>}
                        {part}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-white px-3 py-2">
                      <span className="text-[10px] text-slate-400">GTIN</span>
                      <div className="break-all font-mono text-xs font-semibold text-slate-700">{selectedKizMatch?.[1] ?? 'Не определён'}</div>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2">
                      <span className="text-[10px] text-slate-400">Серийный номер</span>
                      <div className="break-all font-mono text-xs font-semibold text-slate-700">{selectedKizMatch?.[2] ?? 'Не определён'}</div>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Товар</div>
                  <div className="mt-2 flex gap-3">
                    {selectedPairOrder?.photoUrl && <img src={selectedPairOrder.photoUrl} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-snug text-slate-900">{selectedPairOrder?.productName || selectedPair.product_snapshot.article || 'Товар WB'}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[selectedPairOrder?.productBrand, selectedPairOrder?.productColor, selectedPairOrder?.productSize].filter(Boolean).join(' · ') || 'Характеристики не получены'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="text-[10px] text-slate-400">Арт. WB</span><div className="font-mono text-xs font-semibold text-slate-700">{selectedPair.product_snapshot.nm_id ?? selectedPairOrder?.nmId ?? '—'}</div></div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="text-[10px] text-slate-400">Артикул</span><div className="truncate text-xs font-semibold text-slate-700">{selectedPairOrder?.productVendorCode || selectedPair.product_snapshot.article || selectedPairOrder?.article || '—'}</div></div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2"><span className="text-[10px] text-slate-400">Баркод товара</span><div className="break-all font-mono text-xs font-semibold text-slate-700">{selectedPair.product_snapshot.barcode || selectedPairOrder?.productBarcode || 'Не использовался'}</div></div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 p-3 sm:p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Короб</div>
                  {!selectedPair.product_snapshot.source_box_id ? (
                    <div className="mt-2 text-sm text-slate-500">Контроль короба для этой пары не использовался.</div>
                  ) : selectedPairBoxLoading ? (
                    <div className="mt-2 text-sm text-slate-500">Загружаем данные короба…</div>
                  ) : selectedPairBox ? (
                    <div className="mt-2">
                      <div className="text-sm font-bold text-slate-900">P-{selectedPairBox.batchNumber} · S-{selectedPairBox.supplyNumber} · Короб {selectedPairBox.boxNumber}</div>
                      <div className="mt-1 text-xs text-slate-500">Магазин WB: <b className="text-slate-700">{storeName}</b>{selectedPairBox.batchName ? ` · ${selectedPairBox.batchName}` : ''}</div>
                      <div className="mt-2 break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{selectedPairBox.barcode || 'ШК короба не получен'}</div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-red-600">{selectedPairBoxError || `Данные короба ${selectedPair.product_snapshot.source_box_id} не найдены`}</div>
                  )}
                </section>

                {selectedPair.error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{pairErrorText(selectedPair.error, selectedPair.order_id)}</div>}
              </div>

              <footer className="shrink-0 border-t border-slate-100 p-3 sm:px-5 sm:py-4">
                <button type="button" onClick={() => setSelectedPair(null)} className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800">Закрыть</button>
              </footer>
            </div>
          </div>
        )}

        {cameraOpen && session?.status !== 'completed' && (
          <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label={`Сканирование камерой: ${scanTarget}`}>
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Наведите камеру на {scanTarget}</div>
                <div className="mt-0.5 text-[11px] text-white/60">
                  {session?.pending_order_id ? 'КИЗ считывается напрямую из DataMatrix' : 'Код распознается автоматически'}
                </div>
              </div>
              <button type="button" onClick={() => setCameraOpen(false)} className="flex h-10 shrink-0 items-center rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">Закрыть</button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
              <video ref={cameraVideoRef} autoPlay muted playsInline className="h-full w-full bg-black object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                <div className="aspect-square w-full max-w-[300px] rounded-3xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
              </div>
              {cameraLoading && <div className="absolute inset-x-4 bottom-6 rounded-2xl bg-slate-900/90 px-4 py-3 text-center text-xs font-medium text-white">Запускаем сканирование КИЗа…</div>}
              {cameraError && <div className="absolute inset-x-4 bottom-6 rounded-2xl bg-red-500/90 px-4 py-3 text-center text-xs font-medium text-white">{cameraError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
