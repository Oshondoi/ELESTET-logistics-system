import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addPhoneBoxItem,
  confirmPhoneBoxCorrection,
  lookupPhoneBox,
  lookupStoreBarcode,
  phoneBoxErrorText,
  removePhoneBoxItem,
  type PhoneBox,
  type PhoneBoxItem,
} from '../../services/phoneBoxCamera'

type Screen = 'home' | 'scan' | 'info' | 'branch' | 'add' | 'remove'
type Mode = 'view' | 'edit'
type ExitTarget = 'home' | 'close'
type Notice = { tone: 'info' | 'error'; text: string }
type Dialog =
  | { kind: 'start-correction' }
  | { kind: 'unsaved'; target: ExitTarget }
  | { kind: 'correction'; target: ExitTarget }
  | { kind: 'remove-all'; barcode: string; qty: number; inBox: number }
  | { kind: 'unknown-product'; barcode: string; qty: number; name: string | null }

const primaryButton = 'flex h-14 w-full items-center justify-center rounded-2xl bg-blue-600 px-4 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50'
const secondaryButton = 'flex h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50'
const roseButton = 'flex h-14 w-full items-center justify-center rounded-2xl bg-rose-600 px-4 text-base font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50'
const quietButton = 'flex h-12 w-full items-center justify-center rounded-2xl px-4 text-sm font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50'

const SCAN_FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'data_matrix', 'upc_a', 'upc_e', 'itf']

function articleText(item: PhoneBoxItem, field: 'vendor_code' | 'nm_id') {
  if (!item.in_catalog) return 'нет в товарах магазина'
  return item[field]?.trim() || 'не указан'
}

function blockText(reason: PhoneBox['block_reason']) {
  if (reason === 'cancelled') return 'Партия отменена. Изменить короб нельзя.'
  if (reason === 'not_started') return 'Этап ещё не начат. Изменить короб нельзя.'
  return 'Этот короб нельзя изменять.'
}

function isThisBox(box: PhoneBox, code: string) {
  const value = code.trim()
  return [box.barcode, box.wb_barcode, box.wb_external_barcode].some((item) => item != null && item.trim() === value)
}

function parseQty(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const qty = Number(value.trim())
  return Number.isInteger(qty) && qty >= 1 ? qty : null
}

function buzz() {
  try {
    navigator.vibrate?.(30)
  } catch {
    /* нет вибрации */
  }
}

async function openCameraStream() {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
}

