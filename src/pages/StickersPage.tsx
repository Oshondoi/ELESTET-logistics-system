import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StickerFormValues, StickerTemplate, StickerBundle, StickerBundleItem, Store, Product } from '../types'
import { KizPage } from './KizPage'
import { KizGuidePage } from './KizGuidePage'
import { StickerFormModal } from '../components/stickers/StickerFormModal'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { downloadStickerPdf, previewStickerPdf } from '../lib/stickerPdf'
import { generateEAN13 } from '../lib/ean13'
import { fetchProducts, triggerSync } from '../services/productService'
import { showToast } from '../components/ui/Toast'
import { FbsStoreSelect } from '../components/fbs/FbsStoreSelect'
import { StickerPrintSettingsModal, type StickerPrintGroupDraft, groupsToStickers } from '../components/stickers/StickerPrintSettingsModal'
import {
  defaultStickerPrintPreferences,
  fetchStickerPrintPreferences,
  fetchStickerProductOverrides,
  saveStickerPrintPreferences,
  saveStickerProductOverride,
  type StickerPrintPreferences,
  type StickerProductPrintOverride,
} from '../services/stickerPrintSettingsService'

const BULK_PDF_WARN_THRESHOLD = 100
const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function normalizeImportSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactImportSearch(value: string): string {
  return value.replace(/[\s\-_.\/\\]+/g, '')
}

type ImportSearchCorpus = { normalized: string; compact: string }

function importSearchCorpus(values: unknown[]): ImportSearchCorpus {
  const normalized = normalizeImportSearch(values.filter((value) => value != null).join(' '))
  return { normalized, compact: compactImportSearch(normalized) }
}

function matchesImportSearch(corpus: ImportSearchCorpus, tokens: string[]): boolean {
  return tokens.every((token) => {
    const compactToken = compactImportSearch(token)
    return corpus.normalized.includes(token) || Boolean(compactToken && corpus.compact.includes(compactToken))
  })
}

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

