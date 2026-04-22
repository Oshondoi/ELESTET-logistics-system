import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { fetchLastSync, fetchProducts, triggerSync } from '../services/productService'
import type { Product, Store, StoreSyncLog } from '../types'

interface ProductsPageProps {
  stores: Store[]
  activeAccountId: string
  selectedStoreId: string
  onStoreChange: (id: string) => void
}

function formatSyncTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}

// Разбирает sizes из raw WB данных в массив строк-размеров
interface SizeRow {
  techSize: string
  barcode: string
  rowKey: string
}

// Возвращает числовое значение размера для сортировки (больше = крупнее)
const LETTER_SIZE_ORDER: Record<string, number> = {
  'XXS': 1, 'XS': 2, 'S': 3, 'M': 4, 'L': 5, 'XL': 6,
  '2XL': 7, 'XXL': 7, '3XL': 8, 'XXXL': 8, '4XL': 9, '5XL': 10, '6XL': 11,
}
function sizeWeight(techSize: string): number {
  const s = techSize.trim().toUpperCase()
  if (LETTER_SIZE_ORDER[s] !== undefined) return LETTER_SIZE_ORDER[s]
  const n = parseFloat(s)
  if (!isNaN(n)) return n
  return -1
}

function getSizeRows(product: Product): SizeRow[] {
  const sizes = (product.sizes ?? []) as Array<{ techSize?: string; skus?: string[] }>
  if (sizes.length === 0) return [{ techSize: '—', barcode: product.barcodes[0] ?? '—', rowKey: `${product.id}-0` }]
  const rows: SizeRow[] = []
  sizes.forEach((s, si) => {
    const skus = s.skus ?? []
    if (skus.length === 0) {
      rows.push({ techSize: s.techSize ?? '—', barcode: '—', rowKey: `${product.id}-${si}` })
    } else {
      skus.forEach((sku, ki) => {
        rows.push({ techSize: s.techSize ?? '—', barcode: sku, rowKey: `${product.id}-${si}-${ki}` })
      })
    }
  })
  // Сортировка: крупные размеры сверху, мелкие снизу
  return rows.sort((a, b) => sizeWeight(a.techSize) - sizeWeight(b.techSize))
}

