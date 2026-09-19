import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchActiveScannerModels,
  readCachedActiveScannerModels,
  type ScannerModelProfile,
} from '../../services/scannerModelService'
import {
  endsSerialPacket,
  scannerBytesToString,
  serialPacketTerminator,
} from '../../lib/scannerInput'

const DEVICE_PROFILE_KEY = 'elestet_fbs_scanner_profile_v1'

type SerialConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unsupported' | 'error'

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

type Props = {
  disabled?: boolean
  onScan: (value: string) => void | Promise<void>
  onScannerModelChanged?: () => void
}

function browserSerialApi(): BrowserSerialApi | null {
  return ((navigator as Navigator & { serial?: BrowserSerialApi }).serial ?? null)
}

function readSelectedScannerModel(): string {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_PROFILE_KEY) ?? '{}') as Record<string, unknown>
    return typeof saved.scannerModel === 'string' ? saved.scannerModel : ''
  } catch {
    return ''
  }
}

function saveSelectedScannerModel(scannerModel: string) {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(DEVICE_PROFILE_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    saved = {}
  }
  localStorage.setItem(DEVICE_PROFILE_KEY, JSON.stringify({
    ...saved,
    scannerModel: scannerModel || null,
    scannerTestStatus: 'untested',
  }))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Неизвестная ошибка сканера')
}

