import { useCallback, useEffect, useRef, useState } from 'react'
import type { StickerFormValues, StickerTemplate, StickerBundle, StickerBundleItem, Store, Product } from '../types'
import { StickerFormModal } from '../components/stickers/StickerFormModal'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { downloadStickerPdf, previewStickerPdf } from '../lib/stickerPdf'
import { generateEAN13 } from '../lib/ean13'
import { fetchProducts } from '../services/productService'

interface StickersPageProps {
  stickers: StickerTemplate[]
  bundles: StickerBundle[]
  stores: Store[]
  selectedStoreId: string
  onStoreChange: (id: string) => void
  onAdd: (values: StickerFormValues) => Promise<unknown>
  onEdit: (id: string, values: StickerFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onAddBundle: (name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onEditBundle: (id: string, name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onDeleteBundle: (id: string) => Promise<void>
}

export const StickersPage = ({ stickers, bundles, stores, selectedStoreId, onStoreChange, onAdd, onEdit, onDelete, onAddBundle, onEditBundle, onDeleteBundle }: StickersPageProps) => {
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

  const [activeTab, setActiveTab] = useState<'stickers' | 'bundles' | 'import'>(() => {
    const stored = window.localStorage.getItem('elestet-stickers-tab')
    if (stored === 'stickers' || stored === 'bundles' || stored === 'import') return stored
    return 'stickers'
  })

  const handleTabChange = (tab: 'stickers' | 'bundles' | 'import') => {
    setActiveTab(tab)
    window.localStorage.setItem('elestet-stickers-tab', tab)
  }

  // ── Импорт WB ─────────────────────────────────────────────
  const storesWithKey = stores.filter((s) => s.api_key)
  const [importProducts, setImportProducts] = useState<Product[]>([])
  const [isLoadingImport, setIsLoadingImport] = useState(false)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<number | null>(null)
  const [importStoreDropdownOpen, setImportStoreDropdownOpen] = useState(false)
  const importStoreDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!importStoreDropdownRef.current?.contains(e.target as Node)) setImportStoreDropdownOpen(false)
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  const loadImportProducts = useCallback(async (storeId: string) => {
    if (!storeId) return
    setIsLoadingImport(true)
    setImportSelected(new Set())
    try {
      setImportProducts(await fetchProducts(storeId))
    } catch { /* silent */ } finally {
      setIsLoadingImport(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'import') void loadImportProducts(selectedStoreId)
  }, [activeTab, selectedStoreId, loadImportProducts])

  const handleImportCreate = async () => {
    const toCreate = importProducts.filter((p) => importSelected.has(p.id))
    if (toCreate.length === 0) return
    setIsImporting(true)
    setImportError(null)
    setImportDone(null)
    let count = 0
    try {
      for (const p of toCreate) {
        const barcode = p.barcodes[0] ?? generateEAN13()
        await onAdd({
          barcode,
          name: p.name ?? '',
          article: p.vendor_code ?? '',
          brand: p.brand ?? '',
          size: '',
          color: '',
          composition: '',
          supplier: '',
          supplier_address: '',
          production_date: '',
          country: '',
          copies: 1,
          icon_wash: false,
          icon_iron: false,
          icon_no_bleach: false,
          icon_no_tumble_dry: false,
          icon_eac: true,
        })
        count++
      }
      setImportDone(count)
      setImportSelected(new Set())
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Ошибка создания стикеров')
    } finally {
      setIsImporting(false)
    }
  }

  const allSelected = stickers.length > 0 && selected.size === stickers.length
  const printCount = selected.size > 0 ? selected.size : stickers.length

  const [search, setSearch] = useState('')
  const filteredStickers = stickers.filter((s) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      s.barcode.includes(q) ||
      s.article?.toLowerCase().includes(q) ||
      s.brand?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-4">
      {/* ── Верхняя панель ─────────────────────────────────── */}
      <Card className="rounded-3xl p-2.5">
        <div className="flex items-center gap-2.5">
          {/* Левая часть: поиск или дропдаун магазина */}
          {activeTab === 'import' ? (
            <div className="flex flex-1 items-center gap-3">
              {storesWithKey.length === 0 ? (
                <p className="text-xs text-slate-400">Нет магазинов с API ключом</p>
              ) : (
                <div ref={importStoreDropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setImportStoreDropdownOpen((o) => !o)}
                    className="flex h-10 items-center gap-2 rounded-2xl bg-slate-100 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    {stores.find((s) => s.id === selectedStoreId)?.name ?? '—'}
                    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-slate-400 transition-transform ${importStoreDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {importStoreDropdownOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                      {storesWithKey.map((s) => (
                        <button key={s.id} type="button"
                          onClick={() => { onStoreChange(s.id); setImportStoreDropdownOpen(false) }}
                          className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${s.id === selectedStoreId ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                        >
                          {s.id === selectedStoreId
                            ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
                            : <span className="h-3.5 w-3.5 shrink-0" />}
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {importDone !== null && <span className="text-xs text-emerald-600">✓ Создано стикеров: {importDone}</span>}
              {importError && <span className="text-xs text-rose-500">{importError}</span>}
            </div>
          ) : (
            <div className="relative flex-1">
              <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Поиск по названию, баркоду, артикулу, бренду..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-2xl border border-transparent bg-slate-100 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          {/* Кнопки по активной вкладке */}
          {activeTab === 'stickers' ? (
            <>
              <Button
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => {
                  const init: Record<string, { checked: boolean; copies: number }> = {}
                  stickers.filter((s) => selected.has(s.id)).forEach((s) => { init[s.id] = { checked: true, copies: 1 } })
                  setBundleItems(init); setBundleName(''); setEditingBundle(null); setBundleSaveError(null); setBundleModalOpen(true)
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
                Создать набор
              </Button>
              <Button variant="secondary" disabled={isPreviewing || stickers.length === 0} onClick={handlePreview} className="flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
                {isPreviewing ? 'Загрузка…' : 'Предпросмотр'}
              </Button>
              <Button variant="secondary" disabled={isPrinting || stickers.length === 0} onClick={handlePrint} className="flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" />
                </svg>
                {isPrinting ? 'Генерация…' : `Скачать PDF${selected.size > 0 ? ` (${printCount})` : ''}`}
              </Button>
              <Button onClick={() => { setEditingSticker(null); setModalOpen(true) }} className="shrink-0 rounded-2xl px-5 py-2.5">
                + Создать стикер
              </Button>
            </>
          ) : activeTab === 'bundles' ? (
            <Button
              onClick={() => {
                const init: Record<string, { checked: boolean; copies: number }> = {}
                stickers.forEach((s) => { init[s.id] = { checked: true, copies: 1 } })
                setBundleItems(init); setBundleName(''); setEditingBundle(null); setBundleSaveError(null); setBundleModalOpen(true)
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-2xl px-5 py-2.5"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              Создать набор
            </Button>
          ) : activeTab === 'import' ? (
            <>
              <Button className="shrink-0 rounded-2xl px-5 py-2.5" disabled={isImporting || importSelected.size === 0} onClick={() => void handleImportCreate()}>
                {isImporting ? 'Создание…' : `Создать стикеры${importSelected.size > 0 ? ` (${importSelected.size})` : ''}`}
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {/* ── Основной блок ──────────────────────────────────── */}
      <Card className="overflow-hidden rounded-3xl">
        {/* Вкладки */}
        <div className="flex items-center gap-5 border-b border-slate-100 px-5 py-3">
          <button type="button" onClick={() => handleTabChange('stickers')}
            className={`text-sm font-semibold transition-colors ${activeTab === 'stickers' ? 'text-slate-900' : 'text-slate-300 hover:text-slate-900'}`}
          >
            Кастомная <span className="ml-1 text-xs font-normal text-slate-400">{stickers.length}</span>
          </button>
          <button type="button" onClick={() => handleTabChange('import')}
            className={`text-sm font-semibold transition-colors ${activeTab === 'import' ? 'text-slate-900' : 'text-slate-300 hover:text-slate-900'}`}
          >
            Импорт <span className="ml-1 text-xs font-normal text-violet-400">WB</span>
          </button>
          <button type="button" onClick={() => handleTabChange('bundles')}
            className={`text-sm font-semibold transition-colors ${activeTab === 'bundles' ? 'text-slate-900' : 'text-slate-300 hover:text-slate-900'}`}
          >
            Наборы <span className="ml-1 text-xs font-normal text-slate-400">{bundles.length}</span>
          </button>
        </div>
        {activeTab === 'import' ? (
          <div className="flex flex-col">
            {/* Products table */}
            {isLoadingImport ? (
              <div className="flex items-center justify-center py-12 text-xs text-slate-400">Загрузка...</div>
            ) : importProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                <p className="text-sm text-slate-500">Товаров нет</p>
                <p className="text-xs text-slate-400">Перейдите на страницу Товары и нажмите «Синхронизировать»</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="w-9 px-3 py-2">
                        <input type="checkbox"
                          checked={importSelected.size === importProducts.length && importProducts.length > 0}
                          onChange={(e) => setImportSelected(e.target.checked ? new Set(importProducts.map((p) => p.id)) : new Set())}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                        />
                      </th>
                      <th className="px-3 py-2">Баркод</th>
                      <th className="px-3 py-2">Арт. WB</th>
                      <th className="px-3 py-2">Арт. продавца</th>
                      <th className="px-3 py-2">Название</th>
                      <th className="px-3 py-2">Бренд</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importProducts.map((p) => (
                      <tr key={p.id} className={`align-middle transition-colors hover:bg-slate-50 ${importSelected.has(p.id) ? 'bg-blue-50/40' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox"
                            checked={importSelected.has(p.id)}
                            onChange={() => setImportSelected((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{p.barcodes[0] ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{p.nm_id}</td>
                        <td className="px-3 py-2.5 text-slate-600">{p.vendor_code ?? '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">{p.name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.brand ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'stickers' ? (
          stickers.length === 0 ? (
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
        )
        ) : (
          bundles.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-400">
              Наборов нет. Создайте первый набор.
            </div>
          ) : (
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
                        <td className="px-4 py-2.5 text-xs text-slate-400">{new Date(b.created_at).toLocaleDateString('ru-RU')}</td>
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
          )
        )}
      </Card>

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
    </div>
  )
}
