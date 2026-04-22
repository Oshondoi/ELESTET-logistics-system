import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StickerFormValues, StickerTemplate, StickerBundle, StickerBundleItem, Store, Product } from '../types'
import { StickerFormModal } from '../components/stickers/StickerFormModal'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { downloadStickerPdf, previewStickerPdf } from '../lib/stickerPdf'
import { generateEAN13 } from '../lib/ean13'
import { fetchProducts } from '../services/productService'

// ── Хелперы для размеров (Import WB) ─────────────────────
interface SizeRowImp { techSize: string; barcode: string; rowKey: string }
const LETTER_SIZE_ORDER_IMP: Record<string, number> = {
  'XXS': 1, 'XS': 2, 'S': 3, 'M': 4, 'L': 5, 'XL': 6,
  '2XL': 7, 'XXL': 7, '3XL': 8, 'XXXL': 8, '4XL': 9, '5XL': 10, '6XL': 11,
}
function sizeWeightImp(techSize: string): number {
  const s = techSize.trim().toUpperCase()
  if (LETTER_SIZE_ORDER_IMP[s] !== undefined) return LETTER_SIZE_ORDER_IMP[s]
  const n = parseFloat(s)
  return isNaN(n) ? -1 : n
}
function getSizeRowsImp(product: import('../types').Product): SizeRowImp[] {
  const sizes = (product.sizes ?? []) as Array<{ techSize?: string; skus?: string[] }>
  if (sizes.length === 0) return [{ techSize: '—', barcode: (product.barcodes as string[])[0] ?? '—', rowKey: `${product.id}-0` }]
  const rows: SizeRowImp[] = []
  sizes.forEach((s, si) => {
    const skus = s.skus ?? []
    if (skus.length === 0) {
      rows.push({ techSize: s.techSize ?? '—', barcode: '—', rowKey: `${product.id}-${si}` })
    } else {
      skus.forEach((sku, ki) => rows.push({ techSize: s.techSize ?? '—', barcode: sku, rowKey: `${product.id}-${si}-${ki}` }))
    }
  })
  return rows.sort((a, b) => sizeWeightImp(a.techSize) - sizeWeightImp(b.techSize))
}

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
  const [deleteMassOpen, setDeleteMassOpen] = useState(false)
  const [isDeletingMass, setIsDeletingMass] = useState(false)
  const [deleteMassError, setDeleteMassError] = useState<string | null>(null)
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

  const handleConfirmDeleteMass = async () => {
    setIsDeletingMass(true)
    setDeleteMassError(null)
    try {
      for (const id of Array.from(selected)) {
        await onDelete(id)
      }
      setSelected(new Set())
      setDeleteMassOpen(false)
    } catch (err) {
      setDeleteMassError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeletingMass(false)
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
  const [importExpandedIds, setImportExpandedIds] = useState<Set<string>>(new Set())
  const [importExpandAll, setImportExpandAll] = useState(false)

  const handleImportToggleAll = () => {
    if (importExpandAll) {
      setImportExpandedIds(new Set())
      setImportExpandAll(false)
    } else {
      setImportExpandedIds(new Set(importProducts.map((p) => p.id)))
      setImportExpandAll(true)
    }
  }
  const [importPhotoPreview, setImportPhotoPreview] = useState<{ url: string; x: number; y: number } | null>(null)

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

  const allImportSizeRows = useMemo(
    () => importProducts.flatMap((p) => getSizeRowsImp(p)),
    [importProducts]
  )

  const handleImportCreate = async () => {
    const toCreate = allImportSizeRows
      .filter((row) => importSelected.has(row.rowKey))
      .map((row) => {
        const product = importProducts.find((p) => row.rowKey.startsWith(p.id))!
        return { product, row }
      })
    if (toCreate.length === 0) return
    setIsImporting(true)
    setImportError(null)
    setImportDone(null)
    const createdIds: string[] = []
    try {
      for (const { product: p, row } of toCreate) {
        const barcode = row.barcode !== '—' ? row.barcode : generateEAN13()
        try {
          const result = await onAdd({
            barcode,
            name: p.name ?? p.vendor_code ?? barcode,
            article: p.vendor_code ?? '',
            brand: p.brand ?? '',
            size: row.techSize !== '—' ? row.techSize : '',
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
          }) as { id: string } | undefined
          if (result?.id) createdIds.push(result.id)
        } catch {
          // пропускаем дубли (уже существующий баркод)
        }
      }
      setImportSelected(new Set())
      if (createdIds.length > 0) {
        const init: Record<string, { checked: boolean; copies: number }> = {}
        createdIds.forEach((id) => { init[id] = { checked: true, copies: 1 } })
        setBundleItems(init)
        setBundleName('')
        setEditingBundle(null)
        setBundleSaveError(null)
        setBundleModalOpen(true)
      } else {
        setImportError('Все выбранные стикеры уже существуют')
      }
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
              <button
                type="button"
                onClick={handleImportToggleAll}
                aria-pressed={importExpandAll}
                aria-label={importExpandAll ? 'Свернуть все' : 'Развернуть все'}
                title={importExpandAll ? 'Свернуть все' : 'Развернуть все'}
                className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition',
                  importExpandAll
                    ? 'bg-[#E3EAF6] text-slate-700 hover:bg-[#d6e0f5]'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                ].join(' ')}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {importExpandAll ? (
                    <>
                      <path d="m7.5 11 4.5-4.5 4.5 4.5" />
                      <path d="m7.5 17 4.5-4.5 4.5 4.5" />
                    </>
                  ) : (
                    <>
                      <path d="m7.5 7 4.5 4.5 4.5-4.5" />
                      <path d="m7.5 13 4.5 4.5 4.5-4.5" />
                    </>
                  )}
                </svg>
              </button>
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
                {isImporting ? 'Создание…' : `Создать набор${importSelected.size > 0 ? ` (${importSelected.size})` : ''}`}
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="w-8 px-3 py-2.5" />
                      <th className="w-9 px-3 py-2.5">
                        {allImportSizeRows.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allImportSizeRows.every((r) => importSelected.has(r.rowKey))}
                            onChange={(e) => setImportSelected(e.target.checked ? new Set(allImportSizeRows.map((r) => r.rowKey)) : new Set())}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                          />
                        )}
                      </th>
                      <th className="w-12 px-2 py-2.5" />
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул WB</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул продавца</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Название</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Бренд</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Категория</th>
                    </tr>
                  </thead>
                  {importProducts.map((product) => {
                    const isExpanded = importExpandAll || importExpandedIds.has(product.id)
                    const sizeRows = getSizeRowsImp(product)
                    const productRowKeys = sizeRows.map((r) => r.rowKey)
                    const allProductSelected = productRowKeys.length > 0 && productRowKeys.every((k) => importSelected.has(k))
                    const photos = product.photos as Array<{ c246x328?: string; big?: string }> | null
                    const photoUrl = photos?.[0]?.c246x328 ?? photos?.[0]?.big ?? null
                    return (
                      <tbody key={product.id} className="divide-y divide-slate-50">
                        <tr
                          className="cursor-pointer align-middle transition-colors duration-150 hover:bg-slate-50"
                          onClick={() => setImportExpandedIds((prev) => { const n = new Set(prev); n.has(product.id) ? n.delete(product.id) : n.add(product.id); return n })}
                        >
                          <td className="px-3 py-3 text-slate-400">
                            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={allProductSelected}
                              onChange={(e) => setImportSelected((prev) => {
                                const n = new Set(prev)
                                productRowKeys.forEach((k) => e.target.checked ? n.add(k) : n.delete(k))
                                return n
                              })}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                            />
                          </td>
                          <td className="px-2 py-2">
                            {photoUrl ? (
                              <img
                                src={photoUrl}
                                alt=""
                                className="h-9 w-9 cursor-zoom-in rounded-lg object-cover"
                                onMouseEnter={(e) => {
                                  const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect()
                                  const popW = 288, popH = 384, gap = 12
                                  const x = rect.right + gap + popW > window.innerWidth ? rect.left - gap - popW : rect.right + gap
                                  const y = Math.min(rect.top, window.innerHeight - popH - gap)
                                  setImportPhotoPreview({ url: photoUrl, x, y })
                                }}
                                onMouseLeave={() => setImportPhotoPreview(null)}
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                                <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <rect x="3" y="3" width="18" height="18" rx="3" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path d="m21 15-5-5L5 21" />
                                </svg>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{product.nm_id}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">{product.vendor_code ?? '—'}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{product.name ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{product.brand ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-400">{product.category ?? '—'}</td>
                        </tr>
                        <tr>
                          <td className="p-0" colSpan={8}>
                            <div style={{ display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
                              <div className="overflow-hidden">
                                <div className="border-t border-slate-100 bg-slate-50/70">
                                  <table className="min-w-full text-[13px]">
                                    <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                                      <tr>
                                        <th className="w-9 px-3 py-2" />
                                        <th className="px-4 py-2 font-semibold" colSpan={2}>Размер</th>
                                        <th className="px-4 py-2 font-semibold" colSpan={3}>Баркод</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100/80">
                                      {sizeRows.map((row) => (
                                        <tr key={row.rowKey} className={`align-middle transition-colors ${importSelected.has(row.rowKey) ? 'bg-blue-50/50' : ''}`}>
                                          <td className="px-3 py-2">
                                            <input
                                              type="checkbox"
                                              checked={importSelected.has(row.rowKey)}
                                              onChange={() => setImportSelected((prev) => { const n = new Set(prev); n.has(row.rowKey) ? n.delete(row.rowKey) : n.add(row.rowKey); return n })}
                                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                                            />
                                          </td>
                                          <td colSpan={2} className="px-4 py-2">
                                            {row.techSize !== '—' ? (
                                              <span className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{row.techSize}</span>
                                            ) : (
                                              <span className="text-xs text-slate-300">—</span>
                                            )}
                                          </td>
                                          <td colSpan={3} className="px-4 py-2 font-mono text-xs text-slate-500">{row.barcode}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    )
                  })}
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
                  <th className="w-10 px-2 py-2">
                    <button
                      type="button"
                      title="Удалить выбранные"
                      disabled={selected.size === 0 || isDeletingMass}
                      onClick={() => setDeleteMassOpen(true)}
                      className="flex h-7 w-7 items-center justify-center rounded-xl transition disabled:pointer-events-none disabled:opacity-30 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <path d="M9 4h6" /><path d="M5 7h14" />
                        <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                        <path d="M10 11v4" /><path d="M14 11v4" />
                      </svg>
                    </button>
                  </th>
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
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
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
        open={deleteMassOpen}
        title={`Удалить ${selected.size} стикеров?`}
        description="Выбранные стикеры будут удалены. Действие необратимо."
        isSubmitting={isDeletingMass}
        error={deleteMassError}
        onClose={() => { if (!isDeletingMass) { setDeleteMassError(null); setDeleteMassOpen(false) } }}
        onConfirm={() => void handleConfirmDeleteMass()}
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

      {/* Превью фото при наведении (Import WB) */}
      {importPhotoPreview && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200"
          style={{ left: importPhotoPreview.x, top: importPhotoPreview.y }}
        >
          <img src={importPhotoPreview.url} alt="" className="h-96 w-72 object-cover" />
        </div>
      )}
    </div>
  )
}