function getWbColors(value: string | null | undefined): string[] {
  const seen = new Set<string>()
  return String(value ?? '').split(',').map((color) => color.trim()).filter((color) => {
    const key = color.toLocaleLowerCase('ru-RU')
    if (!color || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

interface StickersPageProps {
  stickers: StickerTemplate[]
  bundles: StickerBundle[]
  stores: Store[]
  selectedStoreId: string
  activeAccountId: string
  onStoreChange: (id: string) => void
  onAdd: (values: StickerFormValues) => Promise<unknown>
  onEdit: (id: string, values: StickerFormValues) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onAddBundle: (name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onEditBundle: (id: string, name: string, items: StickerBundleItem[]) => Promise<StickerBundle>
  onDeleteBundle: (id: string) => Promise<void>
  canManage?: boolean
  canDelete?: boolean
  canImport?: boolean
  isAdmin?: boolean
}

export const StickersPage = ({ stickers, bundles, stores, selectedStoreId, activeAccountId, onStoreChange, onAdd, onEdit, onDelete, onAddBundle, onEditBundle, onDeleteBundle, canManage = true, canDelete = false, canImport = true, isAdmin }: StickersPageProps) => {
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
    const toPrint = (selected.size > 0
      ? stickers.filter((s) => selected.has(s.id))
      : stickers).map((s) => ({ ...s, production_date: globalProductionDate || s.production_date }))
    if (toPrint.length === 0) return
    openPrintSettings(toPrint, { onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf) })
  }

  const handlePreview = () => {
    const toPrint = (selected.size > 0
      ? stickers.filter((s) => selected.has(s.id))
      : stickers).map((s) => ({ ...s, production_date: globalProductionDate || s.production_date }))
    if (toPrint.length === 0) return
    openPrintSettings(toPrint, { onPrint: (configured) => previewWithCheck(configured, previewStickerPdf) })
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
      if (s) toPrint.push({ ...s, copies: item.copies, production_date: globalProductionDate || s.production_date })
    }
    openPrintSettings(toPrint, {
      title: `Печать набора «${bundle.name}»`,
      showColorTabs: true,
      onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf),
    })
  }

  const handlePreviewBundle = (bundle: StickerBundle) => {
    const toPrint: StickerTemplate[] = []
    for (const item of bundle.items) {
      const s = stickers.find((st) => st.id === item.sticker_id)
      if (s) toPrint.push({ ...s, copies: item.copies, production_date: globalProductionDate || s.production_date })
    }
    openPrintSettings(toPrint, {
      title: `Печать набора «${bundle.name}»`,
      showColorTabs: true,
      onPrint: (configured) => previewWithCheck(configured, previewStickerPdf),
    })
  }

  const [mainTab, setMainTab] = useState<'stickers' | 'stickers2' | 'stickers3'>(() => {
    const saved = localStorage.getItem('stickers_main_tab')
    if (saved === 'stickers2') return saved
    if (saved === 'stickers3') return isAdmin ? saved : 'stickers'
    return 'stickers'
  })
  const handleMainTab = (tab: 'stickers' | 'stickers2' | 'stickers3') => {
    setMainTab(tab)
    localStorage.setItem('stickers_main_tab', tab)
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

  // ── Sweep-select (свип-выбор): удержание мыши + передвижение для массовой отметки/снятия
  const sweepDragging = useRef(false)
  const sweepValue = useRef(false) // true = проверяем, false = снимаем
  const sweepTarget = useRef<'stickers' | 'import' | null>(null)

  const startSweep = (tab: 'stickers' | 'import', id: string, currentChecked: boolean) => {
    sweepDragging.current = true
    sweepValue.current = !currentChecked
    sweepTarget.current = tab
    if (tab === 'stickers') {
      setSelected((prev) => { const n = new Set(prev); sweepValue.current ? n.add(id) : n.delete(id); return n })
    } else {
      setImportSelected((prev) => { const n = new Set(prev); sweepValue.current ? n.add(id) : n.delete(id); return n })
    }
  }

  const continueSweep = (tab: 'stickers' | 'import', id: string) => {
    if (!sweepDragging.current || sweepTarget.current !== tab) return
    if (tab === 'stickers') {
      setSelected((prev) => { const n = new Set(prev); sweepValue.current ? n.add(id) : n.delete(id); return n })
    } else {
      setImportSelected((prev) => { const n = new Set(prev); sweepValue.current ? n.add(id) : n.delete(id); return n })
    }
  }

  useEffect(() => {
    const stop = () => { sweepDragging.current = false; sweepTarget.current = null }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const [importProducts, setImportProducts] = useState<Product[]>([])
  const [importSearch, setImportSearch] = useState('')
  const [importCustomNames, setImportCustomNames] = useState<Map<string, string>>(new Map())
  const [isLoadingImport, setIsLoadingImport] = useState(false)
  const [isSyncingImport, setIsSyncingImport] = useState(false)
  const [importSyncError, setImportSyncError] = useState<string | null>(null)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<number | null>(null)
  // Модалка создания набора из импорта (показывается ДО создания стикеров)
  const [importBundleModalOpen, setImportBundleModalOpen] = useState(false)
  const [importBundleName, setImportBundleName] = useState('')
  const [importBundleQties, setImportBundleQties] = useState<Record<string, number>>({})
  const [importBundlePrintDrafts, setImportBundlePrintDrafts] = useState<Map<string, StickerTemplate>>(new Map())
  const [importBundleError, setImportBundleError] = useState<string | null>(null)
  const [importExpandedIds, setImportExpandedIds] = useState<Set<string>>(new Set())
  const [importExpandAll, setImportExpandAll] = useState(() => localStorage.getItem('elestet-stickers-expand-all') === 'true')
  const [globalProductionDate, setGlobalProductionDate] = useState(localToday)
  const [globalIcons, setGlobalIcons] = useState<{ wash: boolean; iron: boolean; no_bleach: boolean; no_tumble_dry: boolean; eac: boolean }>(() => {
    try {
      const stored = localStorage.getItem('elestet-sticker-icons')
      if (stored) return { wash: false, iron: false, no_bleach: false, no_tumble_dry: false, eac: true, ...JSON.parse(stored) }
    } catch {}
    return { wash: false, iron: false, no_bleach: false, no_tumble_dry: false, eac: true }
  })
  const toggleGlobalIcon = (key: keyof typeof globalIcons) => setGlobalIcons((p) => {
    const next = { ...p, [key]: !p[key] }
    localStorage.setItem('elestet-sticker-icons', JSON.stringify(next))
    return next
  })
  const [iconsDropdownOpen, setIconsDropdownOpen] = useState(false)
  const iconsDropdownRef = useRef<HTMLDivElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [printPreferences, setPrintPreferences] = useState<StickerPrintPreferences>(defaultStickerPrintPreferences)
  const [productPrintOverrides, setProductPrintOverrides] = useState<Map<string, StickerProductPrintOverride>>(new Map())
  type PrintSetupState = {
    title: string
    groups: StickerPrintGroupDraft[]
    showColorTabs: boolean
    allowCreateBundle: boolean
    onPrint: (stickers: StickerTemplate[]) => void
  } | null
  const [printSetup, setPrintSetup] = useState<PrintSetupState>(null)

  // Pre-print проверка пустых полей
  type PrePrintState = { stickers: StickerTemplate[]; onPrint: (s: StickerTemplate[]) => void } | null
  const [prePrintModal, setPrePrintModal] = useState<PrePrintState>(null)
  const [prePrintEdits, setPrePrintEdits] = useState<Partial<StickerTemplate>>({})
  const [isRememberingMissing, setIsRememberingMissing] = useState(false)

  const CHECKED_FIELDS: { key: keyof StickerTemplate; label: string }[] = [
    { key: 'production_date',  label: 'Дата производства' },
    { key: 'composition',      label: 'Состав' },
    { key: 'color',            label: 'Цвет' },
    { key: 'supplier',         label: 'Поставщик' },
    { key: 'supplier_address', label: 'Адрес поставщика' },
    { key: 'country',          label: 'Страна' },
  ]

  const getMissingFields = (stickers: StickerTemplate[]) =>
    CHECKED_FIELDS.filter(({ key }) => stickers.some((s) => !s[key]))

  const previewWithCheck = (stickers: StickerTemplate[], onPrint: (s: StickerTemplate[]) => void) => {
    const missing = getMissingFields(stickers)
    if (missing.length > 0) {
      setPrePrintEdits({})
      setPrePrintModal({ stickers, onPrint })
    } else {
      onPrint(stickers)
    }
  }
  const [importAnyExpanded, setImportAnyExpanded] = useState(false)

  const handleImportToggleAll = () => {
    if (importAnyExpanded) {
      setImportExpandedIds(new Set())
      setImportExpandAll(false)
      setImportAnyExpanded(false)
      localStorage.setItem('elestet-stickers-expand-all', 'false')
    } else {
      setImportExpandedIds(new Set(importProducts.map((p) => p.id)))
      setImportExpandAll(true)
      setImportAnyExpanded(true)
      localStorage.setItem('elestet-stickers-expand-all', 'true')
    }
  }
  const [importPhotoPreview, setImportPhotoPreview] = useState<{ url: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!iconsDropdownRef.current?.contains(e.target as Node)) setIconsDropdownOpen(false)
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  const loadImportProducts = useCallback(async (storeId: string) => {
    if (!storeId) return
    setIsLoadingImport(true)
    try {
      const nextProducts = await fetchProducts(storeId)
      const validRowKeys = new Set(nextProducts.flatMap((product) => getSizeRowsImp(product).map((row) => row.rowKey)))
      setImportProducts(nextProducts)
      setImportSelected((previous) => new Set([...previous].filter((rowKey) => validRowKeys.has(rowKey))))
    } finally {
      setIsLoadingImport(false)
    }
  }, [])

  useEffect(() => {
    if (selectedStoreId) void loadImportProducts(selectedStoreId).catch(() => undefined)
  }, [selectedStoreId, loadImportProducts])

  useEffect(() => {
    if (!activeAccountId || !selectedStoreId) return
    void Promise.all([
      fetchStickerPrintPreferences(activeAccountId, selectedStoreId),
      fetchStickerProductOverrides(activeAccountId, selectedStoreId),
    ]).then(([preferences, overrides]) => {
      setPrintPreferences(preferences)
      setProductPrintOverrides(overrides)
      setGlobalProductionDate(preferences.production_date || localToday())
      setGlobalIcons({
        wash: preferences.icon_wash,
        iron: preferences.icon_iron,
        no_bleach: preferences.icon_no_bleach,
        no_tumble_dry: preferences.icon_no_tumble_dry,
        eac: preferences.icon_eac,
      })
      setImportCustomNames(new Map([...overrides.entries()].flatMap(([productId, value]) => value.name ? [[productId, value.name] as const] : [])))
    }).catch(() => undefined)
  }, [activeAccountId, selectedStoreId])

  useEffect(() => {
    setImportSearch('')
    setImportSyncError(null)
  }, [selectedStoreId])

  const handleImportSync = async () => {
    if (!selectedStoreId || isSyncingImport) return
    setIsSyncingImport(true)
    setImportSyncError(null)
    try {
      const result = await triggerSync(selectedStoreId)
      await loadImportProducts(selectedStoreId)
      showToast(`Синхронизация завершена. Товаров: ${result.count}`, 'success')
    } catch (syncError) {
      setImportSyncError(syncError instanceof Error ? syncError.message : 'Ошибка синхронизации товаров')
    } finally {
      setIsSyncingImport(false)
    }
  }

  const importStore = stores.find((s) => s.id === selectedStoreId)

  const allImportSizeRows = useMemo(
    () => importProducts.flatMap((p) => getSizeRowsImp(p)),
    [importProducts]
  )

  const importSearchResult = useMemo(() => {
    const tokens = normalizeImportSearch(importSearch).split(' ').filter(Boolean)
    if (tokens.length === 0) {
      return {
        products: importProducts,
        matchingRowKeys: new Set<string>(),
        barcodeMatchRowKeys: new Set<string>(),
      }
    }

    const matchingRowKeys = new Set<string>()
    const barcodeMatchRowKeys = new Set<string>()
    const normalizedQuery = normalizeImportSearch(importSearch)
    const products = importProducts.filter((product) => {
      const rows = getSizeRowsImp(product)
      const rawData = (() => {
        try { return JSON.stringify(product.raw_data ?? '') }
        catch { return '' }
      })()
      const baseValues = [
        product.nm_id,
        product.vendor_code,
        product.name,
        importCustomNames.get(product.id),
        product.brand,
        product.category,
        (product as Product & { category_parent?: string | null }).category_parent,
        product.color,
        product.composition,
        product.country,
        ...product.barcodes,
        rawData,
      ]
      const baseCorpus = importSearchCorpus(baseValues)
      const rowMatches = rows.filter((row) => {
        const rowCorpus = importSearchCorpus([row.techSize, row.barcode])
        const combinedCorpus = importSearchCorpus([...baseValues, row.techSize, row.barcode])
        const directRowMatch = tokens.some((token) => matchesImportSearch(rowCorpus, [token]))
        return directRowMatch && matchesImportSearch(combinedCorpus, tokens)
      })
      rowMatches.forEach((row) => matchingRowKeys.add(row.rowKey))
      rows.forEach((row) => {
        if (normalizedQuery.length >= 4 && normalizeImportSearch(row.barcode).includes(normalizedQuery)) {
          barcodeMatchRowKeys.add(row.rowKey)
        }
      })
      const fullCorpus = importSearchCorpus([...baseValues, ...rows.flatMap((row) => [row.techSize, row.barcode])])
      return matchesImportSearch(baseCorpus, tokens)
        || rowMatches.length > 0
        || matchesImportSearch(fullCorpus, tokens)
    })

    return { products, matchingRowKeys, barcodeMatchRowKeys }
  }, [importCustomNames, importProducts, importSearch])

  const filteredImportProducts = importSearchResult.products
  const visibleImportSizeRows = useMemo(
    () => filteredImportProducts.flatMap((product) => getSizeRowsImp(product)),
    [filteredImportProducts],
  )

  const findProductForSticker = (sticker: StickerTemplate): Product | undefined => {
    if (sticker.product_id) {
      const linked = importProducts.find((product) => product.id === sticker.product_id)
      if (linked) return linked
    }
    const nmId = sticker.nm_id ?? Number(sticker.article)
    if (Number.isFinite(nmId)) {
      const byArticle = importProducts.find((product) => product.nm_id === nmId)
      if (byArticle) return byArticle
    }
    return importProducts.find((product) => getSizeRowsImp(product).some((row) => row.barcode === sticker.barcode))
  }

  const buildPrintGroups = (templates: StickerTemplate[], startUnchecked = false): StickerPrintGroupDraft[] => {
    const groups = new Map<string, StickerPrintGroupDraft>()
    for (const template of templates) {
      const product = findProductForSticker(template)
      const productId = product?.id ?? template.product_id ?? undefined
      const override = productId ? productPrintOverrides.get(productId) : undefined
      const colors = getWbColors(product?.color)
      const rememberedColor = override?.color ?? template.color ?? ''
      const selectedColor = colors.length === 0
        ? rememberedColor
        : colors.some((color) => color.toLocaleLowerCase('ru-RU') === rememberedColor.toLocaleLowerCase('ru-RU'))
          ? colors.find((color) => color.toLocaleLowerCase('ru-RU') === rememberedColor.toLocaleLowerCase('ru-RU')) ?? ''
          : colors.length === 1 ? colors[0] : ''
      const key = productId ?? `custom:${template.article ?? template.name}:${template.color ?? ''}`
      let group = groups.get(key)
      if (!group) {
        group = {
          key,
          label: product?.vendor_code ?? template.name,
          productId,
          wbProductMissing: !product && Boolean(template.product_id || template.nm_id),
          availableColors: colors,
          name: (productId ? importCustomNames.get(productId) : undefined) ?? override?.name ?? product?.name ?? template.name,
          article: String(product?.nm_id ?? template.nm_id ?? template.article ?? ''),
          sellerArticle: override?.seller_article ?? product?.vendor_code ?? template.seller_article ?? '',
          showWbArticle: printPreferences.show_wb_article,
          showSellerArticle: printPreferences.show_seller_article,
          brand: override?.brand ?? product?.brand ?? template.brand ?? '',
          composition: override?.composition ?? product?.composition ?? template.composition ?? '',
          color: selectedColor,
          supplier: printPreferences.supplier || importStore?.supplier_full || importStore?.supplier || template.supplier || '',
          supplierAddress: printPreferences.supplier_address || importStore?.address || template.supplier_address || '',
          productionDate: globalProductionDate || printPreferences.production_date || localToday(),
          country: override?.country ?? product?.country ?? importStore?.country ?? (product ? '' : template.country ?? ''),
          iconWash: globalIcons.wash,
          iconIron: globalIcons.iron,
          iconNoBleach: globalIcons.no_bleach,
          iconNoTumbleDry: globalIcons.no_tumble_dry,
          iconEac: globalIcons.eac,
          sizes: [],
        }
        groups.set(key, group)
      }
      const rememberedSize = override?.sizes?.[template.barcode]
      group.sizes.push({
        key: `${key}:${template.barcode}`,
        barcode: template.barcode,
        size: rememberedSize ?? template.size ?? '',
        checked: !startUnchecked,
        copies: Math.max(1, template.copies || 1),
        source: {
          ...template,
          product_id: productId,
          store_id: selectedStoreId || template.store_id,
          nm_id: product?.nm_id ?? template.nm_id,
          available_colors: colors,
        },
      })
    }
    return [...groups.values()]
  }

  const openPrintSettings = (
    templates: StickerTemplate[],
    options: {
      title?: string
      showColorTabs?: boolean
      startUnchecked?: boolean
      allowCreateBundle?: boolean
      onPrint: (stickers: StickerTemplate[]) => void
    },
  ) => {
    if (templates.length === 0) return
    setPrintSetup({
      title: options.title ?? 'Настройка печати',
      groups: buildPrintGroups(templates, options.startUnchecked),
      showColorTabs: Boolean(options.showColorTabs),
      allowCreateBundle: Boolean(options.allowCreateBundle),
      onPrint: options.onPrint,
    })
  }

  const rememberPrintGroups = async (groups: StickerPrintGroupDraft[]) => {
    const first = groups[0]
    if (!first || !activeAccountId || !selectedStoreId) return
    const nextPreferences: StickerPrintPreferences = {
      show_wb_article: first.showWbArticle,
      show_seller_article: first.showSellerArticle,
      supplier: first.supplier,
      supplier_address: first.supplierAddress,
      production_date: first.productionDate,
      country: first.country,
      icon_wash: first.iconWash,
      icon_iron: first.iconIron,
      icon_no_bleach: first.iconNoBleach,
      icon_no_tumble_dry: first.iconNoTumbleDry,
      icon_eac: first.iconEac,
    }
    await saveStickerPrintPreferences(activeAccountId, selectedStoreId, nextPreferences)
    setPrintPreferences(nextPreferences)
    setGlobalProductionDate(nextPreferences.production_date)
    setGlobalIcons({ wash: first.iconWash, iron: first.iconIron, no_bleach: first.iconNoBleach, no_tumble_dry: first.iconNoTumbleDry, eac: first.iconEac })

    const nextOverrides = new Map(productPrintOverrides)
    for (const group of groups) {
      if (!group.productId) continue
      const product = importProducts.find((item) => item.id === group.productId)
      const automaticSizes = new Map(product ? getSizeRowsImp(product).map((size) => [size.barcode, size.techSize]) : [])
      const customSizes = Object.fromEntries(group.sizes
        .filter((size) => size.size !== (automaticSizes.get(size.barcode) ?? size.source.size ?? ''))
        .map((size) => [size.barcode, size.size]))
      const automaticCountry = product?.country ?? importStore?.country ?? ''
      const override: StickerProductPrintOverride = {
        ...(group.name !== (product?.name ?? '') ? { name: group.name } : {}),
        ...(group.composition !== (product?.composition ?? '') ? { composition: group.composition } : {}),
        ...(group.sellerArticle !== (product?.vendor_code ?? '') ? { seller_article: group.sellerArticle } : {}),
        ...(group.brand !== (product?.brand ?? '') ? { brand: group.brand } : {}),
        color: group.color,
        ...(group.country !== automaticCountry ? { country: group.country } : {}),
        ...(Object.keys(customSizes).length > 0 ? { sizes: customSizes } : {}),
      }
      await saveStickerProductOverride(activeAccountId, selectedStoreId, group.productId, override)
      nextOverrides.set(group.productId, override)
    }
    const existingIds = new Set(stickers.map((sticker) => sticker.id))
    for (const configured of groupsToStickers(groups)) {
      if (configured.product_id || !existingIds.has(configured.id)) continue
      await onEdit(configured.id, {
        barcode: configured.barcode,
        name: configured.name,
        composition: configured.composition ?? '',
        article: configured.article ?? '',
        seller_article: configured.seller_article ?? '',
        brand: configured.brand ?? '',
        size: configured.size ?? '',
        color: configured.color ?? '',
        supplier: configured.supplier ?? '',
        supplier_address: configured.supplier_address ?? '',
        production_date: configured.production_date ?? '',
        country: configured.country,
        copies: configured.copies,
        icon_wash: configured.icon_wash,
        icon_iron: configured.icon_iron,
        icon_no_bleach: configured.icon_no_bleach,
        icon_no_tumble_dry: configured.icon_no_tumble_dry,
        icon_eac: configured.icon_eac,
      })
    }
    setProductPrintOverrides(nextOverrides)
    setImportCustomNames(new Map([...nextOverrides.entries()].flatMap(([productId, value]) => value.name ? [[productId, value.name] as const] : [])))
    showToast('Настройки печати сохранены', 'success')
  }

  const openBundleCreatorFromPrint = (templates: StickerTemplate[]) => {
    const selectedKeys = new Set(templates.map((template) => template.id))
    setImportSelected(selectedKeys)
    setImportBundleQties(Object.fromEntries(templates.map((template) => [template.id, template.copies])))
    setImportBundlePrintDrafts(new Map(templates.map((template) => [template.id, template])))
    setImportBundleName(`Набор ${new Date().toLocaleDateString('ru-RU')}`)
    setImportBundleError(null)
    setPrintSetup(null)
    setImportBundleModalOpen(true)
  }

  const buildSelectedStickers = (): StickerTemplate[] => {
    const stickers: StickerTemplate[] = []
    for (const product of importProducts) {
      const rows = getSizeRowsImp(product)
      for (const row of rows) {
        if (!importSelected.has(row.rowKey) || row.barcode === '—') continue
        stickers.push({
          id: row.rowKey,
          account_id: '',
          barcode: row.barcode,
          name: importCustomNames.get(product.id) ?? product.name ?? product.vendor_code ?? row.barcode,
          composition: product.composition ?? null,
          article: String(product.nm_id),
          seller_article: product.vendor_code,
          brand: product.brand ?? null,
          size: row.techSize !== '—' ? row.techSize : null,
          color: product.color ?? null,
          supplier: importStore?.supplier_full ?? importStore?.supplier ?? null,
          supplier_address: importStore?.address ?? null,
          production_date: globalProductionDate || null,
          country: product.country ?? importStore?.country ?? '',
          copies: 1,
          icon_wash: globalIcons.wash,
          icon_iron: globalIcons.iron,
          icon_no_bleach: globalIcons.no_bleach,
          icon_no_tumble_dry: globalIcons.no_tumble_dry,
          icon_eac: globalIcons.eac,
          created_at: '',
          store_id: selectedStoreId,
          product_id: product.id,
          nm_id: product.nm_id,
          available_colors: getWbColors(product.color),
        })
      }
    }
    return stickers
  }

  const handleImportCreate = () => {
    const init: Record<string, number> = {}
    allImportSizeRows
      .filter((r) => importSelected.has(r.rowKey) && r.barcode !== '—')
      .forEach((r) => { init[r.rowKey] = 1 })
    if (Object.keys(init).length === 0) return
    setImportBundleQties(init)
    setImportBundlePrintDrafts(new Map())
    const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    setImportBundleName(`Партия ${today}`)
    setImportBundleError(null)
    setImportBundleModalOpen(true)
  }

  const handleSaveImportBundle = async () => {
    if (!importBundleName.trim()) return
    setIsImporting(true)
    setImportBundleError(null)
    try {
      const bundleItems: StickerBundleItem[] = []
      for (const product of importProducts) {
        const rows = getSizeRowsImp(product)
        for (const row of rows) {
          if (!importSelected.has(row.rowKey) || row.barcode === '—') continue
          const copies = importBundleQties[row.rowKey] ?? 1
          const printDraft = importBundlePrintDrafts.get(row.rowKey)
          try {
            const result = await onAdd({
              barcode: row.barcode,
              name: printDraft?.name ?? importCustomNames.get(product.id) ?? product.name ?? product.vendor_code ?? row.barcode,
              article: printDraft?.article ?? String(product.nm_id),
              seller_article: printDraft?.seller_article ?? product.vendor_code ?? '',
              brand: printDraft?.brand ?? product.brand ?? '',
              size: printDraft?.size ?? (row.techSize !== '—' ? row.techSize : ''),
              color: printDraft?.color ?? product.color ?? '',
              composition: printDraft?.composition ?? product.composition ?? '',
              supplier: printDraft?.supplier ?? importStore?.supplier_full ?? importStore?.supplier ?? '',
              supplier_address: printDraft?.supplier_address ?? importStore?.address ?? '',
              production_date: printDraft?.production_date ?? (globalProductionDate || ''),
              country: printDraft?.country ?? product.country ?? importStore?.country ?? '',
              copies: 1,
              icon_wash: printDraft?.icon_wash ?? globalIcons.wash,
              icon_iron: printDraft?.icon_iron ?? globalIcons.iron,
              icon_no_bleach: printDraft?.icon_no_bleach ?? globalIcons.no_bleach,
              icon_no_tumble_dry: printDraft?.icon_no_tumble_dry ?? globalIcons.no_tumble_dry,
              icon_eac: printDraft?.icon_eac ?? globalIcons.eac,
              store_id: selectedStoreId,
              product_id: product.id,
              nm_id: product.nm_id,
            }) as { id: string } | undefined
            if (result?.id) bundleItems.push({ sticker_id: result.id, copies })
          } catch {
            // пропускаем дубли
          }
        }
      }
      if (bundleItems.length === 0) {
        setImportBundleError('Все выбранные стикеры уже существуют')
        return
      }
      await onAddBundle(importBundleName.trim(), bundleItems)
      setImportBundleModalOpen(false)
      setImportSelected(new Set())
      setImportBundlePrintDrafts(new Map())
    } catch (err) {
      setImportBundleError(err instanceof Error ? err.message : 'Ошибка создания')
    } finally {
      setIsImporting(false)
    }
  }

  const storesWithKey = stores.filter((s) => s.api_key)

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
    <div className="flex flex-col gap-4">
      {/* ── Главные табы страницы */}
      <div className="flex gap-6 border-b border-slate-200">
        <button
          type="button"
          onClick={() => handleMainTab('stickers')}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mainTab === 'stickers' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          Стикеры
        </button>
        <button
          type="button"
          onClick={() => handleMainTab('stickers2')}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mainTab === 'stickers2' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          КИЗы
        </button>
        {isAdmin && (
        <button
          type="button"
          onClick={() => handleMainTab('stickers3')}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mainTab === 'stickers3' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          Гайд
        </button>
        )}
      </div>

      {mainTab === 'stickers2' && (
        <KizPage stores={stores} selectedStoreId={selectedStoreId} onStoreChange={onStoreChange} isAdmin={isAdmin} />
      )}

      {isAdmin && mainTab === 'stickers3' && <KizGuidePage />}

      {mainTab === 'stickers' && <div className="space-y-4">
      {printSetup && (
        <StickerPrintSettingsModal
          open
          title={printSetup.title}
          groups={printSetup.groups}
          showColorTabs={printSetup.showColorTabs}
          allowCreateBundle={printSetup.allowCreateBundle}
          onClose={() => setPrintSetup(null)}
          onRemember={rememberPrintGroups}
          onCreateBundle={openBundleCreatorFromPrint}
          onPrint={(configured) => {
            const action = printSetup.onPrint
            setPrintSetup(null)
            action(configured)
          }}
        />
      )}
      {/* ── Pre-print модал: проверка незаполненных полей ── */}
      {prePrintModal && (() => {
        const missing = getMissingFields(prePrintModal.stickers)
        const isMultiple = prePrintModal.stickers.length > 1
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPrePrintModal(null)}>
            <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-start gap-3 px-6 pt-6 pb-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-100">
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">Не все поля заполнены</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {isMultiple
                      ? `У части стикеров (${prePrintModal.stickers.length} шт.) отсутствуют данные:`
                      : 'У стикера отсутствуют данные:'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {missing.map(({ label }) => (
                      <span key={label} className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{label}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Разовый редактор */}
              <div className="border-t border-slate-100 px-6 py-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{isMultiple ? 'Редактирование (применится ко всем)' : 'Разовое редактирование'}</p>
                  <div className="space-y-2">
                    {missing.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-xs text-slate-500">{label}</span>
                        <input
                          type={key === 'production_date' ? 'date' : 'text'}
                          value={(prePrintEdits[key] as string) ?? (prePrintModal.stickers[0][key] as string) ?? ''}
                          onChange={(e) => setPrePrintEdits((p) => ({ ...p, [key]: e.target.value }))}
                          placeholder={key === 'production_date' ? '' : `Введите ${label.toLowerCase()}...`}
                          className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 [color-scheme:light]"
                        />
                      </div>
                    ))}
                  </div>
              </div>

              {/* Кнопки */}
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setPrePrintModal(null)}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isRememberingMissing}
                  onClick={() => {
                    const edited = prePrintModal.stickers.map((sticker) => ({ ...sticker, ...prePrintEdits }))
                    const first = edited[0]
                    const groups = buildPrintGroups(edited).map((group) => ({
                      ...group,
                      name: (prePrintEdits.name as string | undefined) ?? group.name,
                      composition: (prePrintEdits.composition as string | undefined) ?? group.composition,
                      brand: (prePrintEdits.brand as string | undefined) ?? group.brand,
                      color: (prePrintEdits.color as string | undefined) ?? group.color,
                      supplier: first?.supplier ?? group.supplier,
                      supplierAddress: first?.supplier_address ?? group.supplierAddress,
                      productionDate: first?.production_date ?? group.productionDate,
                      country: first?.country ?? group.country,
                    }))
                    setIsRememberingMissing(true)
                    void rememberPrintGroups(groups)
                      .catch((error) => showToast(error instanceof Error ? error.message : 'Не удалось сохранить настройки', 'error'))
                      .finally(() => setIsRememberingMissing(false))
                  }}
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                >
                  {isRememberingMissing ? 'Сохранение…' : 'Запомнить настройки'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const stickers = prePrintModal.stickers.map((s) => ({ ...s, ...prePrintEdits }))
                    setPrePrintModal(null)
                    prePrintModal.onPrint(stickers)
                  }}
                  className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                    Печать
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Плавающее предупреждение о большом количестве стикеров ── */}
      {activeTab === 'import' && importSelected.size > BULK_PDF_WARN_THRESHOLD && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl bg-amber-500 px-5 py-3 shadow-xl shadow-amber-200/60 ring-1 ring-amber-400/40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-sm font-medium text-white">
              Выбрано <span className="font-bold">{importSelected.size}</span> стикеров — генерация PDF может замедлить браузер
            </span>
          </div>
        </div>
      )}
      {/* ── Верхняя панель ─────────────────────────────────── */}
      <Card className="rounded-3xl p-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Левая часть: поиск или дропдаун магазина */}
          {activeTab === 'import' ? (
            <div className="flex flex-1 items-center gap-3">
              {storesWithKey.length === 0 ? (
                <p className="text-xs text-slate-400">Нет магазинов с API ключом</p>
              ) : (
                <FbsStoreSelect
                  value={selectedStoreId}
                  stores={storesWithKey}
                  onChange={onStoreChange}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                className={[
                  '!h-10 !w-10 !min-w-10 !rounded-2xl !px-0',
                  importAnyExpanded
                    ? '!bg-[#E3EAF6] !text-slate-700 hover:!bg-[#E3EAF6]'
                    : '!text-slate-500',
                ].join(' ')}
                onClick={handleImportToggleAll}
                aria-pressed={importAnyExpanded}
                aria-label={importAnyExpanded ? 'Свернуть список' : 'Развернуть список'}
                title={importAnyExpanded ? 'Свернуть список' : 'Развернуть список'}
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
                  {importAnyExpanded ? (
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
              </Button>
              <div className="relative min-w-[240px] flex-1">
                <svg
                  viewBox="0 0 24 24"
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="Поиск по названию, артикулу, бренду, размеру, баркоду..."
                  value={importSearch}
                  onChange={(event) => setImportSearch(event.target.value)}
                  className="h-10 w-full rounded-2xl border border-transparent bg-slate-100 pl-9 pr-10 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                {importSearch && (
                  <button
                    type="button"
                    onClick={() => setImportSearch('')}
                    title="Очистить поиск"
                    aria-label="Очистить поиск"
                    className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                )}
              </div>
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
              <Button variant="secondary" disabled={isPrinting || stickers.length === 0} onClick={handlePrint} className="flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {isPrinting ? 'Генерация…' : `Скачать PDF${selected.size > 0 ? ` (${printCount})` : ''}`}
              </Button>
            </>
          ) : null}

          {activeTab === 'import' && (
            <div className="flex shrink-0 items-center gap-2.5">
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 rounded-2xl px-4 py-2.5"
                disabled={!selectedStoreId || isSyncingImport}
                onClick={() => void handleImportSync()}
              >
                {isSyncingImport ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Синхронизация...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 8v-4" />
                      <path d="M3 16v4" />
                    </svg>
                    Синхронизировать
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Дата производства — глобальная для всех вкладок */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => dateInputRef.current?.showPicker()}
              className="inline-flex items-center gap-2 rounded-[18px] border border-transparent bg-[#F3F6FD] px-4 py-2.5 text-sm font-medium leading-none text-slate-900 transition-colors hover:bg-[#E9EEF8]"
            >
              <span className="text-slate-500">Дата производства:</span>
              <span className={`inline-block w-[5.5rem] tabular-nums ${globalProductionDate ? 'text-slate-900' : 'text-slate-400'}`}>
                {globalProductionDate
                  ? (() => { const [y, m, d] = globalProductionDate.split('-'); return `${d}.${m}.${y}` })()
                  : 'дд.мм.гггг'}
              </span>
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value={globalProductionDate}
              onChange={(e) => setGlobalProductionDate(e.target.value)}
              className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
              tabIndex={-1}
            />
          </div>

          {/* Иконки — дропдаун */}
          <div ref={iconsDropdownRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIconsDropdownOpen((o) => !o)}
              title="Иконки на стикере"
              className={[
                'flex h-10 items-center gap-2 rounded-2xl border px-4 text-sm font-medium transition',
                Object.values(globalIcons).some(Boolean)
                  ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
              ].join(' ')}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Иконки
              <svg viewBox="0 0 24 24" className={`h-3 w-3 shrink-0 transition-transform ${iconsDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {iconsDropdownOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Иконки на стикере</div>
                {([
                  { key: 'eac',           icon: '/eac.svg',                 label: 'Знак ЕАС' },
                  { key: 'wash',          icon: '/icons/wash-30.svg',      label: 'Стирка 30°' },
                  { key: 'iron',          icon: '/icons/iron.svg',          label: 'Утюг' },
                  { key: 'no_bleach',     icon: '/icons/no-bleach.svg',     label: 'Не отбеливать' },
                  { key: 'no_tumble_dry', icon: '/icons/no-tumble-dry.svg', label: 'Не сушить в барабане' },
                ] as { key: keyof typeof globalIcons; icon: string; label: string }[]).map(({ key, icon, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleGlobalIcon(key)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50 ${globalIcons[key] ? 'bg-blue-50/60' : ''}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      globalIcons[key] ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white'
                    }`}>
                      {globalIcons[key] && (
                        <svg viewBox="0 0 24 24" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </span>
                    <img src={icon} alt={label} className="h-7 w-7 object-contain" />
                    <span className={`text-sm ${globalIcons[key] ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Создать набор — для наборов и импорта крайняя правая */}
          {activeTab === 'bundles' && canManage && (
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
          )}
          {activeTab === 'import' && (
            <Button className="shrink-0 rounded-2xl px-5 py-2.5" disabled={isImporting || importSelected.size === 0} onClick={() => handleImportCreate()}>
              {isImporting ? 'Создание…' : `Создать набор${importSelected.size > 0 ? ` (${importSelected.size})` : ''}`}
            </Button>
          )}

          {/* + Создать стикер — крайняя правая */}
          {activeTab === 'stickers' && canManage && (
            <Button onClick={() => { setEditingSticker(null); setModalOpen(true) }} className="shrink-0 rounded-2xl px-5 py-2.5">
              + Создать стикер
            </Button>
          )}
        </div>
        {activeTab === 'import' && importSyncError && (
          <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{importSyncError}</p>
        )}
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
            disabled={!canImport}
            className={`text-sm font-semibold transition-colors ${activeTab === 'import' ? 'text-slate-900' : 'text-slate-300 hover:text-slate-900'} ${!canImport ? 'cursor-not-allowed opacity-40' : ''}`}
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
                <p className="text-xs text-slate-400">Нажмите «Синхронизировать» выше, чтобы загрузить товары из WB</p>
              </div>
            ) : filteredImportProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                <p className="text-sm text-slate-500">Ничего не найдено</p>
                <p className="text-xs text-slate-400">Измените запрос или очистите поле поиска</p>
              </div>
            ) : (
              <>
              <div className="max-h-[calc(100vh-16rem)] overflow-auto [scrollbar-gutter:stable]">
                <table className="w-full min-w-[1500px] text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="w-8 px-3 py-2.5" />
                      <th className="w-9 px-3 py-2.5">
                        {visibleImportSizeRows.length > 0 && (
                          <input
                            type="checkbox"
                            checked={visibleImportSizeRows.every((r) => importSelected.has(r.rowKey))}
                            onChange={(event) => setImportSelected((previous) => {
                              const next = new Set(previous)
                              visibleImportSizeRows.forEach((row) => event.target.checked ? next.add(row.rowKey) : next.delete(row.rowKey))
                              return next
                            })}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                          />
                        )}
                      </th>
                      <th className="w-12 px-2 py-2.5" />
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул WB</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул продавца</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Название</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Для стикера</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Бренд</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Цвет</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Состав</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Страна</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Предмет</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Категория</th>
                      <th className="sticky right-0 z-30 w-20 border-l border-slate-200 bg-slate-50 px-3 py-2.5 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                        {importSelected.size > 0 && (
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              title={`Открыть для печати выбранные (${importSelected.size})`}
                              onClick={() => {
                              const s = buildSelectedStickers()
                              if (s.length === 0) return
                              if (s.length > BULK_PDF_WARN_THRESHOLD) {
                                showToast(`Выбрано ${s.length} стикеров — генерация может занять некоторое время`, 'info')
                              }
                              openPrintSettings(s, { showColorTabs: true, onPrint: (configured) => previewWithCheck(configured, previewStickerPdf) })
                            }}
                              className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              title={`Скачать PDF выбранных (${importSelected.size})`}
                              onClick={() => {
                              const s = buildSelectedStickers()
                              if (s.length === 0) return
                              if (s.length > BULK_PDF_WARN_THRESHOLD) {
                                showToast(`Выбрано ${s.length} стикеров — генерация может занять некоторое время`, 'info')
                              }
                              openPrintSettings(s, { showColorTabs: true, onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf) })
                            }}
                              className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </th>
                    </tr>
                  </thead>
                  {filteredImportProducts.map((product) => {
                    const sizeRows = getSizeRowsImp(product)
                    const hasBarcodeMatch = sizeRows.some((row) => importSearchResult.barcodeMatchRowKeys.has(row.rowKey))
                    const isExpanded = importExpandAll || importExpandedIds.has(product.id) || hasBarcodeMatch
                    const isSearchResult = Boolean(importSearch.trim())
                    const productRowKeys = sizeRows.map((r) => r.rowKey)
                    const allProductSelected = productRowKeys.length > 0 && productRowKeys.every((k) => importSelected.has(k))
                    const photos = product.photos as Array<{ c246x328?: string; big?: string }> | null
                    const photoUrl = photos?.[0]?.c246x328 ?? photos?.[0]?.big ?? null
                    return (
                      <tbody key={product.id} className="divide-y divide-slate-50">
                        <tr
                          className={`cursor-pointer align-middle transition-colors duration-150 ${
                            isSearchResult
                              ? hasBarcodeMatch
                                ? 'bg-blue-50/80 shadow-[inset_3px_0_0_#3b82f6] hover:bg-blue-50'
                                : 'bg-blue-50/40 shadow-[inset_3px_0_0_#bfdbfe] hover:bg-blue-50/70'
                              : 'hover:bg-slate-50'
                          }`}
                          onClick={() => setImportExpandedIds((prev) => { const n = new Set(prev); n.has(product.id) ? n.delete(product.id) : n.add(product.id); setImportAnyExpanded(n.size > 0); return n })}
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
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            <a
                              href={`https://www.wildberries.ru/catalog/${product.nm_id}/detail.aspx`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-500 hover:underline"
                            >
                              {product.nm_id}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">{product.vendor_code ?? '—'}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{product.name ?? '—'}</td>
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={importCustomNames.get(product.id) ?? ''}
                              onChange={(e) => setImportCustomNames((prev) => {
                                const n = new Map(prev)
                                if (e.target.value) n.set(product.id, e.target.value)
                                else n.delete(product.id)
                                return n
                              })}
                              placeholder={product.name ?? ''}
                              className="w-full min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder-slate-300 focus:border-blue-400 focus:outline-none focus:ring-0"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">{product.brand ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{product.color ?? '—'}</td>
                          <td className="max-w-[160px] truncate px-4 py-3 text-xs text-slate-500" title={product.composition ?? ''}>{product.composition ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{product.country ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-400">{product.category ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-slate-400">{(product as any).category_parent ?? '—'}</td>
                          <td className={`sticky right-0 z-10 border-l border-slate-100 px-3 py-3 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)] ${isSearchResult ? 'bg-blue-50' : 'bg-white'}`} onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const productStickers: StickerTemplate[] = sizeRows
                                .filter((r) => r.barcode !== '—')
                                .map((r) => ({
                                  id: r.rowKey,
                                  account_id: '',
                                  barcode: r.barcode,
                                  name: importCustomNames.get(product.id) ?? product.name ?? product.vendor_code ?? r.barcode,
                                  composition: product.composition ?? null,
                                  article: String(product.nm_id),
                                  seller_article: product.vendor_code,
                                  brand: product.brand ?? null,
                                  size: r.techSize !== '—' ? r.techSize : null,
                                  color: product.color ?? null,
                                  supplier: importStore?.supplier_full ?? importStore?.supplier ?? null,
                                  supplier_address: importStore?.address ?? null,
                                  production_date: globalProductionDate || null,
                                  country: product.country ?? importStore?.country ?? '',
                                  copies: 1,
                                  icon_wash: globalIcons.wash,
                                  icon_iron: globalIcons.iron,
                                  icon_no_bleach: globalIcons.no_bleach,
                                  icon_no_tumble_dry: globalIcons.no_tumble_dry,
                                  icon_eac: globalIcons.eac,
                                  created_at: '',
                                  store_id: selectedStoreId,
                                  product_id: product.id,
                                  nm_id: product.nm_id,
                                  available_colors: getWbColors(product.color),
                                }))
                              if (productStickers.length === 0) return null
                              return (
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    title={`Открыть для печати (${productStickers.length} стикеров)`}
                                    onClick={() => openPrintSettings(productStickers, {
                                      title: `Печать товара ${product.nm_id}`,
                                      startUnchecked: true,
                                      allowCreateBundle: true,
                                      onPrint: (configured) => previewWithCheck(configured, previewStickerPdf),
                                    })}
                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    title={`Скачать PDF (${productStickers.length} стикеров)`}
                                    onClick={() => openPrintSettings(productStickers, {
                                      title: `Печать товара ${product.nm_id}`,
                                      startUnchecked: true,
                                      allowCreateBundle: true,
                                      onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf),
                                    })}
                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="7 10 12 15 17 10" />
                                      <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                  </button>
                                </div>
                              )
                            })()}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-0" colSpan={14}>
                            <div style={{ display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
                              <div className="overflow-hidden">
                                <div className="border-t border-slate-100 bg-slate-50/70">
                                  <table className="min-w-full text-[13px]">
                                    <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                                      <tr>
                                        <th className="w-9 px-3 py-2" />
                                        <th className="px-4 py-2 font-semibold" colSpan={2}>Размер</th>
                                        <th className="px-4 py-2 font-semibold" colSpan={2}>Баркод</th>
                                        <th className="sticky right-0 z-10 w-20 border-l border-slate-200 bg-slate-50 px-3 py-2" />
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100/80">
                                      {sizeRows.map((row) => {
                                        const isSearchMatch = importSearchResult.matchingRowKeys.has(row.rowKey)
                                        const isBarcodeMatch = importSearchResult.barcodeMatchRowKeys.has(row.rowKey)
                                        const isSelected = importSelected.has(row.rowKey)
                                        return (
                                        <tr key={row.rowKey} className={`align-middle transition-colors ${isBarcodeMatch ? 'bg-blue-100/70 ring-1 ring-inset ring-blue-300' : isSelected && isSearchMatch ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : isSelected ? 'bg-blue-50/50' : isSearchMatch ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : ''}`}>
                                          <td className="select-none px-3 py-2"
                                            onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); startSweep('import', row.rowKey, importSelected.has(row.rowKey)) } }}
                                            onMouseEnter={() => continueSweep('import', row.rowKey)}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={importSelected.has(row.rowKey)}
                                              onChange={() => setImportSelected((prev) => { const n = new Set(prev); n.has(row.rowKey) ? n.delete(row.rowKey) : n.add(row.rowKey); return n })}
                                              className="pointer-events-none h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                                            />
                                          </td>
                                          <td colSpan={2} className="px-4 py-2">
                                            {row.techSize !== '—' ? (
                                              <span className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{row.techSize}</span>
                                            ) : (
                                              <span className="text-xs text-slate-300">—</span>
                                            )}
                                          </td>
                                          <td colSpan={2} className={`px-4 py-2 font-mono text-xs ${isBarcodeMatch ? 'font-semibold text-blue-700' : 'text-slate-500'}`}>{row.barcode}</td>
                                          <td className={`sticky right-0 z-10 border-l border-slate-100 px-3 py-2 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)] ${isBarcodeMatch ? 'bg-blue-100' : isSearchMatch || isSelected ? 'bg-blue-50' : 'bg-slate-50'}`}>
                                            {row.barcode !== '—' && (() => {
                                              const tempSticker: StickerTemplate = {
                                                id: row.rowKey,
                                                account_id: '',
                                                barcode: row.barcode,
                                                name: importCustomNames.get(product.id) ?? product.name ?? product.vendor_code ?? row.barcode,
                                                composition: product.composition ?? null,
                                                article: String(product.nm_id),
                                                seller_article: product.vendor_code,
                                                brand: product.brand ?? null,
                                                size: row.techSize !== '—' ? row.techSize : null,
                                                color: product.color ?? null,
                                                supplier: importStore?.supplier_full ?? importStore?.supplier ?? null,
                                                supplier_address: importStore?.address ?? null,
                                                production_date: globalProductionDate || null,
                                                country: product.country ?? importStore?.country ?? '',
                                                copies: 1,
                                                icon_wash: globalIcons.wash,
                                                icon_iron: globalIcons.iron,
                                                icon_no_bleach: globalIcons.no_bleach,
                                                icon_no_tumble_dry: globalIcons.no_tumble_dry,
                                                icon_eac: globalIcons.eac,
                                                created_at: '',
                                                store_id: selectedStoreId,
                                                product_id: product.id,
                                                nm_id: product.nm_id,
                                                available_colors: getWbColors(product.color),
                                              }
                                              return (
                                                <div className="flex items-center gap-0.5">
                                                  <button
                                                    type="button"
                                                    title="Открыть стикер для печати"
                                                    onClick={(e) => { e.stopPropagation(); openPrintSettings([tempSticker], { onPrint: (configured) => previewWithCheck(configured, previewStickerPdf) }) }}
                                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                                  >
                                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                                      <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" />
                                                    </svg>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    title="Скачать PDF"
                                                    onClick={(e) => { e.stopPropagation(); openPrintSettings([tempSticker], { onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf) }) }}
                                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                                  >
                                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                      <polyline points="7 10 12 15 17 10" />
                                                      <line x1="12" y1="15" x2="12" y2="3" />
                                                    </svg>
                                                  </button>
                                                </div>
                                              )
                                            })()}
                                          </td>
                                        </tr>
                                        )
                                      })}
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
              </>
            )}
          </div>
        ) : activeTab === 'stickers' ? (
          stickers.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            Стикеров нет. Создайте первый.
          </div>
        ) : (
          <div className="max-h-[calc(100vh-16rem)] overflow-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead className="sticky top-0 z-20 border-b border-slate-100 bg-white text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
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
                  <th className="sticky right-12 z-30 min-w-[124px] border-l border-slate-100 bg-white px-3 py-2 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.4)]" />
                  <th className="sticky right-0 z-30 w-12 bg-white px-2 py-2">
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
                    <td className="px-3 py-2.5 select-none"
                      onMouseDown={(e) => { if (e.button === 0) { e.preventDefault(); startSweep('stickers', s.id, selected.has(s.id)) } }}
                      onMouseEnter={() => continueSweep('stickers', s.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="pointer-events-none h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
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
                    <td className={`sticky right-12 z-10 border-l border-slate-100 px-3 py-2.5 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.4)] ${selected.has(s.id) ? 'bg-blue-50' : 'bg-white'}`}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title="Открыть для печати"
                          onClick={() => openPrintSettings([{ ...s, production_date: globalProductionDate || s.production_date }], { onPrint: (configured) => previewWithCheck(configured, previewStickerPdf) })}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title="Скачать PDF"
                          onClick={() => openPrintSettings([{ ...s, production_date: globalProductionDate || s.production_date }], { onPrint: (configured) => previewWithCheck(configured, downloadStickerPdf) })}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                        {canManage && (
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
                        )}
                      </div>
                    </td>
                    <td className={`sticky right-0 z-10 px-2 py-2.5 ${selected.has(s.id) ? 'bg-blue-50' : 'bg-white'}`}>
                      {canDelete && (
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
                      )}
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
            <div className="max-h-[calc(100vh-16rem)] overflow-auto [scrollbar-gutter:stable]">
              <table className="w-full min-w-[800px] text-[13px]">
                <thead className="sticky top-0 z-20 border-b border-slate-100 bg-white text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Название</th>
                    <th className="px-4 py-2">Стикеров</th>
                    <th className="px-4 py-2">Копий итого</th>
                    <th className="px-4 py-2">Создан</th>
                    <th className="sticky right-0 z-30 min-w-[168px] border-l border-slate-100 bg-white px-4 py-2 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.4)]" />
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
                        <td className="sticky right-0 z-10 border-l border-slate-100 bg-white px-4 py-2.5 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.4)]">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              title="Открыть для печати"
                              onClick={() => handlePreviewBundle(b)}
                              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /><path d="M18 12h.01" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              title="Скачать PDF"
                              onClick={() => handlePrintBundle(b)}
                              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                            </button>
                            {canManage && (
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
                            )}
                            {canDelete && (
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
                            )}
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

      {/* Модалка создания набора из Импорт WB (сначала настройка, потом создание) */}
      <Modal open={importBundleModalOpen} onClose={() => { if (!isImporting) { setImportBundleModalOpen(false); setImportBundlePrintDrafts(new Map()) } }} title="Создать набор">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Название набора</label>
            <input
              type="text"
              autoFocus
              placeholder="Например: Партия апрель 2026"
              value={importBundleName}
              onChange={(e) => setImportBundleName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
            />
          </div>

          {/* Список размеров/баркодов с кол-вом */}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-[13px]">
              <thead className="sticky top-0 border-b border-slate-100 bg-white text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Наименование</th>
                  <th className="px-3 py-2 text-left">Размер</th>
                  <th className="px-3 py-2 text-left">Баркод</th>
                  <th className="w-24 px-3 py-2 text-center">Кол-во</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {importProducts.flatMap((product) =>
                  getSizeRowsImp(product)
                    .filter((row) => importSelected.has(row.rowKey) && row.barcode !== '—')
                    .map((row) => (
                      <tr key={row.rowKey} className="hover:bg-slate-50/60">
                        <td className="max-w-[180px] truncate px-3 py-2.5 font-medium text-slate-800">
                          {importCustomNames.get(product.id) ?? product.name ?? product.vendor_code ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{row.techSize !== '—' ? row.techSize : '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{row.barcode}</td>
                        <td className="px-3 py-2.5">
                          <input
                            type="number"
                            min={1}
                            max={9999}
                            value={importBundleQties[row.rowKey] ?? 1}
                            onChange={(e) => {
                              const v = Math.max(1, parseInt(e.target.value) || 1)
                              setImportBundleQties((prev) => ({ ...prev, [row.rowKey]: v }))
                            }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400"
                          />
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {importBundleError && <p className="text-xs text-rose-500">{importBundleError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setImportBundleModalOpen(false); setImportBundlePrintDrafts(new Map()) }} disabled={isImporting}>
              Отмена
            </Button>
            <Button type="button" disabled={!importBundleName.trim() || isImporting} onClick={() => void handleSaveImportBundle()}>
              {isImporting ? 'Создание…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </Modal>

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
      </div>}
    </div>
  )
}