export function FulfillmentElestetScanner({ disabled = false, onScan, onScannerModelChanged }: Props) {
  const [models, setModels] = useState<ScannerModelProfile[]>(readCachedActiveScannerModels)
  const [selectedName, setSelectedName] = useState(readSelectedScannerModel)
  const [status, setStatus] = useState<SerialConnectionStatus>(() => browserSerialApi() ? 'disconnected' : 'unsupported')
  const [message, setMessage] = useState('')
  const portRef = useRef<BrowserSerialPort | null>(null)
  const readerRef = useRef<BrowserSerialReader | null>(null)
  const readingRef = useRef(false)
  const connectedProfileKeyRef = useRef('')
  const autoConnectProfileKeyRef = useRef('')
  const connectionAttemptRef = useRef(false)
  const scanHandlerRef = useRef(onScan)
  scanHandlerRef.current = onScan

  useEffect(() => {
    let cancelled = false
    void fetchActiveScannerModels()
      .then((rows) => { if (!cancelled) setModels(rows) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(
    () => models.find((model) => model.displayName === selectedName) ?? null,
    [models, selectedName],
  )
  const selectedProfileKey = selected?.connectionType === 'web_serial'
    ? `${selected.id}:${selected.profileVersion}`
    : ''

  const disconnect = useCallback(async () => {
    readingRef.current = false
    connectedProfileKeyRef.current = ''
    try { await readerRef.current?.cancel() } catch { /* порт уже отключён */ }
    readerRef.current = null
    if (!readerRef.current) {
      const port = portRef.current
      portRef.current = null
      try { await port?.close() } catch { /* порт уже закрыт */ }
    }
    setStatus(browserSerialApi() ? 'disconnected' : 'unsupported')
    setMessage('')
  }, [])

  useEffect(() => () => {
    readingRef.current = false
    void readerRef.current?.cancel().catch(() => undefined)
    if (!readerRef.current) void portRef.current?.close().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (portRef.current && connectedProfileKeyRef.current !== selectedProfileKey) void disconnect()
  }, [disconnect, selectedProfileKey])

  const readPort = async (port: BrowserSerialPort, profile: ScannerModelProfile) => {
    if (!port.readable) throw new Error('Режим ELESTET подключён без канала чтения')
    const reader = port.readable.getReader()
    readerRef.current = reader
    const terminator = serialPacketTerminator(profile.scanOptions.packetTerminator)
    const configuredLength = Number(profile.scanOptions.maxPacketLength)
    const maxPacketLength = Number.isFinite(configuredLength) ? Math.max(256, Math.trunc(configuredLength)) : 4096
    let buffer = ''
    let ignoreLineFeed = false
    try {
      while (readingRef.current) {
        const result = await reader.read()
        if (result.done) break
        const chunk = result.value ? scannerBytesToString(result.value) : ''
        for (const character of chunk) {
          if (ignoreLineFeed && character === '\n') {
            ignoreLineFeed = false
            continue
          }
          ignoreLineFeed = false
          if (endsSerialPacket(character, terminator)) {
            ignoreLineFeed = character === '\r'
            if (!buffer) continue
            const value = buffer
            buffer = ''
            await scanHandlerRef.current(value)
          } else {
            buffer += character
            if (buffer.length > maxPacketLength) throw new Error('Сканер передал слишком длинный пакет')
          }
        }
      }
    } catch (error) {
      if (readingRef.current) {
        setStatus('error')
        setMessage(errorText(error))
      }
    } finally {
      readingRef.current = false
      readerRef.current = null
      try { reader.releaseLock() } catch { /* блокировка уже освобождена */ }
      try { await port.close() } catch { /* порт уже закрыт */ }
      if (portRef.current === port) portRef.current = null
      connectedProfileKeyRef.current = ''
      setStatus((current) => current === 'error' ? current : (browserSerialApi() ? 'disconnected' : 'unsupported'))
    }
  }

  const activatePort = async (
    port: BrowserSerialPort,
    profile: ScannerModelProfile,
    profileKey: string,
    automatically: boolean,
  ) => {
    await port.open(profile.serialOptions)
    if (!port.readable) throw new Error('Режим ELESTET подключён без канала чтения')
    portRef.current = port
    connectedProfileKeyRef.current = profileKey
    readingRef.current = true
    setStatus('connected')
    setMessage(automatically
      ? 'Сканер подключён автоматически и читает исходные данные КИЗ'
      : 'Сканер подключён и читает исходные данные КИЗ')
    void readPort(port, profile)
  }

  const connect = async () => {
    if (!selected || selected.connectionType !== 'web_serial' || !selectedProfileKey || disabled || connectionAttemptRef.current) return
    const serial = browserSerialApi()
    if (!serial) {
      setStatus('unsupported')
      setMessage('Режим ELESTET доступен в Chrome или Edge на компьютере')
      return
    }
    setStatus('connecting')
    setMessage('')
    connectionAttemptRef.current = true
    let port: BrowserSerialPort | null = null
    try {
      port = await serial.requestPort()
      await activatePort(port, selected, selectedProfileKey, false)
    } catch (error) {
      readingRef.current = false
      portRef.current = null
      connectedProfileKeyRef.current = ''
      try { await port?.close() } catch { /* Порт мог не успеть открыться. */ }
      const cancelled = error instanceof DOMException && error.name === 'NotFoundError'
      setStatus('error')
      setMessage(cancelled ? 'Выбор устройства отменён' : errorText(error))
    } finally {
      connectionAttemptRef.current = false
    }
  }

  useEffect(() => {
    if (disabled || !selected || selected.connectionType !== 'web_serial' || !selectedProfileKey || portRef.current) return
    const serial = browserSerialApi()
    if (!serial?.getPorts) return
    let cancelled = false

    void serial.getPorts().then(async (ports) => {
      if (cancelled || portRef.current || connectionAttemptRef.current || autoConnectProfileKeyRef.current === selectedProfileKey) return
      const port = ports[0]
      if (!port) return
      autoConnectProfileKeyRef.current = selectedProfileKey
      connectionAttemptRef.current = true
      setStatus('connecting')
      setMessage('Подключаем ранее разрешённый сканер…')
      try {
        await activatePort(port, selected, selectedProfileKey, true)
      } catch (error) {
        readingRef.current = false
        portRef.current = null
        connectedProfileKeyRef.current = ''
        try { await port.close() } catch { /* Порт мог уже закрыться. */ }
        if (!cancelled) {
          setStatus('error')
          setMessage(`Автоподключение не удалось: ${errorText(error)}. Нажмите «Подключить».`)
        }
      } finally {
        connectionAttemptRef.current = false
      }
    }).catch((error) => {
      if (!cancelled) {
        setStatus('error')
        setMessage(`Не удалось получить ранее разрешённый сканер: ${errorText(error)}`)
      }
    })

    return () => { cancelled = true }
  }, [disabled, selected, selectedProfileKey])

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2">
      <span className="text-xs font-bold text-violet-800">Режим ELESTET</span>
      <select
        value={selectedName}
        disabled={disabled || status === 'connected' || status === 'connecting'}
        onChange={(event) => {
          const next = event.target.value
          setSelectedName(next)
          saveSelectedScannerModel(next)
          onScannerModelChanged?.()
        }}
        className="max-w-[250px] rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-violet-400 disabled:opacity-60"
      >
        <option value="">Выберите модель сканера</option>
        {models.map((model) => <option key={model.id} value={model.displayName}>{model.displayName}</option>)}
      </select>
      {selected?.connectionType === 'web_serial' ? (
        status === 'connected' ? (
          <button type="button" onClick={() => void disconnect()} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Подключён · отключить</button>
        ) : (
          <button type="button" disabled={disabled || status === 'connecting'} onClick={() => void connect()} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">
            {status === 'connecting' ? 'Подключение…' : 'Подключить'}
          </button>
        )
      ) : selected ? <span className="text-[11px] text-violet-700">Обычный USB: защищённое чтение по физическим клавишам</span> : null}
      {message && <span className={`text-[11px] ${status === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{message}</span>}
    </div>
  )
}