export const ProductsPage = ({ stores, selectedStoreId, onStoreChange }: ProductsPageProps) => {
  const storesWithKey = stores.filter((s) => s.api_key)

  const [products, setProducts] = useState<Product[]>([])
  const [lastSync, setLastSync] = useState<StoreSyncLog | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<{ url: string; x: number; y: number } | null>(null)
  const storeDropdownRef = useRef<HTMLDivElement | null>(null)

  const toggle = (id: string) =>
    setExpandedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleToggleAll = () => {
    if (expandAll) {
      setExpandedIds(new Set())
      setExpandAll(false)
    } else {
      setExpandedIds(new Set(filtered.map((p) => p.id)))
      setExpandAll(true)
    }
  }

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!storeDropdownRef.current?.contains(e.target as Node)) {
        setStoreDropdownOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const selectedStore = stores.find((s) => s.id === selectedStoreId)

  const loadProducts = useCallback(async (storeId: string) => {
    if (!storeId) return
    setIsLoadingProducts(true)
    try {
      const [prods, log] = await Promise.all([fetchProducts(storeId), fetchLastSync(storeId)])
      setProducts(prods)
      setLastSync(log)
    } catch {
      // silent — покажем пустой список
    } finally {
      setIsLoadingProducts(false)
    }
  }, [])

  useEffect(() => {
    void loadProducts(selectedStoreId)
    setSearch('')
    setSyncError(null)
  }, [selectedStoreId, loadProducts])

  const handleSync = async () => {
    if (!selectedStoreId) return
    setIsSyncing(true)
    setSyncError(null)
    try {
      await triggerSync(selectedStoreId)
      await loadProducts(selectedStoreId)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Ошибка синхронизации')
    } finally {
      setIsSyncing(false)
    }
  }

  const filtered = products.filter((p) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.name?.toLowerCase().includes(q) ||
      p.vendor_code?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      String(p.nm_id).includes(q) ||
      p.barcodes.some((b) => b.includes(q))
    )
  })

  // Нет магазинов с API ключом
  if (storesWithKey.length === 0) {
    return (
      <Card className="rounded-3xl">
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">API ключ не настроен</p>
            <p className="mt-1 text-xs text-slate-400">
              Добавьте API ключ Wildberries в настройках магазина, чтобы синхронизировать товары
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Панель управления ─────────────────────────────────── */}
      <Card className="rounded-3xl p-2.5">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          {/* Выбор магазина + поиск */}
          <div className="flex flex-1 items-center gap-2">
            {/* Store selector — кастомный дропдаун */}
            <div ref={storeDropdownRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setStoreDropdownOpen((o) => !o)}
                className="flex h-10 items-center gap-2 rounded-2xl bg-slate-100 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                <span>{selectedStore?.name ?? '—'}</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3.5 w-3.5 text-slate-400 transition-transform ${storeDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {storeDropdownOpen && (
                <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                  {storesWithKey.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { onStoreChange(s.id); setStoreDropdownOpen(false) }}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                        s.id === selectedStoreId ? 'font-semibold text-blue-600' : 'text-slate-700'
                      }`}
                    >
                      {s.id === selectedStoreId && (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                      {s.id !== selectedStoreId && <span className="h-3.5 w-3.5 shrink-0" />}
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Кнопка раскрыть/свернуть все */}
            <button
              type="button"
              onClick={handleToggleAll}
              aria-pressed={expandAll}
              aria-label={expandAll ? 'Свернуть все товары' : 'Развернуть все товары'}
              title={expandAll ? 'Свернуть все товары' : 'Развернуть все товары'}
              className={[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition',
                expandAll
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
                {expandAll ? (
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

            <div className="relative flex-1">
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
                placeholder="Поиск по названию, артикулу, бренду, баркоду..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-2xl border border-transparent bg-slate-100 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Последняя синхронизация + кнопка */}
          <div className="flex items-center gap-3">
            {lastSync && (
              <span className="text-xs text-slate-400">
                {lastSync.status === 'error' ? (
                  <span className="text-rose-400">Ошибка синхронизации</span>
                ) : (
                  <>Синхронизировано: {formatSyncTime(lastSync.synced_at)}</>
                )}
              </span>
            )}
            <Button
              variant="secondary"
              className="rounded-2xl px-4 py-2.5"
              disabled={isSyncing}
              onClick={() => void handleSync()}
            >
              {isSyncing ? (
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
        </div>

        {syncError && (
          <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{syncError}</p>
        )}
      </Card>

      {/* ── Таблица товаров ───────────────────────────────────── */}
      <Card className="overflow-hidden rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <span className="text-sm font-semibold text-slate-900">
            Товары
            {!isLoadingProducts && (
              <span className="ml-2 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {filtered.length}
              </span>
            )}
            {!isLoadingProducts && (
              <span className="ml-3 text-sm font-semibold text-slate-900">
                Артикул
                <span className="ml-2 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                  {new Set(filtered.map((p) => p.vendor_code).filter(Boolean)).size}
                </span>
              </span>
            )}
          </span>
          {isLoadingProducts && (
            <span className="text-xs text-slate-400">Загрузка...</span>
          )}
        </div>

        {/* Таблица */}
        {!isLoadingProducts && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            {products.length === 0 ? (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-600">Товаров пока нет</p>
                  <p className="mt-0.5 text-xs text-slate-400">Нажмите «Синхронизировать» для загрузки из Wildberries</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">Ничего не найдено</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="w-8 px-3 py-2.5" />
                  <th className="w-12 px-2 py-2.5" />
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул WB</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул продавца</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Название</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Бренд</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Категория</th>
                </tr>
              </thead>
              {filtered.map((product) => {
                const isExpanded = expandAll || expandedIds.has(product.id)
                const sizeRows = getSizeRows(product)
                return (
                  <tbody key={product.id} className="divide-y divide-slate-50">
                    {/* Строка товара */}
                    <tr
                      className="cursor-pointer align-middle transition-colors duration-150 hover:bg-slate-50"
                      onClick={() => toggle(product.id)}
                    >
                      <td className="px-3 py-3 text-slate-400">
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </td>
                      <td className="px-2 py-2">
                        {(() => {
                          const photos = product.photos as Array<{ c246x328?: string; big?: string }> | null
                          const url = photos?.[0]?.c246x328 ?? photos?.[0]?.big ?? null
                          return url ? (
                            <img
                              src={url}
                              alt=""
                              className="h-9 w-9 cursor-zoom-in rounded-lg object-cover"
                              onMouseEnter={(e) => {
                                const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect()
                                const popW = 288
                                const popH = 384
                                const gap = 12
                                // Горизонталь: предпочитаем справа, если не влезает — слева
                                const x = rect.right + gap + popW > window.innerWidth
                                  ? rect.left - gap - popW
                                  : rect.right + gap
                                // Вертикаль: выровнять по верху миниатюры, но не выходить за низ
                                const y = Math.min(rect.top, window.innerHeight - popH - gap)
                                setPhotoPreview({ url, x, y })
                              }}
                              onMouseLeave={() => setPhotoPreview(null)}
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="3" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <path d="m21 15-5-5L5 21" />
                              </svg>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{product.nm_id}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{product.vendor_code ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{product.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{product.brand ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{product.category ?? '—'}</td>
                    </tr>
                    {/* Строки размеров с анимацией (grid-trick как в логистике) */}
                    <tr>
                      <td className="p-0" colSpan={7}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateRows: isExpanded ? '1fr' : '0fr',
                            transition: 'grid-template-rows 220ms ease',
                          }}
                        >
                          <div className="overflow-hidden">
                            <div className="border-t border-slate-100 bg-slate-50/70">
                              <table className="min-w-full text-[13px]">
                                <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                                  <tr>
                                    <th className="w-8 px-3 py-2" />
                                    <th className="px-4 py-2 font-semibold" colSpan={2}>Размер</th>
                                    <th className="px-4 py-2 font-semibold" colSpan={3}>Баркод</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/80">
                                  {sizeRows.map((row) => (
                                    <tr key={row.rowKey} className="align-middle">
                                      <td className="px-3 py-2" />
                                      <td colSpan={2} className="px-4 py-2">
                                        {row.techSize !== '—' ? (
                                          <span className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                                            {row.techSize}
                                          </span>
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
      </Card>
      {/* Превью фото при наведении */}
      {photoPreview && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200"
          style={{ left: photoPreview.x, top: photoPreview.y }}
        >
          <img src={photoPreview.url} alt="" className="h-96 w-72 object-cover" />
        </div>
      )}
    </div>
  )
}
