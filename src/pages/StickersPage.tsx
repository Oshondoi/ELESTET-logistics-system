import { useState } from 'react'
import type { StickerFormValues, StickerTemplate, StickerBundle, StickerBundleItem } from '../types'
import { StickerFormModal } from '../components/stickers/StickerFormModal'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { downloadStickerPdf, previewStickerPdf } from '../lib/stickerPdf'

interface StickersPageProps {
  stickers: StickerTemplate[]
  bundles: StickerBundle[]
  onAdd: (values: StickerFormValues) => Promise<unknown>
  onEdit: (id: string, values: StickerFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onAddBundle: (name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onEditBundle: (id: string, name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onDeleteBundle: (id: string) => Promise<void>
}

export const StickersPage = ({ stickers, bundles, onAdd, onEdit, onDelete, onAddBundle, onEditBundle, onDeleteBundle }: StickersPageProps) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSticker, setEditingSticker] = useState<StickerTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StickerTemplate | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPrinting, setIsPrinting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)

  // Набор — сохранение
  const [bundleModalOpen, setBundleModalOpen] = useState(false)
  const [editingBundle, setEditingBundle] = useState<StickerBundle | null>(null)
  const [bundleName, setBundleName] = useState('')
  const [bundleItems, setBundleItems] = useState<Record<string, { checked: boolean; copies: number }>>({})
  const [isSavingBundle, setIsSavingBundle] = useState(false)
  const [bundleSaveError, setBundleSaveError] = useState<string | null>(null)
  // Набор — удаление
  const [deleteBundleTarget, setDeleteBundleTarget] = useState<StickerBundle | null>(null)
  const [isDeletingBundle, setIsDeletingBundle] = useState(false)
  const [deleteBundleError, setDeleteBundleError] = useState<string | null>(null)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(stickers.map((s) => s.id)) : new Set())
  }

  const handlePrint = () => {
    const toPrint = selected.size > 0
      ? stickers.filter((s) => selected.has(s.id))
      : stickers
    if (toPrint.length === 0) return
    setIsPrinting(true)
    try {
      downloadStickerPdf(toPrint)
    } finally {
      setIsPrinting(false)
    }
  }

  const handlePreview = () => {
    const toPrint = selected.size > 0
      ? stickers.filter((s) => selected.has(s.id))
      : stickers
    if (toPrint.length === 0) return
    setIsPreviewing(true)
    try {
      previewStickerPdf(toPrint)
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
      setSelected((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSaveBundle = async () => {
    if (!bundleName.trim()) return
    const items: StickerBundleItem[] = Object.entries(bundleItems)
      .filter(([, v]) => v.checked && v.copies > 0)
      .map(([sticker_id, v]) => ({ sticker_id, copies: v.copies }))
    if (items.length === 0) {
      setBundleSaveError('Выберите хотя бы один стикер')
      return
    }
    setIsSavingBundle(true)
    setBundleSaveError(null)
    try {
      if (editingBundle) {
        await onEditBundle(editingBundle.id, bundleName.trim(), items)
      } else {
        await onAddBundle(bundleName.trim(), items)
        setSelected(new Set())
      }
      setBundleModalOpen(false)
      setEditingBundle(null)
      setBundleName('')
    } catch (err) {
      setBundleSaveError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSavingBundle(false)
    }
  }

  const handleConfirmDeleteBundle = async () => {
    if (!deleteBundleTarget) return
    setIsDeletingBundle(true)
    setDeleteBundleError(null)
    try {
      await onDeleteBundle(deleteBundleTarget.id)
      setDeleteBundleTarget(null)
    } catch (err) {
      setDeleteBundleError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeletingBundle(false)
    }
  }

  const handlePrintBundle = (bundle: StickerBundle) => {
    const toPrint: StickerTemplate[] = []
    for (const item of bundle.items) {
      const s = stickers.find((st) => st.id === item.sticker_id)
      if (s) toPrint.push({ ...s, copies: item.copies })
    }
    if (toPrint.length > 0) downloadStickerPdf(toPrint)
  }

  const handlePreviewBundle = (bundle: StickerBundle) => {
    const toPrint: StickerTemplate[] = []
    for (const item of bundle.items) {
      const s = stickers.find((st) => st.id === item.sticker_id)
      if (s) toPrint.push({ ...s, copies: item.copies })
    }
    if (toPrint.length > 0) previewStickerPdf(toPrint)
  }

  const allSelected = stickers.length > 0 && selected.size === stickers.length
  const printCount = selected.size > 0 ? selected.size : stickers.length

  return (
    <>
      <Card className="overflow-hidden rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900">Стикеры</span>
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{stickers.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={selected.size === 0}
              onClick={() => {
                const init: Record<string, { checked: boolean; copies: number }> = {}
                stickers.filter((s) => selected.has(s.id)).forEach((s) => { init[s.id] = { checked: true, copies: 1 } })
                setBundleItems(init)
                setBundleName('')
                setEditingBundle(null)
                setBundleSaveError(null)
                setBundleModalOpen(true)
              }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Создать набор
            </Button>
            <Button
              variant="secondary"
              disabled={isPreviewing || stickers.length === 0}
              onClick={handlePreview}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {isPreviewing ? 'Загрузка…' : 'Предпросмотр'}
            </Button>
            <Button
              variant="secondary"
              disabled={isPrinting || stickers.length === 0}
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <path d="M6 14h12v8H6z" />
              </svg>
              {isPrinting ? 'Генерация…' : `Скачать PDF${selected.size > 0 ? ` (${printCount})` : ''}`}
            </Button>
            <Button
              onClick={() => { setEditingSticker(null); setModalOpen(true) }}
              className="rounded-xl px-3 py-2 text-xs"
            >
              + Создать стикер
            </Button>
          </div>
        </div>

        {/* Table */}
        {stickers.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            Стикеров нет. Создайте первый.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="w-9 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                    />
                  </th>
                  <th className="px-3 py-2">Баркод</th>
                  <th className="px-3 py-2">Наименование</th>
                  <th className="px-3 py-2">Артикул</th>
                  <th className="px-3 py-2">Бренд</th>
                  <th className="px-3 py-2">Размер / Цвет</th>
                  <th className="px-3 py-2">Копий</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stickers.map((s) => (
                  <tr
                    key={s.id}
                    className={`align-middle text-slate-700 transition-colors hover:bg-slate-50 ${selected.has(s.id) ? 'bg-blue-50/50' : ''}`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{s.barcode}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{s.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{s.article ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">{s.brand ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {[s.size, s.color].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">{s.copies}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title="Предпросмотр"
                          onClick={() => previewStickerPdf([s])}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Скачать PDF"
                          onClick={() => downloadStickerPdf([s])}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M6 9V2h12v7" />
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                            <path d="M6 14h12v8H6z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Редактировать"
                          onClick={() => { setEditingSticker(s); setModalOpen(true) }}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => setDeleteTarget(s)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M9 4h6" /><path d="M5 7h14" />
                            <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                            <path d="M10 11v4" /><path d="M14 11v4" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Наборы ───────────────────────────────────────────── */}
      {bundles.length > 0 && (
        <Card className="overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-900">Наборы</span>
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{bundles.length}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-4 py-2">Название</th>
                  <th className="px-4 py-2">Стикеров</th>
                  <th className="px-4 py-2">Копий итого</th>
                  <th className="px-4 py-2">Создан</th>
                  <th className="w-32 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bundles.map((b) => {
                  const totalCopies = b.items.reduce((sum, it) => sum + it.copies, 0)
                  return (
                    <tr key={b.id} className="align-middle text-slate-700 transition-colors hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{b.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{b.items.length}</td>
                      <td className="px-4 py-2.5 text-slate-500">{totalCopies}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{new Date(b.created_at).toLocaleDateString('ru-RU')}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            title="Предпросмотр"
                            onClick={() => handlePreviewBundle(b)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Скачать PDF"
                            onClick={() => handlePrintBundle(b)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M6 9V2h12v7" />
                              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                              <path d="M6 14h12v8H6z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Редактировать"
                            onClick={() => {
                              const init: Record<string, { checked: boolean; copies: number }> = {}
                              b.items.forEach((it) => { init[it.sticker_id] = { checked: true, copies: it.copies } })
                              setBundleItems(init)
                              setBundleName(b.name)
                              setEditingBundle(b)
                              setBundleSaveError(null)
                              setBundleModalOpen(true)
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Удалить набор"
                            onClick={() => setDeleteBundleTarget(b)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M9 4h6" /><path d="M5 7h14" />
                              <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                              <path d="M10 11v4" /><path d="M14 11v4" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <StickerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialValues={editingSticker ?? undefined}
        onSubmit={async (values) => {
          if (editingSticker) {
            await onEdit(editingSticker.id, values)
          } else {
            await onAdd(values)
          }
        }}
      />

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить стикер?"
        description={`«${deleteTarget?.name ?? ''}» (${deleteTarget?.barcode ?? ''}) будет удалён.`}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={() => { if (!isDeleting) { setDeleteError(null); setDeleteTarget(null) } }}
        onConfirm={() => void handleConfirmDelete()}
      />

      {/* Модалка сохранения набора */}
      <Modal open={bundleModalOpen} onClose={() => { if (!isSavingBundle) { setBundleModalOpen(false); setEditingBundle(null) } }} title={editingBundle ? 'Редактировать набор' : 'Создать набор'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Название набора</label>
            <input
              type="text"
              autoFocus
              placeholder="Например: Партия апрель 2026"
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
            />
          </div>

          {/* Список стикеров с кол-вом */}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-[13px]">
              <thead className="sticky top-0 border-b border-slate-100 bg-white text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Наименование</th>
                  <th className="px-3 py-2 text-left">Арт.</th>
                  <th className="w-24 px-3 py-2 text-center">Кол-во этикеток</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stickers.filter((s) => bundleItems[s.id] !== undefined).map((s) => {
                  const item = bundleItems[s.id]
                  return (
                    <tr key={s.id} className="bg-blue-50/30 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{s.name}</td>
                      <td className="px-3 py-2.5 text-slate-400">{s.article ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={item.copies}
                          onChange={(e) => {
                            const v = Math.max(1, parseInt(e.target.value) || 1)
                            setBundleItems((prev) => ({ ...prev, [s.id]: { ...item, copies: v } }))
                          }}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {bundleSaveError && <p className="text-xs text-rose-500">{bundleSaveError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBundleModalOpen(false)} disabled={isSavingBundle}>
              Отмена
            </Button>
            <Button type="button" disabled={!bundleName.trim() || isSavingBundle} onClick={() => void handleSaveBundle()}>
              {isSavingBundle ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Удаление набора */}
      <DeleteConfirmModal
        open={Boolean(deleteBundleTarget)}
        title="Удалить набор?"
        description={`Набор «${deleteBundleTarget?.name ?? ''}» будет удалён. Стикеры останутся.`}
        isSubmitting={isDeletingBundle}
        error={deleteBundleError}
        onClose={() => { if (!isDeletingBundle) { setDeleteBundleError(null); setDeleteBundleTarget(null) } }}
        onConfirm={() => void handleConfirmDeleteBundle()}
      />
    </>
  )
}