export function PhoneBoxCamera({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>('home')
  const [mode, setMode] = useState<Mode>('view')
  const [box, setBox] = useState<PhoneBox | null>(null)
  const [pendingBox, setPendingBox] = useState<PhoneBox | null>(null)
  const [barcode, setBarcode] = useState('')
  const [qty, setQty] = useState('1')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [boot, setBoot] = useState(0)
  const [correctionArmed, setCorrectionArmed] = useState(false)
  const [correctionChanged, setCorrectionChanged] = useState(false)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const exitRef = useRef<(target: ExitTarget) => boolean>(() => true)
  const ignorePop = useRef(false)
  const historyPushed = useRef(false)
  const opening = useRef(false)
  const primed = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pausedRef = useRef(false)
  const onScanRef = useRef<(code: string) => void>(() => {})
  const live = useRef({
    screen,
    barcode,
    box,
    mode,
    heldCode: null as string | null,
    lastCode: '',
    lastAt: 0,
    looking: false,
  })
  live.current.screen = screen
  live.current.barcode = barcode
  live.current.box = box
  live.current.mode = mode

  const cameraOn = screen === 'scan' || screen === 'add' || screen === 'remove'
  const fieldLocksCamera = screen !== 'scan' && barcode.trim().length > 0
  pausedRef.current = looking || busy || dialog !== null || fieldLocksCamera

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.history.pushState({ phoneBoxCamera: 1 }, '')
    historyPushed.current = true
    const onPop = () => {
      historyPushed.current = false
      if (ignorePop.current) {
        ignorePop.current = false
        return
      }
      if (exitRef.current('home')) {
        window.history.pushState({ phoneBoxCamera: 1 }, '')
        historyPushed.current = true
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('popstate', onPop)
      if (historyPushed.current) {
        historyPushed.current = false
        window.history.back()
      }
      primed.current?.getTracks().forEach((track) => track.stop())
      primed.current = null
    }
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let detect = true
    let stream: MediaStream | null = primed.current
    primed.current = null
    let controls: { stop: () => void } | null = null

    const run = async () => {
      try {
        if (!stream) stream = await openCameraStream()
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        setCameraError(null)
        if ('BarcodeDetector' in window) {
          video.srcObject = stream
          await video.play()
          const detector = new (window as unknown as {
            BarcodeDetector: new (options: { formats: string[] }) => {
              detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
            }
          }).BarcodeDetector({ formats: SCAN_FORMATS })
          const scan = async () => {
            if (!detect || cancelled || !videoRef.current) return
            if (pausedRef.current) {
              window.setTimeout(() => { void scan() }, 250)
              return
            }
            try {
              const results = await detector.detect(videoRef.current)
              const value = results[0]?.rawValue?.trim()
              if (value) onScanRef.current(value)
            } catch {
              /* кадр ещё не готов */
            }
            if (detect && !cancelled) requestAnimationFrame(() => { void scan() })
          }
          void scan()
          return
        }
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!result || cancelled || pausedRef.current) return
          const value = result.getText().trim()
          if (value) onScanRef.current(value)
        })
      } catch {
        if (!cancelled) setCameraError('Разрешите доступ к камере, чтобы сканировать код.')
      }
    }

    void run()
    return () => {
      cancelled = true
      detect = false
      controls?.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [cameraOn, boot])

  function popHistory() {
    if (!historyPushed.current) return
    ignorePop.current = true
    historyPushed.current = false
    window.history.back()
  }

  function resetVisit() {
    setBox(null)
    setPendingBox(null)
    setBarcode('')
    setQty('1')
    setDialog(null)
    setDialogError(null)
    setCorrectionArmed(false)
    setCorrectionChanged(false)
    setNotice(null)
    live.current.heldCode = null
  }

  function arrive(target: ExitTarget) {
    resetVisit()
    if (target === 'close') {
      popHistory()
      onCloseRef.current()
      return
    }
    setScreen('home')
  }

  function requestExit(target: ExitTarget) {
    if (dialog) {
      setDialog(null)
      setDialogError(null)
      return true
    }
    if (screen === 'home') {
      onCloseRef.current()
      return false
    }
    if (screen === 'scan') {
      setScreen('home')
      setNotice(null)
      setPendingBox(null)
      live.current.heldCode = null
      return true
    }
    if ((screen === 'add' || screen === 'remove') && barcode.trim()) {
      setDialog({ kind: 'unsaved', target })
      setDialogError(null)
      return true
    }
    if (correctionChanged) {
      setDialog({ kind: 'correction', target })
      setDialogError(null)
      return true
    }
    arrive(target)
    return target !== 'close'
  }
  exitRef.current = requestExit

  async function primeAndOpen(nextScreen: Screen, nextMode?: Mode) {
    if (busy || opening.current) return
    opening.current = true
    setCameraError(null)
    try {
      const stream = await openCameraStream()
      primed.current?.getTracks().forEach((track) => track.stop())
      primed.current = stream
    } catch {
      primed.current = null
      setCameraError('Разрешите доступ к камере, чтобы сканировать код.')
    } finally {
      if (nextMode) setMode(nextMode)
      if (nextScreen === 'add' || nextScreen === 'remove') {
        setBarcode('')
        setQty('1')
        setNotice(null)
      }
      setScreen(nextScreen)
      setBoot((value) => value + 1)
      opening.current = false
    }
  }

  async function findBox(code: string) {
    live.current.looking = true
    setLooking(true)
    setNotice({ tone: 'info', text: 'Ищем короб…' })
    try {
      const result = await lookupPhoneBox(code)
      if (!result.found) {
        setNotice({ tone: 'error', text: 'Короб не найден. Наведите камеру на QR короба.' })
        return
      }
      buzz()
      if (live.current.mode === 'view') {
        setBox(result)
        setNotice(null)
        setScreen('info')
        return
      }
      if (!result.can_write) {
        setNotice({ tone: 'error', text: blockText(result.block_reason) })
        return
      }
      if (result.packing_completed) {
        setPendingBox(result)
        setDialog({ kind: 'start-correction' })
        setDialogError(null)
        setNotice(null)
        return
      }
      setBox(result)
      setCorrectionArmed(false)
      setNotice(null)
      setScreen('branch')
    } catch (error) {
      setNotice({ tone: 'error', text: phoneBoxErrorText(error) })
    } finally {
      live.current.looking = false
      setLooking(false)
    }
  }

  onScanRef.current = (code) => {
    const now = Date.now()
    if (code === live.current.lastCode && now - live.current.lastAt < 1600) return
    live.current.lastCode = code
    live.current.lastAt = now
    if (live.current.looking || pausedRef.current) return
    const current = live.current
    if (current.screen === 'scan') {
      if (code === current.heldCode) return
      current.heldCode = null
      setPendingBox(null)
      void findBox(code)
      return
    }
    if (current.screen !== 'add' && current.screen !== 'remove') return
    if (current.barcode.trim() || !current.box) return
    if (isThisBox(current.box, code)) {
      setNotice({ tone: 'error', text: 'Это QR короба. Сначала закройте короб.' })
      return
    }
    buzz()
    setBarcode(code)
    setNotice(null)
  }

  async function refresh(current: PhoneBox) {
    const code = current.barcode || current.wb_barcode || current.wb_external_barcode
    if (!code) return
    const next = await lookupPhoneBox(code)
    if (next.found) setBox(next)
  }

  async function commitAdd(code: string, amount: number, productName: string | null) {
    if (!box) return
    setBusy(true)
    setDialog(null)
    try {
      await addPhoneBoxItem(box.box_id, code, amount, productName)
      if (correctionArmed) setCorrectionChanged(true)
      setBarcode('')
      setQty('1')
      setNotice({ tone: 'info', text: 'Добавлено' })
      try {
        await refresh(box)
      } catch {
        /* строка уже записана, список обновится при следующем открытии */
      }
    } catch (error) {
      setNotice({ tone: 'error', text: phoneBoxErrorText(error) })
    } finally {
      setBusy(false)
    }
  }

  async function submitAdd() {
    if (!box || busy) return
    const code = barcode.trim()
    if (!code) {
      setNotice({ tone: 'error', text: 'Сканируйте или введите баркод.' })
      return
    }
    if (isThisBox(box, code)) {
      setNotice({ tone: 'error', text: 'Это QR короба. Сначала закройте короб.' })
      return
    }
    const amount = parseQty(qty)
    if (!amount) {
      setNotice({ tone: 'error', text: 'Укажите количество от 1.' })
      return
    }
    if (box.store_id) {
      setBusy(true)
      try {
        const match = await lookupStoreBarcode(box.store_id, code)
        if (!match.found) {
          setNotice({
            tone: 'error',
            text: box.store_name
              ? `Этот баркод не принадлежит магазину «${box.store_name}».`
              : 'Этот баркод не принадлежит магазину этой партии.',
          })
          return
        }
        await commitAdd(code, amount, match.name)
        return
      } catch (error) {
        setNotice({ tone: 'error', text: phoneBoxErrorText(error) })
        return
      } finally {
        setBusy(false)
      }
    }
    await commitAdd(code, amount, null)
  }

  async function commitRemove(code: string, amount: number, removeAll: boolean) {
    if (!box) return
    setBusy(true)
    setDialog(null)
    try {
      await removePhoneBoxItem(box.box_id, code, amount, removeAll)
      if (correctionArmed) setCorrectionChanged(true)
      setBarcode('')
      setQty('1')
      setNotice({ tone: 'info', text: 'Убрано' })
      try {
        await refresh(box)
      } catch {
        /* строка уже записана, список обновится при следующем открытии */
      }
    } catch (error) {
      setNotice({ tone: 'error', text: phoneBoxErrorText(error) })
    } finally {
      setBusy(false)
    }
  }

  async function submitRemove() {
    if (!box || busy) return
    const code = barcode.trim()
    if (!code) {
      setNotice({ tone: 'error', text: 'Сканируйте или введите баркод.' })
      return
    }
    if (isThisBox(box, code)) {
      setNotice({ tone: 'error', text: 'Это QR короба. Сначала закройте короб.' })
      return
    }
    const amount = parseQty(qty)
    if (!amount) {
      setNotice({ tone: 'error', text: 'Укажите количество от 1.' })
      return
    }
    const line = box.items.find((item) => item.barcode.trim() === code)
    if (!line) {
      setNotice({ tone: 'error', text: 'В коробе нет этого баркода.' })
      return
    }
    if (amount > line.qty) {
      setDialog({ kind: 'remove-all', barcode: code, qty: amount, inBox: line.qty })
      setDialogError(null)
      return
    }
    await commitRemove(code, amount, false)
  }

  async function confirmCorrection(target: ExitTarget) {
    if (!box || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      await confirmPhoneBoxCorrection(box.batch_id, box.pipeline_stage_id)
      setBusy(false)
      arrive(target)
    } catch (error) {
      setDialogError(phoneBoxErrorText(error))
      setBusy(false)
    }
  }

  async function retryCamera() {
    try {
      const stream = await openCameraStream()
      primed.current?.getTracks().forEach((track) => track.stop())
      primed.current = stream
      setCameraError(null)
      setBoot((value) => value + 1)
    } catch {
      setCameraError('Разрешите доступ к камере, чтобы сканировать код.')
    }
  }

  const title = screen === 'add'
    ? 'Добавить товар'
    : screen === 'remove'
      ? 'Убрать товар'
      : mode === 'view'
        ? 'Информация о коробе'
        : 'Редактировать короб'
  const matchedLine = box?.items.find((item) => item.barcode.trim() === barcode.trim())

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-50 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-semibold">Камера</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {screen === 'home' ? (
          <div className="flex min-h-full flex-col justify-center gap-3 py-6">
            <p className="text-center text-sm text-slate-500">Сканируйте QR короба</p>
            <button type="button" className="flex h-16 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 transition hover:bg-slate-50" onClick={() => { void primeAndOpen('scan', 'view') }}>
              Посмотреть инфо
            </button>
            <button type="button" className="flex h-16 w-full items-center justify-center rounded-2xl bg-blue-600 px-4 text-base font-semibold text-white transition hover:bg-blue-700" onClick={() => { void primeAndOpen('scan', 'edit') }}>
              Занести инфо
            </button>
          </div>
        ) : null}

        {cameraOn ? (
          <div>
            <div className="relative mx-auto aspect-square w-full max-h-[42vh] max-w-[42vh] overflow-hidden rounded-3xl bg-slate-200">
              <video ref={videoRef} className="h-full w-full object-cover" muted autoPlay playsInline />
              {fieldLocksCamera ? <div className="absolute inset-0 bg-slate-300" /> : null}
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 px-6 text-center">
                  <p className="text-sm leading-6 text-slate-700">{cameraError}</p>
                  {screen !== 'scan' ? <p className="text-sm text-slate-500">Баркод можно ввести вручную.</p> : null}
                  <button type="button" className={primaryButton + ' h-12 max-w-xs'} onClick={() => { void retryCamera() }}>
                    Разрешить камеру
                  </button>
                </div>
              ) : null}
            </div>
            <h2 className="mt-4 text-center text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-center text-sm text-slate-500">
              {screen === 'scan' ? 'QR короба ELESTET или WB' : 'Баркод товара'}
            </p>
          </div>
        ) : null}

        {notice && screen !== 'home' ? (
          <p className={`mt-3 text-center text-sm leading-6 ${notice.tone === 'error' ? 'text-rose-700' : 'text-slate-600'}`} aria-live="polite">
            {notice.text}
          </p>
        ) : null}

        {pendingBox && screen === 'scan' && !dialog ? (
          <button
            type="button"
            className={secondaryButton + ' mt-4'}
            onClick={() => {
              setDialog({ kind: 'start-correction' })
              setDialogError(null)
            }}
          >
            Всё же корректировать этот короб
          </button>
        ) : null}

        {box && (screen === 'info' || screen === 'branch') ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{screen === 'info' ? 'Информация о коробе' : 'Редактировать короб'}</h2>
            <BoxFacts box={box} />
            {screen === 'info' ? <ItemList items={box.items} /> : (
              <div className="grid gap-3 pt-2">
                <button type="button" className={primaryButton} onClick={() => { void primeAndOpen('add') }}>Добавить товар</button>
                <button type="button" className="flex h-14 w-full items-center justify-center rounded-2xl border border-rose-200 bg-white px-4 text-base font-semibold text-rose-700 transition hover:bg-rose-50" onClick={() => { void primeAndOpen('remove') }}>
                  Убрать товар
                </button>
              </div>
            )}
          </div>
        ) : null}

        {box && (screen === 'add' || screen === 'remove') ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Баркод</span>
              <span className="relative block">
                <input
                  value={barcode}
                  onChange={(event) => {
                    setBarcode(event.target.value)
                    setNotice(null)
                  }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Сканируйте или введите"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-4 pr-12 text-base outline-none focus:border-blue-500"
                />
                {barcode ? (
                  <button
                    type="button"
                    aria-label="Очистить баркод"
                    className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-xl text-2xl leading-none text-slate-400"
                    onClick={() => {
                      setBarcode('')
                      setNotice(null)
                      live.current.lastCode = ''
                      live.current.lastAt = 0
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </label>
            {screen === 'remove' && barcode.trim() ? (
              <p className="text-sm text-slate-600">
                {matchedLine ? `В коробе этот баркод: ${matchedLine.qty} шт.` : 'В коробе нет этого баркода.'}
              </p>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Количество</span>
              <input
                value={qty}
                inputMode="numeric"
                onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void (screen === 'add' ? submitAdd() : submitRemove())
                  }
                }}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base outline-none focus:border-blue-500"
              />
            </label>
            <ItemList items={box.items} />
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {screen === 'home' ? (
          <button type="button" className={quietButton} onClick={() => { popHistory(); onCloseRef.current() }}>Закрыть</button>
        ) : null}
        {screen === 'scan' ? (
          <button type="button" className={secondaryButton} onClick={() => requestExit('home')}>Назад</button>
        ) : null}
        {screen === 'info' || screen === 'branch' ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={secondaryButton} onClick={() => requestExit('home')}>Закрыть короб</button>
            <button type="button" className={quietButton} onClick={() => requestExit('close')}>Завершить</button>
          </div>
        ) : null}
        {screen === 'add' || screen === 'remove' ? (
          <div className="space-y-2">
            <button
              type="button"
              className={screen === 'add' ? primaryButton : roseButton}
              disabled={busy}
              onClick={() => { void (screen === 'add' ? submitAdd() : submitRemove()) }}
            >
              {busy ? 'Записываем…' : screen === 'add' ? 'Добавить' : 'Убрать'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => requestExit('home')}>Закрыть короб</button>
              <button type="button" className={quietButton} disabled={busy} onClick={() => requestExit('close')}>Завершить</button>
            </div>
          </div>
        ) : null}
      </footer>

      {dialog ? (
        <div className="fixed inset-0 z-[100] flex items-end bg-slate-950/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="w-full rounded-3xl bg-white p-4 shadow-xl">
            <DialogBody
              dialog={dialog}
              busy={busy}
              error={dialogError}
              onStay={() => {
                setDialog(null)
                setDialogError(null)
              }}
              onLeaveUnsaved={() => {
                const target = dialog.kind === 'unsaved' ? dialog.target : 'home'
                setBarcode('')
                setDialog(null)
                if (correctionChanged) {
                  setDialog({ kind: 'correction', target })
                  return
                }
                arrive(target)
              }}
              onStartCorrection={() => {
                if (!pendingBox) return
                setBox(pendingBox)
                setPendingBox(null)
                live.current.heldCode = null
                setCorrectionArmed(true)
                setDialog(null)
                setNotice(null)
                setScreen('branch')
              }}
              onDeclineCorrection={() => {
                live.current.heldCode = live.current.lastCode || null
                setDialog(null)
                setNotice({ tone: 'info', text: 'Корректировка не начата. Можно сканировать другой короб.' })
              }}
              onRemoveAll={() => {
                if (dialog.kind !== 'remove-all') return
                void commitRemove(dialog.barcode, dialog.inBox, true)
              }}
              onAddUnknown={() => {
                if (dialog.kind !== 'unknown-product') return
                void commitAdd(dialog.barcode, dialog.qty, dialog.name)
              }}
              onConfirm={() => {
                if (dialog.kind !== 'correction') return
                void confirmCorrection(dialog.target)
              }}
            />
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

function BoxFacts({ box }: { box: PhoneBox }) {
  const batch = box.batch_short_id != null ? `P-${box.batch_short_id}` : box.batch_name
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4">
      <p className="text-base font-semibold">{box.supplier || 'ИП не указан'}</p>
      <p className="mt-1 text-sm text-slate-600">{box.store_name || 'Магазин не указан'}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-slate-500">Поставка</dt>
          <dd className="font-medium">{box.supply_number != null ? `S-${box.supply_number}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Партия</dt>
          <dd className="font-medium">{batch}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Короб</dt>
          <dd className="font-medium">{box.box_number || '—'}</dd>
        </div>
      </dl>
    </section>
  )
}

function ItemList({ items }: { items: PhoneBoxItem[] }) {
  if (items.length === 0) {
    return <p className="rounded-3xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">В коробе пока нет товаров.</p>
  }
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {items.map((item) => (
        <article key={item.id || item.barcode} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="break-all font-medium">{item.barcode}</p>
            <p className="shrink-0 text-sm font-semibold">{item.qty} шт</p>
          </div>
          <p className="mt-2 text-sm text-slate-600">Артикул продавца: {articleText(item, 'vendor_code')}</p>
          <p className="mt-1 text-sm text-slate-600">Артикул WB: {articleText(item, 'nm_id')}</p>
        </article>
      ))}
    </div>
  )
}

function DialogBody({
  dialog,
  busy,
  error,
  onStay,
  onLeaveUnsaved,
  onStartCorrection,
  onDeclineCorrection,
  onRemoveAll,
  onAddUnknown,
  onConfirm,
}: {
  dialog: Dialog
  busy: boolean
  error: string | null
  onStay: () => void
  onLeaveUnsaved: () => void
  onStartCorrection: () => void
  onDeclineCorrection: () => void
  onRemoveAll: () => void
  onAddUnknown: () => void
  onConfirm: () => void
}) {
  const copy = dialog.kind === 'start-correction'
    ? { title: 'Этап коробов уже завершён', text: 'Начать корректировку?' }
    : dialog.kind === 'unsaved'
      ? { title: 'Баркод не записан', text: 'Баркод введён, но не записан. Если выйти, эти данные пропадут.' }
      : dialog.kind === 'correction'
        ? { title: 'Корректировка', text: 'Подтвердить корректировку этапа коробов?' }
        : dialog.kind === 'remove-all'
          ? { title: 'Удалить баркод', text: `В коробе этот баркод: ${dialog.inBox} шт. Удалить всё?` }
          : { title: 'Нет в товарах магазина', text: 'Этого баркода нет в товарах магазина. Всё равно добавить?' }

  return (
    <>
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{copy.text}</p>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      <div className="mt-4 flex flex-col gap-2">
        {dialog.kind === 'start-correction' ? (
          <>
            <button type="button" className={primaryButton} onClick={onStartCorrection}>Начать</button>
            <button type="button" className={secondaryButton} onClick={onDeclineCorrection}>Нет</button>
          </>
        ) : null}
        {dialog.kind === 'unsaved' ? (
          <>
            <button type="button" className={roseButton} onClick={onLeaveUnsaved}>Выйти</button>
            <button type="button" className={secondaryButton} onClick={onStay}>Остаться</button>
          </>
        ) : null}
        {dialog.kind === 'correction' ? (
          <>
            <button type="button" className={primaryButton} disabled={busy} onClick={onConfirm}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={onStay}>Остаться</button>
          </>
        ) : null}
        {dialog.kind === 'remove-all' ? (
          <>
            <button type="button" className={roseButton} disabled={busy} onClick={onRemoveAll}>{busy ? 'Удаляем…' : 'Удалить всё'}</button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={onStay}>Отмена</button>
          </>
        ) : null}
        {dialog.kind === 'unknown-product' ? (
          <>
            <button type="button" className={primaryButton} disabled={busy} onClick={onAddUnknown}>{busy ? 'Добавляем…' : 'Добавить'}</button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={onStay}>Нет</button>
          </>
        ) : null}
      </div>
    </>
  )
}
