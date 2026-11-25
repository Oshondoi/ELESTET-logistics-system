import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { PhotoThumb } from '../ui/PhotoThumb'
import {
  fetchKizOrderSources,
  kizPhotoUrl,
  kizProductMatches,
  kizProductSearchExtras,
  kizSizeRows,
  refreshSelectedGtinCards,
  type KizBarcodeLink,
  type KizGtinCard,
  type KizWbProduct,
} from '../../services/kizLinkService'

const MAX_CARDS = 40

function SelectAllSizes({
  state,
  disabled,
  onChange,
}: {
  state: 'none' | 'some' | 'all'
  disabled: boolean
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <label className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={state === 'all'}
        disabled={disabled}
        onChange={onChange}
        aria-label="Все размеры"
        className="h-5 w-5 accent-blue-600 disabled:opacity-40"
      />
      Все
    </label>
  )
}

export function KizSelectiveRefreshModal({
  open,
  storeId,
  onClose,
  onUpdated,
}: {
  open: boolean
  storeId: string
  onClose: () => void
  onUpdated: (result: { cards: number; failed: number; missing: number }) => void
}) {
  const [products, setProducts] = useState<KizWbProduct[]>([])
  const [links, setLinks] = useState<KizBarcodeLink[]>([])
  const [gtins, setGtins] = useState<KizGtinCard[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setListOpen(false)
    setSelectedIds([])
    setChecked(new Set())
    setError(null)
    setLoading(true)
    setLoadError(null)
    void fetchKizOrderSources(storeId)
      .then((sources) => {
        setProducts(sources.products)
        setLinks(sources.links)
        setGtins(sources.gtins)
      })
      .catch((loadFailure: unknown) => {
        setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Не удалось открыть товары.')
      })
      .finally(() => setLoading(false))
  }, [open, storeId])

  const linkByBarcode = useMemo(() => new Map(links.map((link) => [link.wb_barcode, link.gtin])), [links])
  const cardByGtin = useMemo(() => new Map(gtins.map((card) => [card.gtin, card])), [gtins])
  const selected = selectedIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is KizWbProduct => Boolean(product))
  const found = products
    .map((product, index) => ({
      product,
      index,
      linked: kizSizeRows(product).some((row) => linkByBarcode.has(row.barcode)),
    }))
    .filter((item) => !selectedIds.includes(item.product.id) && kizProductMatches(item.product, query, kizProductSearchExtras(item.product, linkByBarcode, cardByGtin)))
    .sort((a, b) => Number(b.linked) - Number(a.linked) || a.index - b.index)
    .slice(0, 40)

  const chosenGtins = [...new Set(
    selected.flatMap((product) => kizSizeRows(product)
      .filter((row) => checked.has(row.rowKey))
      .map((row) => linkByBarcode.get(row.barcode))
      .filter((gtin): gtin is string => Boolean(gtin))),
  )]

  const toggle = (rowKey: string) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  const refresh = async () => {
    if (busy || chosenGtins.length === 0 || chosenGtins.length > MAX_CARDS) return
    setBusy(true)
    setError(null)
    try {
      const result = await refreshSelectedGtinCards(storeId, chosenGtins)
      onUpdated(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить выбранные карточки.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      tall
      fill
      onClose={onClose}
      title="Выборочное обновление"
      footer={(
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Отмечено размеров: {checked.size}. За раз не больше {MAX_CARDS}.
            {chosenGtins.length > MAX_CARDS ? ' Снимите лишние.' : ''}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Закрыть
            </button>
            <button
              type="button"
              disabled={busy || chosenGtins.length === 0 || chosenGtins.length > MAX_CARDS}
              onClick={() => void refresh()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Обновляем…' : 'Обновить'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {(loadError || error) && (
          <div className="shrink-0 space-y-2 border-b border-slate-100 px-4 py-3">
            {loadError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[40%] min-w-0 flex-col overflow-hidden border-r border-slate-200 p-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Артикул</label>
            <input
              value={query}
              onFocus={() => setListOpen(true)}
              onChange={(event) => { setQuery(event.target.value); setListOpen(true) }}
              placeholder="Название, артикул, баркод или GTIN"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
            />
            {listOpen && (
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {loading && <p className="px-3 py-2 text-sm text-slate-400">Загружаем товары…</p>}
                {!loading && found.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>}
                {found.map(({ product, linked }) => (
                  <button
                    key={product.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedIds((current) => [...current, product.id])
                      setQuery('')
                      setListOpen(false)
                    }}
                    className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 ${linked ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-rose-50 hover:bg-rose-100'}`}
                  >
                    <PhotoThumb url={kizPhotoUrl(product.photos)} previewZIndex={80} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">{product.name || 'Без названия'}</span>
                      <span className="block truncate text-xs text-slate-400">{product.nm_id} · {product.vendor_code || 'без артикула продавца'}</span>
                      {linked
                        ? <span className="block text-xs font-medium text-emerald-700">Есть связка</span>
                        : <span className="block text-xs font-medium text-rose-700">Нет связки с GTIN</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
            {selected.length === 0 && <p className="text-sm text-slate-400">Выберите артикул слева. Размеры появятся здесь.</p>}
            <div className="space-y-3">
              {selected.map((product) => {
                const rows = kizSizeRows(product)
                const linkedKeys = rows.filter((row) => linkByBarcode.has(row.barcode)).map((row) => row.rowKey)
                const picked = linkedKeys.filter((key) => checked.has(key)).length
                const selectState = linkedKeys.length === 0 || picked === 0 ? 'none' : picked === linkedKeys.length ? 'all' : 'some'
                return (
                  <section key={product.id} className={`rounded-2xl border p-3 ${linkedKeys.length > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                    <div className="flex items-start gap-3">
                      <PhotoThumb url={kizPhotoUrl(product.photos)} className="h-14 w-11 rounded-lg" previewZIndex={80} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{product.name || 'Без названия'}</p>
                        <p className="truncate text-xs text-slate-400">{product.nm_id} · {product.vendor_code || '—'} · {product.color || 'цвет не указан'}</p>
                        <p className={`mt-1 text-xs font-medium ${linkedKeys.length > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {linkedKeys.length > 0 ? 'Есть связка' : 'Нет связки с GTIN'}
                        </p>
                      </div>
                      <SelectAllSizes
                        state={selectState}
                        disabled={linkedKeys.length === 0 || busy}
                        onChange={() => {
                          setChecked((current) => {
                            const next = new Set(current)
                            const allOn = linkedKeys.length > 0 && linkedKeys.every((key) => current.has(key))
                            linkedKeys.forEach((key) => allOn ? next.delete(key) : next.add(key))
                            return next
                          })
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Убрать товар"
                        onClick={() => {
                          const keys = new Set(kizSizeRows(product).map((row) => row.rowKey))
                          setChecked((current) => new Set([...current].filter((key) => !keys.has(key))))
                          setSelectedIds((current) => current.filter((id) => id !== product.id))
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {rows.map((row) => {
                        const gtin = linkByBarcode.get(row.barcode)
                        return (
                          <label key={row.rowKey} className={`flex items-center gap-3 ${gtin ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            <div className="min-w-0 flex-1 text-sm">
                              <span className="font-medium text-slate-700">{row.techSize}</span>
                              <span className="ml-2 font-mono text-xs text-slate-400">{row.barcode}</span>
                              {gtin
                                ? <span className="mt-0.5 block font-mono text-xs text-emerald-700">{gtin}</span>
                                : <span className="mt-0.5 block text-xs text-rose-700">Нет связки с GTIN</span>}
                            </div>
                            <input
                              type="checkbox"
                              checked={checked.has(row.rowKey)}
                              disabled={!gtin || busy}
                              onChange={() => toggle(row.rowKey)}
                              className="h-5 w-5 shrink-0 accent-blue-600 disabled:opacity-40"
                            />
                          </label>
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
