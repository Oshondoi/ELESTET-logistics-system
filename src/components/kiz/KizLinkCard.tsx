import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '../ui/Modal'
import { PhotoThumb } from '../ui/PhotoThumb'
import { KizLinkExcelDialog } from './KizLinkExcelDialog'
import { planKizLinkWrites } from '../../lib/kizLinkExcel'
import {
  clearKizBarcodeLink,
  fetchKizOrderSources,
  kizPhotoUrl,
  kizProductMatches,
  kizSizeRows,
  saveKizBarcodeLink,
  type KizBarcodeLink,
  type KizGtinCard,
  type KizWbProduct,
} from '../../services/kizLinkService'

function GtinField({
  open,
  query,
  saved,
  draft,
  disabled,
  choices,
  onOpen,
  onQuery,
  onPick,
  onClear,
}: {
  open: boolean
  query: string
  saved: string | null
  draft: string | null
  disabled: boolean
  choices: Array<{ gtin: string; name: string | null; full_name: string | null }>
  onOpen: () => void
  onQuery: (value: string) => void
  onPick: (gtin: string) => void
  onClear?: () => void
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const upward = below < 180 && above > below
      const maxHeight = Math.max(120, Math.min(240, upward ? above : below))
      setPlace({ left: rect.left, top: upward ? rect.top - maxHeight - 4 : rect.bottom + 4, width: rect.width, maxHeight })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open])

  const shown = draft ?? saved ?? ''
  return (
    <div ref={anchorRef} className="relative">
      <input
        value={open ? query : shown}
        disabled={disabled}
        onFocus={onOpen}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Выберите GTIN"
        className={`w-full rounded-xl border px-3 py-2 font-mono text-sm outline-none placeholder:font-sans placeholder:text-slate-300 focus:border-emerald-400 disabled:bg-slate-50 ${saved && !draft ? 'pr-16' : ''} ${draft && draft !== saved ? 'border-amber-300 bg-amber-50' : saved ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200'}`}
      />
      {saved && !draft && onClear && (
        <button type="button" disabled={disabled} onClick={onClear} className="absolute top-1/2 right-2 -translate-y-1/2 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
          Снять
        </button>
      )}
      {open && place && createPortal(
        <div className="fixed z-[80] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl" style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}>
          {choices.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">GTIN не найден</p>}
          {choices.map((card) => (
            <button
              key={card.gtin}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(card.gtin)}
              className="flex w-full flex-col border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
            >
              <span className="truncate text-sm text-slate-800">{card.full_name || card.name || 'Без названия'}</span>
              <span className="font-mono text-xs text-slate-400">{card.gtin}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function KizLinkCard({ storeId, canManage }: { storeId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [products, setProducts] = useState<KizWbProduct[]>([])
  const [links, setLinks] = useState<KizBarcodeLink[]>([])
  const [gtins, setGtins] = useState<KizGtinCard[]>([])
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [gtinQuery, setGtinQuery] = useState('')
  const [openGtinBarcode, setOpenGtinBarcode] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [excelOpen, setExcelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function reload() {
    const sources = await fetchKizOrderSources(storeId)
    setProducts(sources.products)
    setLinks(sources.links)
    setGtins(sources.gtins)
    setCount(sources.links.length)
  }

  useEffect(() => {
    setCount(null)
    void fetchKizOrderSources(storeId)
      .then((sources) => setCount(sources.links.length))
      .catch(() => setCount(null))
  }, [storeId])

  useEffect(() => {
    if (!open) return
    setError(null)
    setQuery('')
    setListOpen(false)
    setSelectedIds([])
    setGtinQuery('')
    setOpenGtinBarcode(null)
    setPending({})
    setExcelOpen(false)
    void reload().catch((loadFailure: unknown) => {
      setError(loadFailure instanceof Error ? loadFailure.message : 'Не удалось открыть связки.')
    })
  }, [open, storeId])

  const linkByBarcode = useMemo(() => new Map(links.map((link) => [link.wb_barcode, link.gtin])), [links])
  const found = products.filter((product) => !selectedIds.includes(product.id) && kizProductMatches(product, query)).slice(0, 40)
  const selected = selectedIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is KizWbProduct => Boolean(product))
  const gtinChoices = gtins.filter((card) => {
    const needle = gtinQuery.trim().toLowerCase()
    if (!needle) return true
    return [card.gtin, card.name, card.full_name].some((value) => (value ?? '').toLowerCase().includes(needle))
  }).slice(0, 30)

  const visibleBarcodes = new Set(selected.flatMap((product) => kizSizeRows(product).map((row) => row.barcode)))
  const desired = Object.entries(pending)
    .filter(([barcode, gtin]) => visibleBarcodes.has(barcode) && linkByBarcode.get(barcode) !== gtin)
    .map(([barcode, gtin]) => ({ barcode, gtin }))
  const linkPlan = planKizLinkWrites(desired, links.map((link) => ({ barcode: link.wb_barcode, gtin: link.gtin })))

  async function applyPending() {
    if (!canManage || saving || linkPlan.order.length === 0 || linkPlan.errors.length > 0) return
    setSaving(true)
    setError(null)
    try {
      for (const row of linkPlan.order) await saveKizBarcodeLink(storeId, row.barcode, row.gtin)
      setPending({})
      setOpenGtinBarcode(null)
      setGtinQuery('')
      await reload()
    } catch (saveFailure: unknown) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'Не удалось сохранить связку.')
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function remove(barcode: string) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await clearKizBarcodeLink(storeId, barcode)
      await reload()
    } catch (saveFailure: unknown) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'Не удалось снять связку.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Связка</p>
        <p className="mt-1 text-lg font-bold text-slate-800">{count === null ? '—' : count}</p>
        <p className="text-xs text-slate-400">баркодов с GTIN</p>
        <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-semibold text-emerald-700 hover:underline">
          {canManage ? 'Настроить' : 'Смотреть'}
        </button>
      </div>
      {open && createPortal(
      <>
      <Modal
        open
        tall
        fill
        onClose={() => setOpen(false)}
        title="Связка баркода и GTIN"
        footer={(
          <div className="flex items-center justify-between gap-3">
            {canManage ? (
              <button type="button" onClick={() => setExcelOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700" title="Действия с Excel" aria-label="Действия с Excel">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="m8 13 4 5M12 13l-4 5" />
                  <path d="M15 13h2M15 16h2M15 19h2" />
                </svg>
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Закрыть</button>
              {canManage && (
                <button type="button" disabled={saving || linkPlan.order.length === 0 || linkPlan.errors.length > 0} onClick={() => void applyPending()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? 'Связываем…' : 'Связать'}
                </button>
              )}
            </div>
          </div>
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {(error || linkPlan.errors.length > 0 || !canManage || products.length === 0 || gtins.length === 0) && (
            <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {linkPlan.errors.length > 0 && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{linkPlan.errors.map((problem) => <p key={problem}>{problem}</p>)}</div>}
              {!canManage && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Менять связку может владелец или администратор.</p>}
              {products.length === 0 && <p className="text-sm text-slate-500">В этом магазине нет товаров WB. Сначала обновите их на странице товаров.</p>}
              {gtins.length === 0 && <p className="text-sm text-slate-500">Нет товаров Teksher. Сначала обновите товары КИЗ.</p>}
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[40%] min-w-0 flex-col overflow-hidden border-r border-slate-200 p-4">
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
                  {found.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>}
                  {found.map((product) => (
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
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4" onScroll={() => setOpenGtinBarcode(null)}>
              {selected.length === 0 && <p className="text-sm text-slate-400">Выберите артикул слева. Размеры и GTIN появятся здесь.</p>}
              <div className="space-y-3">
                {selected.map((product) => {
                  const rows = kizSizeRows(product)
                  return (
                    <section key={product.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex items-start gap-3">
                        <PhotoThumb url={kizPhotoUrl(product.photos)} className="h-14 w-11 rounded-lg" previewZIndex={80} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{product.name || 'Без названия'}</p>
                          <p className="truncate text-xs text-slate-400">{product.nm_id} · {product.vendor_code || '—'} · {product.color || 'цвет не указан'}</p>
                        </div>
                        <button
                          type="button"
                          aria-label="Убрать товар"
                          onClick={() => {
                            const barcodes = new Set(kizSizeRows(product).map((row) => row.barcode))
                            setPending((current) => Object.fromEntries(Object.entries(current).filter(([barcode]) => !barcodes.has(barcode))))
                            setSelectedIds((current) => current.filter((id) => id !== product.id))
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {rows.map((row) => {
                          const linked = linkByBarcode.get(row.barcode) ?? null
                          const chosen = pending[row.barcode]
                          const choosing = openGtinBarcode === row.barcode
                          return (
                            <div key={row.rowKey} className="flex items-center gap-3">
                              <div className="min-w-0 flex-1 text-sm">
                                <span className="font-medium text-slate-700">{row.techSize}</span>
                                <span className="ml-2 font-mono text-xs text-slate-400">{row.barcode}</span>
                              </div>
                              <div className="w-72 shrink-0">
                                {row.barcode === '—' ? (
                                  <p className="text-xs text-amber-700">Нет баркода</p>
                                ) : (
                                  <GtinField
                                    open={choosing}
                                    query={choosing ? gtinQuery : (chosen ?? '')}
                                    saved={linked}
                                    draft={chosen ?? null}
                                    disabled={!canManage || saving}
                                    choices={choosing ? gtinChoices : []}
                                    onOpen={() => { setOpenGtinBarcode(row.barcode); setGtinQuery('') }}
                                    onQuery={(value) => { setOpenGtinBarcode(row.barcode); setGtinQuery(value) }}
                                    onPick={(gtin) => { setPending((current) => ({ ...current, [row.barcode]: gtin })); setOpenGtinBarcode(null); setGtinQuery('') }}
                                    onClear={linked ? () => void remove(row.barcode) : undefined}
                                  />
                                )}
                              </div>
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
      {excelOpen && (
        <KizLinkExcelDialog
          storeId={storeId}
          products={products}
          gtins={gtins}
          links={links}
          onClose={() => setExcelOpen(false)}
          onApplied={async () => { setPending({}); await reload() }}
        />
      )}
      </>,
      document.body,
      )}
    </>
  )
}
