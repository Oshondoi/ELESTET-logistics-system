import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

interface InvoicePhotoCellProps {
  photoUrls: string[]
  onAdd?: (file: File) => Promise<void>
  onReplace?: (index: number, file: File) => Promise<void>
  onRemove?: (index: number) => Promise<void>
}

export const InvoicePhotoCell = ({ photoUrls, onAdd, onReplace, onRemove }: InvoicePhotoCellProps) => {
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null)

  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  // Закрываем меню по клику вне
  useEffect(() => {
    if (!menuOpen) return
    const handler = () => setMenuOpen(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // Блокируем скролл фона + клавиши при открытом лайтбоксе
  useEffect(() => {
    if (!lightboxOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setLightboxIndex((i) => (i + 1) % photoUrls.length)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setLightboxIndex((i) => (i - 1 + photoUrls.length) % photoUrls.length)
      } else if (e.key === 'Escape') {
        setLightboxOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [lightboxOpen, photoUrls.length])

  useLayoutEffect(() => {
    if (menuOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [menuOpen])

  const withLoading = async (fn: () => Promise<void>) => {
    setIsLoading(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
    finally { setIsLoading(false) }
  }

  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !onAdd) return
    await withLoading(() => onAdd(file))
    e.target.value = ''
  }

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || replaceTargetIndex === null || !onReplace || !onRemove) return
    const idx = replaceTargetIndex
    e.target.value = ''
    setReplaceTargetIndex(null)
    if (idx === -1) {
      // Заменить все: заменяем первое, удаляем остальные
      await withLoading(async () => {
        await onReplace(0, file)
        for (let i = photoUrls.length - 1; i >= 1; i--) {
          await onRemove(1)
        }
      })
    } else {
      await withLoading(() => onReplace(idx, file))
    }
  }

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen((v) => !v)
  }

  const triggerReplace = (index: number) => {
    setMenuOpen(false)
    setLightboxOpen(false)
    setReplaceTargetIndex(index)
    setTimeout(() => replaceInputRef.current?.click(), 50)
  }

  const triggerReplaceAll = () => {
    setMenuOpen(false)
    setLightboxOpen(false)
    setReplaceTargetIndex(-1)
    setTimeout(() => replaceInputRef.current?.click(), 50)
  }

  const triggerRemove = (index: number) => {
    setMenuOpen(false)
    setConfirmDeleteIndex(index)
  }

  const confirmRemove = async () => {
    if (confirmDeleteIndex === null || !onRemove) return
    const idx = confirmDeleteIndex
    setConfirmDeleteIndex(null)
    setLightboxOpen(false)
    if (idx === -1) {
      // Удалить все фото
      await withLoading(async () => {
        for (let i = photoUrls.length - 1; i >= 0; i--) {
          await onRemove(0)
        }
      })
    } else {
      await withLoading(() => onRemove(idx))
    }
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  const hasPhotos = photoUrls.length > 0
  const extra = photoUrls.length - 1

  // ── Context menu portal ────────────────────────────────────────
  const menu = menuOpen
    ? createPortal(
        <div
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-w-[140px] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-xl"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => { setMenuOpen(false); addInputRef.current?.click() }}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Добавить
          </button>
          {hasPhotos && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                onClick={triggerReplaceAll}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Заменить все
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmDeleteIndex(-1)
                }}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 4h6M5 7h14M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                </svg>
                Удалить все
              </button>
            </>
          )}
        </div>,
        document.body,
      )
    : null

  // ── Lightbox portal ────────────────────────────────────────────
  const lightbox = lightboxOpen && photoUrls.length > 0
    ? createPortal(
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
          onWheel={(e) => e.preventDefault()}
          onTouchMove={(e) => e.preventDefault()}
        >
          <div
            className="relative flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Фото */}
            <img
              src={photoUrls[lightboxIndex]}
              alt="Накладная"
              className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
            />

            {/* Счётчик */}
            {photoUrls.length > 1 && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-sm text-white/70">
                {lightboxIndex + 1} / {photoUrls.length}
              </div>
            )}

            {/* Стрелка влево (круговая) */}
            {photoUrls.length > 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => (i - 1 + photoUrls.length) % photoUrls.length)}
                className="absolute left-0 top-1/2 -translate-x-12 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}

            {/* Стрелка вправо (круговая) */}
            {photoUrls.length > 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => (i + 1) % photoUrls.length)}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )}

            {/* Закрыть */}
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-lg transition hover:text-slate-900"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            {/* Панель снизу */}
            <div className="mt-3 flex items-center gap-2">
              {onRemove && (
              <button
                type="button"
                onClick={() => triggerRemove(lightboxIndex)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-rose-500"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 4h6M5 7h14M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                </svg>
                Удалить
              </button>
              )}
              {onReplace && (
              <button
                type="button"
                onClick={() => triggerReplace(lightboxIndex)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/25"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Заменить
              </button>
              )}
              {onAdd && (
              <button
                type="button"
                onClick={() => { setLightboxOpen(false); addInputRef.current?.click() }}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/25"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Добавить
              </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  // ── Диалог подтверждения удаления ─────────────────────────────
  const confirmDialog = confirmDeleteIndex !== null
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setConfirmDeleteIndex(null)}
        >
          <div className="w-72 rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-sm text-slate-700">
              {confirmDeleteIndex === -1
                ? `Удалить все фото накладной (${photoUrls.length} шт.)?`
                : 'Удалить это фото накладной?'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteIndex(null)}
                className="rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void confirmRemove()}
                className="rounded-xl bg-rose-500 px-4 py-2 text-sm text-white transition hover:bg-rose-600"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div className="group/photo relative flex items-center gap-1">
        {hasPhotos ? (
          <>
            {/* Миниатюра первого фото */}
            <div className="relative">
              <button
                type="button"
                title="Открыть накладную"
                onClick={() => openLightbox(0)}
                className="flex h-7 w-7 overflow-hidden rounded-md border border-slate-200 transition hover:border-blue-400 hover:shadow-sm"
              >
                <img src={photoUrls[0]} alt="Накладная" className="h-full w-full object-cover" />
              </button>
              {/* Счётчик если больше одного */}
            </div>

            {/* Кнопка контекстного меню + счётчик */}
            <div className="flex items-center gap-0.5">
              {extra > 0 && (
                <span className="text-[11px] font-medium text-slate-400">+{extra}</span>
              )}
              {onAdd && (
              <button
                ref={menuBtnRef}
                type="button"
                title="Управление фото"
                disabled={isLoading}
                onClick={openMenu}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-slate-300 opacity-0 transition group-hover/photo:opacity-100 hover:text-slate-600',
                  isLoading && 'animate-pulse opacity-100',
                  menuOpen && 'opacity-100 text-slate-600',
                )}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" fill="currentColor" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" />
                  <circle cx="12" cy="19" r="1" fill="currentColor" />
                </svg>
              </button>
              )}
            </div>
          </>
        ) : onAdd ? (
          // Нет фото — кнопка добавить
          <button
            ref={menuBtnRef}
            type="button"
            title="Прикрепить накладную"
            disabled={isLoading}
            onClick={() => { setError(null); addInputRef.current?.click() }}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md text-slate-300 transition hover:text-slate-500',
              isLoading && 'animate-pulse',
            )}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        ) : null}

        {error && (
          <div className="absolute left-full top-0 z-10 ml-2 max-w-[180px] rounded-lg bg-rose-50 px-2 py-1 text-[11px] text-rose-600 shadow">
            {error}
          </div>
        )}
      </div>

      <input ref={addInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleAddFile(e)} />
      <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleReplaceFile(e)} />

      {menu}
      {lightbox}
      {confirmDialog}
    </>
  )
}
