import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { PhotoThumb } from '../ui/PhotoThumb'
import {
  fetchKizOrderSources,
  kizPhotoUrl,
  kizProductMatches,
  kizSizeRows,
  type KizBarcodeLink,
  type KizGtinCard,
  type KizWbProduct,
} from '../../services/kizLinkService'

export type KizOrderLine = {
  gtin: string
  quantity: number
  label: string
  group: string | null
}

const MAX_CODES = 5000

function readQuantity(raw: string): { skip: boolean; value: number | null; error: string | null } {
  const text = raw.trim()
  if (!text || text === '0') return { skip: true, value: null, error: null }
  if (!/^\d+$/.test(text)) return { skip: false, value: null, error: 'Количество должно быть целым числом.' }
  const value = Number(text)
  if (value > MAX_CODES) return { skip: false, value: null, error: `Для одного GTIN можно заказать не больше ${MAX_CODES} кодов.` }
  if (value < 1) return { skip: true, value: null, error: null }
  return { skip: false, value, error: null }
}

export function KizOrderModal({
  open,
  storeId,
  initialGtin,
  ordering,
  error,
  success,
  onClose,
  onOrder,
  onShowOperations,
}: {
  open: boolean
  storeId: string
  initialGtin: string
  ordering: boolean
  error: string | null
  success: string | null
  onClose: () => void
  onOrder: (lines: KizOrderLine[]) => Promise<{ ok: string[] }>
  onShowOperations: () => void
}) {
  const [products, setProducts] = useState<KizWbProduct[]>([])
  const [links, setLinks] = useState<KizBarcodeLink[]>([])
  const [gtins, setGtins] = useState<KizGtinCard[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [directGtin, setDirectGtin] = useState('')
  const [directQty, setDirectQty] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setListOpen(false)
    setSelectedIds([])
    setQuantities({})
    setDirectGtin(initialGtin.replace(/\D/g, ''))
    setDirectQty('')
    setLoading(true)
    setLoadError(null)
    void fetchKizOrderSources(storeId)
      .then((sources) => {
        setProducts(sources.products)
        setLinks(sources.links)
        setGtins(sources.gtins)
      })
      .catch((loadFailure: unknown) => {
        setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Не удалось открыть заказ.')
      })
      .finally(() => setLoading(false))
  }, [open, storeId, initialGtin])

  const linkByBarcode = useMemo(() => new Map(links.map((link) => [link.wb_barcode, link.gtin])), [links])
  const cardByGtin = useMemo(() => new Map(gtins.map((card) => [card.gtin, card])), [gtins])
  const selected = selectedIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is KizWbProduct => Boolean(product))
  const found = products.filter((product) => !selectedIds.includes(product.id) && kizProductMatches(product, query)).slice(0, 40)

  const draft = useMemo(() => {
    const lines: KizOrderLine[] = []
    const problems: string[] = []
    selected.forEach((product) => {
      kizSizeRows(product).forEach((row) => {
        const gtin = linkByBarcode.get(row.barcode)
        if (!gtin) return
        const quantity = readQuantity(quantities[row.rowKey] ?? '')
        if (quantity.error) problems.push(`${product.vendor_code || product.nm_id}, размер ${row.techSize}: ${quantity.error}`)
        if (quantity.value) {
          lines.push({
            gtin,
            quantity: quantity.value,
            label: `${product.name || 'Товар'} · ${row.techSize}`,
            group: cardByGtin.get(gtin)?.product_group_code ?? null,
          })
        }
      })
    })
    const typed = directGtin.replace(/\D/g, '')
    const direct = readQuantity(directQty)
    if (direct.error) problems.push(`GTIN ${typed || '—'}: ${direct.error}`)
    if (typed && typed.length < 8) problems.push('GTIN должен содержать от 8 до 14 цифр.')
    if (!typed && !direct.skip) problems.push('Для ручного заказа укажите GTIN.')
    if (typed.length >= 8 && direct.value) {
      lines.push({
        gtin: typed.padStart(14, '0'),
        quantity: direct.value,
        label: `GTIN ${typed.padStart(14, '0')}`,
        group: cardByGtin.get(typed.padStart(14, '0'))?.product_group_code ?? null,
      })
    }
    const seen = new Set<string>()
    const unique = lines.filter((line) => {
      if (seen.has(line.gtin)) {
        problems.push(`GTIN ${line.gtin} указан дважды. Оставьте одно количество.`)
        return false
      }
      seen.add(line.gtin)
      return true
    })
    return { lines: unique, problems }
  }, [selected, quantities, directGtin, directQty, linkByBarcode, cardByGtin])

  const groups = new Map<string, number>()
  draft.lines.forEach((line) => {
    const key = line.group || 'уточнится при заказе'
    groups.set(key, (groups.get(key) ?? 0) + line.quantity)
  })

  return (
    <Modal
      open={open}
      tall
      fill
      onClose={onClose}
      title="Заказ КИЗов"
      footer={(
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 text-xs text-slate-500">
            {Array.from(groups.entries()).map(([group, amount]) => (
              <p key={group}>Группа {group}: {amount} кодов</p>
            ))}
            <p>Каждый GTIN уйдёт отдельной операцией.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Закрыть
            </button>
            <button
              type="button"
              disabled={ordering || draft.lines.length === 0 || draft.problems.length > 0}
              onClick={() => {
                void onOrder(draft.lines).then((result) => {
                  const done = new Set(result.ok)
                  setQuantities((current) => {
                    const next = { ...current }
                    selected.forEach((product) => {
                      kizSizeRows(product).forEach((row) => {
                        const gtin = linkByBarcode.get(row.barcode)
                        if (gtin && done.has(gtin)) delete next[row.rowKey]
                      })
                    })
                    return next
                  })
                  const typed = directGtin.replace(/\D/g, '').padStart(directGtin ? 14 : 0, '0')
                  if (typed && done.has(typed)) setDirectQty('')
                })
              }}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {ordering ? 'Заказываем…' : 'Заказать'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {(loadError || error || success || draft.problems.length > 0) && (
          <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
            {loadError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {success && (
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <p>{success}</p>
                <button type="button" onClick={onShowOperations} className="mt-1 font-semibold underline">Открыть операции</button>
              </div>
            )}
            {draft.problems.length > 0 && (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {draft.problems.map((problem) => <p key={problem}>{problem}</p>)}
              </div>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[40%] min-w-0 flex-col gap-4 overflow-hidden border-r border-slate-200 p-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              GTIN
              <input
                value={directGtin}
                onChange={(event) => setDirectGtin(event.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder="14 цифр, если заказываете без артикула"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Количество для этого GTIN
              <input
                value={directQty}
                onChange={(event) => setDirectQty(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0"
                inputMode="numeric"
                className="mt-1 w-32 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none placeholder:text-slate-300 focus:border-emerald-400"
              />
            </label>
            <div className="flex min-h-0 flex-1 flex-col">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Артикул</label>
              <input
                value={query}
                onFocus={() => setListOpen(true)}
                onChange={(event) => { setQuery(event.target.value); setListOpen(true) }}
                placeholder="Артикул WB, артикул продавца, баркод или название"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
              />
              {listOpen && (
                <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                  {loading && <p className="px-3 py-2 text-sm text-slate-400">Загружаем товары…</p>}
                  {!loading && found.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>}
                  {found.map((product) => {
                    const hasLink = kizSizeRows(product).some((row) => linkByBarcode.has(row.barcode))
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSelectedIds((current) => [...current, product.id])
                          setQuery('')
                          setListOpen(false)
                        }}
                        className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                      >
                        <PhotoThumb url={kizPhotoUrl(product.photos)} previewZIndex={80} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{product.name || 'Без названия'}</span>
                          <span className="block truncate text-xs text-slate-400">{product.nm_id} · {product.vendor_code || 'без артикула продавца'}</span>
                          {!hasLink && <span className="block text-xs font-medium text-amber-700">Нет связки с GTIN</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
            {selected.length === 0 && <p className="text-sm text-slate-400">Выбранные товары появятся здесь</p>}
            <div className="space-y-3">
              {selected.map((product) => {
                const rows = kizSizeRows(product)
                const linkedCount = rows.filter((row) => linkByBarcode.has(row.barcode)).length
                return (
                  <section key={product.id} className="rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-start gap-3">
                      <PhotoThumb url={kizPhotoUrl(product.photos)} className="h-14 w-11 rounded-lg" previewZIndex={80} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{product.name || 'Без названия'}</p>
                        <p className="truncate text-xs text-slate-400">{product.nm_id} · {product.vendor_code || '—'} · {product.color || 'цвет не указан'}</p>
                        {linkedCount === 0 && <p className="mt-1 text-xs font-medium text-amber-700">Нет связки с GTIN</p>}
                      </div>
                      <button
                        type="button"
                        aria-label="Убрать товар"
                        onClick={() => setSelectedIds((current) => current.filter((id) => id !== product.id))}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {rows.map((row) => {
                        const gtin = linkByBarcode.get(row.barcode)
                        return (
                          <div key={row.rowKey} className="flex items-center gap-3">
                            <div className="min-w-0 flex-1 text-sm">
                              <span className="font-medium text-slate-700">{row.techSize}</span>
                              <span className="ml-2 font-mono text-xs text-slate-400">{row.barcode}</span>
                              {gtin
                                ? <span className="mt-0.5 block font-mono text-xs text-emerald-700">{gtin}</span>
                                : <span className="mt-0.5 block text-xs text-amber-700">Нет связки с GTIN</span>}
                            </div>
                            <input
                              value={quantities[row.rowKey] ?? ''}
                              disabled={!gtin}
                              onChange={(event) => setQuantities((current) => ({ ...current, [row.rowKey]: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                              placeholder="0"
                              inputMode="numeric"
                              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-right text-sm outline-none placeholder:text-slate-300 focus:border-emerald-400 disabled:bg-slate-50"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
