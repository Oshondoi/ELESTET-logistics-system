import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { showToast } from './Toast'

interface TripLineStickerCellProps {
  fileUrls: string[]
  wbSupplyId?: string | null
  onAdd?: (file: File) => Promise<void>
  onRemove?: (index: number) => Promise<void>
  onFetchWbBarcodes?: (wbSupplyId: string) => Promise<void>
}

export const TripLineStickerCell = ({ fileUrls, wbSupplyId, onAdd, onRemove, onFetchWbBarcodes }: TripLineStickerCellProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isWbLoading, setIsWbLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [showWbInput, setShowWbInput] = useState(false)
  const [wbInputValue, setWbInputValue] = useState('')
  const [wbInputPos, setWbInputPos] = useState({ top: 0, left: 0 })
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const wbBtnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = () => setMenuOpen(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => {
    if (!showWbInput) return
    const handler = () => setShowWbInput(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showWbInput])

  useLayoutEffect(() => {
    if (menuOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    if (showWbInput && wbBtnRef.current) {
      const rect = wbBtnRef.current.getBoundingClientRect()
      setWbInputPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 240) })
    }
  }, [showWbInput])

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

  const hasFiles = fileUrls.length > 0

  const menu = menuOpen
    ? createPortal(
        <div
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-w-[160px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
        >
          {fileUrls.map((url, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="truncate max-w-[110px] text-xs text-blue-600 hover:underline"
                onClick={() => setMenuOpen(false)}
              >
                Стикер {i + 1}
              </a>
              {onRemove && (
                <button
                  type="button"
                  title="Удалить"
                  onClick={() => { setMenuOpen(false); void withLoading(() => onRemove(i)) }}
                  className="flex-shrink-0 text-slate-300 transition hover:text-rose-500"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null

  const handleCreateWb = async () => {
    if (!onFetchWbBarcodes || !wbBtnRef.current) return
    const rect = wbBtnRef.current.getBoundingClientRect()
    setWbInputPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 240) })
    setWbInputValue(wbSupplyId ?? '')
    setShowWbInput(true)
  }

  const handleWbSubmit = async () => {
    const id = wbInputValue.trim()
    if (!id || !onFetchWbBarcodes) return
    setShowWbInput(false)
    setIsWbLoading(true)
    try { await onFetchWbBarcodes(id) }
    catch (e) { showToast(e instanceof Error ? e.message : 'Ошибка WB') }
    finally { setIsWbLoading(false) }
  }

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

      {/* Upload button */}
      {onAdd && (
        <button
          type="button"
          title="Загрузить стикер"
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-blue-50 hover:text-blue-500 disabled:opacity-40"
        >
          {isLoading ? (
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

      {/* Download button — always visible, disabled when no files */}
      <button
        ref={menuBtnRef}
        type="button"
        disabled={!hasFiles}
        title={!hasFiles ? 'Стикеры не загружены' : fileUrls.length === 1 ? 'Открыть стикер' : `Стикеры (${fileUrls.length})`}
        onClick={(e) => {
          if (!hasFiles) return
          e.stopPropagation()
          if (fileUrls.length === 1) {
            window.open(fileUrls[0], '_blank')
          } else {
            setMenuOpen((v) => !v)
          }
        }}
        className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition ${
          hasFiles
            ? 'text-blue-500 hover:bg-blue-50'
            : 'cursor-default text-slate-200'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {fileUrls.length > 1 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white leading-none">
            {fileUrls.length}
          </span>
        )}
      </button>

      {/* WB button */}
      {onFetchWbBarcodes && (
        <button
          ref={wbBtnRef}
          type="button"
          title={wbSupplyId ? `Скачать штрихкоды (WB ID: ${wbSupplyId})` : 'Указать ID поставки WB и скачать штрихкоды'}
          disabled={isWbLoading}
          onClick={handleCreateWb}
          className={`relative flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold transition disabled:opacity-40 ${
            wbSupplyId
              ? 'bg-purple-50 text-purple-600 hover:bg-purple-100'
              : 'bg-slate-50 text-slate-400 hover:bg-purple-50 hover:text-purple-500'
          }`}
        >
          {isWbLoading ? (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              <path d="M14 17h3m0 0h3m-3 0v-3m0 3v3" />
            </svg>
          )}
          WB
        </button>
      )}
      {menu}
      {showWbInput && createPortal(
        <div
          style={{ position: 'fixed', top: wbInputPos.top, left: wbInputPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex w-56 flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-xl"
        >
          <div className="text-xs font-medium text-slate-600">ID поставки WB</div>
          <input
            autoFocus
            value={wbInputValue}
            onChange={(e) => setWbInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleWbSubmit(); if (e.key === 'Escape') setShowWbInput(false) }}
            placeholder="Например: 26598368"
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!wbInputValue.trim()}
              onClick={() => void handleWbSubmit()}
              className="flex-1 rounded-lg bg-purple-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-600 disabled:opacity-40"
            >
              Скачать штрихкоды
            </button>
            <button
              type="button"
              onClick={() => setShowWbInput(false)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50"
            >
              Отмена
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
