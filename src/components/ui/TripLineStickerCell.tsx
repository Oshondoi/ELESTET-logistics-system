import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from './Toast'

interface TripLineStickerCellProps {
  fileUrls: string[]
  combinedUrls?: string[]
  wbSupplyId?: string | null
  passUrls?: string[]
  onAdd?: (file: File) => Promise<void>
  onRemove?: (index: number) => Promise<void>
  onAddCombined?: (file: File) => Promise<void>
  onRemoveCombined?: (index: number) => Promise<void>
  onFetchWbBarcodes?: (wbSupplyId: string) => Promise<void>
  onUploadPass?: (file: File) => Promise<void>
  onRemovePass?: (index: number) => Promise<void>
  onDownloadWbExcel?: (type: 'goods' | 'boxes' | 'all') => Promise<void>
}

export const TripLineStickerCell = ({ fileUrls, combinedUrls = [], wbSupplyId, passUrls = [], onAdd, onRemove, onAddCombined, onRemoveCombined, onFetchWbBarcodes, onUploadPass, onRemovePass, onDownloadWbExcel }: TripLineStickerCellProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isCombinedLoading, setIsCombinedLoading] = useState(false)
  const [isWbLoading, setIsWbLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [combinedMenuOpen, setCombinedMenuOpen] = useState(false)
  const [combinedMenuPos, setCombinedMenuPos] = useState({ top: 0, left: 0 })
  const [combinedMenuSnapshot, setCombinedMenuSnapshot] = useState<string[]>([])
  const [deletedCombinedUrls, setDeletedCombinedUrls] = useState<Set<string>>(new Set())
  const [passMenuOpen, setPassMenuOpen] = useState(false)
  const [passMenuPos, setPassMenuPos] = useState({ top: 0, left: 0 })
  const [isPassLoading, setIsPassLoading] = useState(false)
  const [excelMenuOpen, setExcelMenuOpen] = useState(false)
  const [excelMenuPos, setExcelMenuPos] = useState({ top: 0, left: 0 })
  const [isExcelLoading, setIsExcelLoading] = useState(false)
  const [menuSnapshot, setMenuSnapshot] = useState<string[]>([])
  const [deletedUrls, setDeletedUrls] = useState<Set<string>>(new Set())
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const combinedBtnRef = useRef<HTMLButtonElement>(null)
  const combinedUploadBtnRef = useRef<HTMLButtonElement>(null)
  const combinedMenuRef = useRef<HTMLDivElement>(null)
  const wbBtnRef = useRef<HTMLButtonElement>(null)
  const passBtnRef = useRef<HTMLButtonElement>(null)
  const excelBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const passMenuRef = useRef<HTMLDivElement>(null)
  const excelMenuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const combinedInputRef = useRef<HTMLInputElement>(null)
  const passInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuBtnRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => {
    if (!combinedMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (combinedBtnRef.current?.contains(e.target as Node)) return
      setCombinedMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [combinedMenuOpen])

  useEffect(() => {
    if (!passMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (passBtnRef.current?.contains(e.target as Node)) return
      setPassMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [passMenuOpen])

  useEffect(() => {
    if (!excelMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (excelBtnRef.current?.contains(e.target as Node)) return
      setExcelMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [excelMenuOpen])

  useLayoutEffect(() => {
    if (!menuOpen || !menuBtnRef.current || !menuRef.current) return
    const btn = menuBtnRef.current.getBoundingClientRect()
    const { width: menuW, height: menuH } = menuRef.current.getBoundingClientRect()
    const pad = 8
    let top = btn.bottom + 4
    let left = btn.left
    if (left + menuW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - menuW - pad)
    if (top + menuH > window.innerHeight - pad) {
      const above = btn.top - menuH - 4
      top = above >= pad ? above : Math.max(pad, window.innerHeight - menuH - pad)
    }
    setMenuPos({ top, left })
  }, [menuOpen, menuSnapshot])

  useLayoutEffect(() => {
    if (!passMenuOpen || !passBtnRef.current || !passMenuRef.current) return
    const btn = passBtnRef.current.getBoundingClientRect()
    const { width: menuW, height: menuH } = passMenuRef.current.getBoundingClientRect()
    const pad = 8
    let top = btn.bottom + 4
    let left = btn.left
    if (left + menuW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - menuW - pad)
    if (top + menuH > window.innerHeight - pad) {
      const above = btn.top - menuH - 4
      top = above >= pad ? above : Math.max(pad, window.innerHeight - menuH - pad)
    }
    setPassMenuPos({ top, left })
  }, [passMenuOpen])

  useLayoutEffect(() => {
    if (!excelMenuOpen || !excelBtnRef.current || !excelMenuRef.current) return
    const btn = excelBtnRef.current.getBoundingClientRect()
    const { width: menuW, height: menuH } = excelMenuRef.current.getBoundingClientRect()
    const pad = 8
    let top = btn.bottom + 4
    let left = btn.left
    if (left + menuW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - menuW - pad)
    if (top + menuH > window.innerHeight - pad) {
      const above = btn.top - menuH - 4
      top = above >= pad ? above : Math.max(pad, window.innerHeight - menuH - pad)
    }
    setExcelMenuPos({ top, left })
  }, [excelMenuOpen])

  useLayoutEffect(() => {
    if (!combinedMenuOpen || !combinedBtnRef.current || !combinedMenuRef.current) return
    const btn = combinedBtnRef.current.getBoundingClientRect()
    const { width: menuW, height: menuH } = combinedMenuRef.current.getBoundingClientRect()
    const pad = 8
    let top = btn.bottom + 4
    let left = btn.left
    if (left + menuW > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - menuW - pad)
    if (top + menuH > window.innerHeight - pad) {
      const above = btn.top - menuH - 4
      top = above >= pad ? above : Math.max(pad, window.innerHeight - menuH - pad)
    }
    setCombinedMenuPos({ top, left })
  }, [combinedMenuOpen, combinedMenuSnapshot])

  const withLoading = async (fn: () => Promise<void>) => {
    setIsLoading(true)
    try { await fn() } catch {}
    finally { setIsLoading(false) }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onAdd) return
    await withLoading(() => onAdd(file))
    e.target.value = ''
  }

  const handleCombinedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onAddCombined) return
    setIsCombinedLoading(true)
    try {
      await onAddCombined(file)
      showToast('Стикер 2в1 загружен', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setIsCombinedLoading(false)
    }
    e.target.value = ''
  }

  const handlePassFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onUploadPass) return
    setIsPassLoading(true)
    try {
      await onUploadPass(file)
      showToast('Пропуск загружен', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ошибка загрузки пропуска')
    } finally {
      setIsPassLoading(false)
    }
    e.target.value = ''
  }

  const hasFiles = fileUrls.length > 0

  const menu = menuOpen
    ? createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-w-[160px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
        >
          {menuSnapshot.map((url, i) => {
            const ts = url.match(/\/([0-9]{10,13})_/)?.[1]
            const dateStr = ts ? (() => {
              const ms = ts.length === 10 ? Number(ts) * 1000 : Number(ts)
              const d = new Date(ms)
              const pad = (n: number) => String(n).padStart(2, '0')
              const offset = -d.getTimezoneOffset()
              const sign = offset >= 0 ? '+' : '-'
              const h = Math.floor(Math.abs(offset) / 60)
              return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} GMT${sign}${h}`
            })() : null
            return (
              <div key={i} className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 ${deletedUrls.has(url) ? 'invisible' : ''}`}>
                <div className="flex min-w-0 flex-col">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs font-medium text-blue-600 hover:underline"
                  >
                    Стикер {i + 1}
                  </a>
                  {dateStr && (
                    <span className="text-[10px] text-slate-400">{dateStr}</span>
                  )}
                </div>
                {onRemove && (
                  <button
                    type="button"
                    title="Удалить"
                    onClick={() => {
                      const currentIndex = fileUrls.indexOf(url)
                      if (currentIndex === -1) return
                      setDeletedUrls((prev) => new Set(prev).add(url))
                      void withLoading(() => onRemove(currentIndex))
                    }}
                    className="flex-shrink-0 text-slate-300 transition hover:text-rose-500"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>,
        document.body,
      )
    : null

  const handleCreateWb = async () => {
    if (!onFetchWbBarcodes || !wbSupplyId) return
    setIsWbLoading(true)
    try {
      await onFetchWbBarcodes(wbSupplyId)
      showToast('Штрихкоды WB загружены в стикеры поставки', 'success')
    }
    catch (e) { showToast(e instanceof Error ? e.message : 'Ошибка WB') }
    finally { setIsWbLoading(false) }
  }

  const combinedMenu = combinedMenuOpen
    ? createPortal(
        <div
          ref={combinedMenuRef}
          style={{ position: 'fixed', top: combinedMenuPos.top, left: combinedMenuPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-w-[160px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
        >
          {combinedMenuSnapshot.map((url, i) => {
            const ts = url.match(/\/([0-9]{10,13})_/)?.[1]
            const dateStr = ts ? (() => {
              const ms = ts.length === 10 ? Number(ts) * 1000 : Number(ts)
              const d = new Date(ms)
              const pad = (n: number) => String(n).padStart(2, '0')
              const offset = -d.getTimezoneOffset()
              const sign = offset >= 0 ? '+' : '-'
              const h = Math.floor(Math.abs(offset) / 60)
              return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} GMT${sign}${h}`
            })() : null
            return (
              <div key={i} className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 ${deletedCombinedUrls.has(url) ? 'invisible' : ''}`}>
                <div className="flex min-w-0 flex-col">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs font-medium text-violet-600 hover:underline"
                  >
                    Стикер 2в1 {i + 1}
                  </a>
                  {dateStr && (
                    <span className="text-[10px] text-slate-400">{dateStr}</span>
                  )}
                </div>
                {onRemoveCombined && (
                  <button
                    type="button"
                    title="Удалить"
                    onClick={() => {
                      const currentIndex = combinedUrls.indexOf(url)
                      if (currentIndex === -1) return
                      setDeletedCombinedUrls((prev) => new Set(prev).add(url))
                      void (async () => { try { await onRemoveCombined(currentIndex) } catch {} })()
                    }}
                    className="flex-shrink-0 text-slate-300 transition hover:text-rose-500"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="flex items-center gap-1">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
        className="hidden"
        onChange={handleFile}
      />

      {/* Hidden pass file input */}
      {onUploadPass && (
        <input
          ref={passInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handlePassFile}
        />
      )}

      {/* Hidden combined sticker input */}
      {onAddCombined && (
        <input
          ref={combinedInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
          className="hidden"
          onChange={handleCombinedFile}
        />
      )}

      {/* Группа: стикеры 2в1 (просмотр + загрузка) */}
      {(onAddCombined || combinedUrls.length > 0) && (
        <div className="flex items-center">
          {/* Просмотр стикеров 2в1 */}
          <button
            ref={combinedBtnRef}
            type="button"
            disabled={combinedUrls.length === 0}
            title={combinedUrls.length > 0 ? `Стикеры 2в1 (${combinedUrls.length})` : 'Стикеры 2в1 не загружены'}
            onClick={(e) => {
              if (combinedUrls.length === 0) return
              e.stopPropagation()
              if (!combinedMenuOpen) {
                setCombinedMenuPos({ top: -9999, left: -9999 })
                setCombinedMenuSnapshot(combinedUrls)
                setDeletedCombinedUrls(new Set())
                setCombinedMenuOpen(true)
              } else {
                setCombinedMenuOpen(false)
              }
            }}
            className={`relative flex h-7 items-center justify-center px-1.5 transition rounded-l-lg ${
              combinedUrls.length > 0
                ? 'bg-violet-50 text-violet-500 hover:bg-violet-100'
                : 'cursor-default bg-violet-50 text-violet-200'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {combinedUrls.length > 0 && (
              <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[9px] font-bold text-white leading-none">
                {combinedUrls.length}
              </span>
            )}
          </button>
          {/* Загрузка стикера 2в1 */}
          {onAddCombined && (
            <button
              ref={combinedUploadBtnRef}
              type="button"
              title="Загрузить стикер 2в1"
              disabled={isCombinedLoading}
              onClick={() => combinedInputRef.current?.click()}
              className="flex h-7 items-center justify-center border-l border-violet-100 bg-violet-50 px-1.5 text-violet-400 transition rounded-r-lg hover:bg-violet-100 hover:text-violet-500 disabled:opacity-40"
            >
              {isCombinedLoading ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}
      {combinedMenu}

      {/* Группа: скачать стикеры + QR штрихкоды */}
      <div className="flex items-center">
        {/* Скачать стикеры */}
        <button
          ref={menuBtnRef}
          type="button"
          disabled={!hasFiles}
          title={!hasFiles ? 'Стикеры не загружены' : `Стикеры (${fileUrls.length})`}
          onClick={(e) => {
            if (!hasFiles) return
            e.stopPropagation()
            if (!menuOpen) {
              setMenuPos({ top: -9999, left: -9999 })
              setMenuSnapshot(fileUrls)
              setDeletedUrls(new Set())
              setMenuOpen(true)
            } else {
              setMenuOpen(false)
            }
          }}
          className={`relative flex h-7 items-center justify-center px-1.5 transition ${
            onFetchWbBarcodes ? 'rounded-l-lg' : 'rounded-lg'
          } ${
            hasFiles
              ? 'bg-blue-50 text-blue-500 hover:bg-blue-100'
              : 'cursor-default text-slate-200'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {hasFiles && (
            <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white leading-none">
              {fileUrls.length}
            </span>
          )}
        </button>

        {/* QR штрихкоды WB */}
        {onFetchWbBarcodes && (
          <button
            ref={wbBtnRef}
            type="button"
            title={wbSupplyId ? `Скачать штрихкоды WB (ID: ${wbSupplyId})` : 'Укажите ID поставки WB в колонке «Поставка», затем скачайте'}
            disabled={isWbLoading || !wbSupplyId}
            onClick={handleCreateWb}
            className={`relative flex h-7 items-center justify-center border-l px-1.5 transition rounded-r-lg disabled:opacity-30 ${
              wbSupplyId
                ? 'border-blue-100 bg-blue-50 text-blue-500 hover:bg-blue-100'
                : 'border-slate-200 cursor-default text-slate-300'
            }`}
          >
            {isWbLoading ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                <path d="M14 17h3m0 0h3m-3 0v-3m0 3v3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {menu}
      {/* Pass button */}
      {onUploadPass && (
        <div className="flex items-center">
          {/* Left part: open menu if has passes, else disabled */}
          <button
            ref={passBtnRef}
            type="button"
            disabled={passUrls.length === 0}
            title={passUrls.length > 0 ? `Пропуски (${passUrls.length})` : 'Пропуск не загружен'}
            onClick={(e) => {
              if (passUrls.length === 0) return
              e.stopPropagation()
              if (!passMenuOpen) {
                setPassMenuPos({ top: -9999, left: -9999 })
                setPassMenuOpen(true)
              } else {
                setPassMenuOpen(false)
              }
            }}
            className={`relative flex h-7 items-center gap-1 rounded-l-lg px-1.5 text-xs font-semibold transition ${
              passUrls.length > 0
                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'bg-slate-50 text-slate-300 cursor-default'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {passUrls.length > 0 && (
              <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white leading-none">
                {passUrls.length}
              </span>
            )}
          </button>
          {/* Right part: upload — always active */}
          <button
            type="button"
            title="Загрузить пропуск"
            disabled={isPassLoading}
            onClick={() => passInputRef.current?.click()}
            className={`flex h-7 items-center justify-center border-l px-1 transition rounded-r-lg disabled:opacity-40 ${
              passUrls.length > 0
                ? 'border-emerald-100 bg-emerald-50 text-emerald-400 hover:bg-emerald-100 hover:text-emerald-600'
                : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
            }`}
          >
            {isPassLoading ? (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
          </button>
          {/* Pass dropdown menu */}
          {passMenuOpen && createPortal(
            <div
              ref={passMenuRef}
              style={{ position: 'fixed', top: passMenuPos.top, left: passMenuPos.left, zIndex: 9999 }}
              onMouseDown={(e) => e.stopPropagation()}
              className="min-w-[160px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
            >
              {passUrls.map((url, i) => {
                const ts = url.match(/\/([0-9]{10,13})_/)?.[1]
                const dateStr = ts ? (() => {
                  const ms = ts.length === 10 ? Number(ts) * 1000 : Number(ts)
                  const d = new Date(ms)
                  const pad = (n: number) => String(n).padStart(2, '0')
                  const offset = -d.getTimezoneOffset()
                  const sign = offset >= 0 ? '+' : '-'
                  const h = Math.floor(Math.abs(offset) / 60)
                  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} GMT${sign}${h}`
                })() : null
                return (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                    <div className="flex min-w-0 flex-col">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs font-medium text-emerald-600 hover:underline"
                        onClick={() => setPassMenuOpen(false)}
                      >
                        Пропуск {i + 1}
                      </a>
                      {dateStr && (
                        <span className="text-[10px] text-slate-400">{dateStr}</span>
                      )}
                    </div>
                    {onRemovePass && (
                      <button
                        type="button"
                        title="Удалить"
                        onClick={() => { setPassMenuOpen(false); void onRemovePass(i) }}
                        className="flex-shrink-0 text-slate-300 transition hover:text-rose-500"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>,
            document.body,
          )}
        </div>
      )}

      {/* Группа: скачать Excel-шаблоны WB (товары + короба) */}
      {onDownloadWbExcel && (
        <div className="flex items-center">
          <button
            ref={excelBtnRef}
            type="button"
            title="Скачать шаблоны WB"
            disabled={isExcelLoading}
            onClick={(e) => {
              e.stopPropagation()
              if (!excelMenuOpen) {
                setExcelMenuPos({ top: -9999, left: -9999 })
                setExcelMenuOpen(true)
              } else {
                setExcelMenuOpen(false)
              }
            }}
            className="flex h-7 items-center justify-center rounded-lg px-1.5 transition bg-green-50 text-green-500 hover:bg-green-100 disabled:opacity-40"
          >
            {isExcelLoading ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            )}
          </button>
          {excelMenuOpen && createPortal(
            <div
              ref={excelMenuRef}
              style={{ position: 'fixed', top: excelMenuPos.top, left: excelMenuPos.left, zIndex: 9999 }}
              onMouseDown={(e) => e.stopPropagation()}
              className="min-w-[170px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
            >
              <button
                type="button"
                onClick={() => {
                  setExcelMenuOpen(false)
                  setIsExcelLoading(true)
                  void onDownloadWbExcel('goods')
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка скачивания'))
                    .finally(() => setIsExcelLoading(false))
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-green-50"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-green-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Скачать товары
              </button>
              <button
                type="button"
                disabled={!wbSupplyId}
                title={!wbSupplyId ? 'Укажите ID поставки WB для скачивания коробов' : undefined}
                onClick={() => {
                  setExcelMenuOpen(false)
                  setIsExcelLoading(true)
                  void onDownloadWbExcel('boxes')
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка скачивания'))
                    .finally(() => setIsExcelLoading(false))
                }}
                className="flex w-full items-center gap-2.5 border-t border-slate-50 px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-green-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Скачать короба
              </button>
              <button
                type="button"
                disabled={!wbSupplyId}
                title={!wbSupplyId ? 'Укажите ID поставки WB для скачивания коробов' : undefined}
                onClick={() => {
                  setExcelMenuOpen(false)
                  setIsExcelLoading(true)
                  void onDownloadWbExcel('all')
                    .catch((e) => showToast(e instanceof Error ? e.message : 'Ошибка скачивания'))
                    .finally(() => setIsExcelLoading(false))
                }}
                className="flex w-full items-center gap-2.5 border-t border-slate-50 px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-green-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Скачать всё
              </button>
            </div>,
            document.body,
          )}
        </div>
      )}
    </div>
  )
}
