import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '../ui/Modal'
import { PhotoThumb } from '../ui/PhotoThumb'
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

  async function save(barcode: string, gtin: string) {
    if (!canManage || saving || barcode === '—') return
    setSaving(true)
    setError(null)
    try {
      await saveKizBarcodeLink(storeId, barcode, gtin)
      setGtinQuery('')
      setOpenGtinBarcode(null)
      await reload()
    } catch (saveFailure: unknown) {
      setError(saveFailure instanceof Error ? saveFailure.message : 'Не удалось сохранить связку.')
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
      <Modal
        open
        tall
        fill
        onClose={() => setOpen(false)}
        title="Связка баркода и GTIN"
        footer={<button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Закрыть</button>}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {(error || !canManage || products.length === 0 || gtins.length === 0) && (
            <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
              {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
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
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
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
                          onClick={() => setSelectedIds((current) => current.filter((id) => id !== product.id))}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {rows.map((row) => {
                          const linked = linkByBarcode.get(row.barcode) ?? null
                          const choosing = openGtinBarcode === row.barcode
                          return (
                            <div key={row.rowKey} className="flex items-start gap-3">
                              <div className="min-w-0 flex-1 pt-2 text-sm">
                                <span className="font-medium text-slate-700">{row.techSize}</span>
                                <span className="ml-2 font-mono text-xs text-slate-400">{row.barcode}</span>
                              </div>
                              <div className="w-72 shrink-0">
                                {row.barcode === '—' ? (
                                  <p className="pt-2 text-xs text-amber-700">Нет баркода</p>
                                ) : linked ? (
                                  <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                    <span className="truncate font-mono text-xs text-emerald-800">{linked}</span>
                                    {canManage && (
                                      <button type="button" disabled={saving} onClick={() => void remove(row.barcode)} className="shrink-0 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
                                        Снять
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <input
                                      value={choosing ? gtinQuery : ''}
                                      disabled={!canManage || saving}
                                      onFocus={() => { setOpenGtinBarcode(row.barcode); setGtinQuery('') }}
                                      onChange={(event) => { setOpenGtinBarcode(row.barcode); setGtinQuery(event.target.value) }}
                                      placeholder="Выберите GTIN"
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none placeholder:text-slate-300 focus:border-emerald-400 disabled:bg-slate-50"
                                    />
                                    {choosing && (
                                      <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                                        {gtinChoices.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">GTIN не найден</p>}
                                        {gtinChoices.map((card) => (
                                          <button
                                            key={card.gtin}
                                            type="button"
                                            disabled={saving}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => void save(row.barcode, card.gtin)}
                                            className="flex w-full flex-col border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:opacity-50"
                                          >
                                            <span className="truncate text-sm text-slate-800">{card.full_name || card.name || 'Без названия'}</span>
                                            <span className="font-mono text-xs text-slate-400">{card.gtin}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </>
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
      </Modal>,
      document.body,
      )}
    </>
  )
}
