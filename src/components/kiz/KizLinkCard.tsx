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
  const [picked, setPicked] = useState<{ barcode: string; label: string } | null>(null)
  const [gtinQuery, setGtinQuery] = useState('')
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
    setPicked(null)
    setQuery('')
    setGtinQuery('')
    void reload().catch((loadFailure: unknown) => {
      setError(loadFailure instanceof Error ? loadFailure.message : 'Не удалось открыть связки.')
    })
  }, [open, storeId])

  const sizes = useMemo(() => products.flatMap((product) => kizSizeRows(product).map((row) => ({
    product,
    row,
    linked: links.find((link) => link.wb_barcode === row.barcode)?.gtin ?? null,
  }))), [products, links])
  const foundSizes = sizes.filter((item) => item.row.barcode !== '—' && kizProductMatches(item.product, query)).slice(0, 30)
  const foundGtins = gtins.filter((card) => {
    const needle = gtinQuery.trim().toLowerCase()
    if (!needle) return true
    return [card.gtin, card.name, card.full_name].some((value) => (value ?? '').toLowerCase().includes(needle))
  }).slice(0, 30)
  const linkedRows = sizes.filter((item) => item.linked)

  async function save(gtin: string) {
    if (!picked || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveKizBarcodeLink(storeId, picked.barcode, gtin)
      setPicked(null)
      setGtinQuery('')
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
        onClose={() => setOpen(false)}
        title="Связка баркода и GTIN"
        footer={<button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Закрыть</button>}
      >
        <div className="space-y-4">
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!canManage && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Менять связку может владелец или администратор.</p>}
          {products.length === 0 && <p className="text-sm text-slate-500">В этом магазине нет товаров WB. Сначала обновите их на странице товаров.</p>}
          {gtins.length === 0 && <p className="text-sm text-slate-500">Нет товаров Teksher. Сначала обновите товары КИЗ.</p>}
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Размер на Wildberries
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Артикул, баркод или название"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
            />
          </label>
          <div className="max-h-[28vh] overflow-y-auto rounded-xl border border-slate-200">
            {foundSizes.map((item) => (
              <button
                key={item.row.rowKey}
                type="button"
                disabled={!canManage}
                onClick={() => setPicked({ barcode: item.row.barcode, label: `${item.product.name || 'Товар'} · ${item.row.techSize} · ${item.row.barcode}` })}
                className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:hover:bg-white"
              >
                <PhotoThumb url={kizPhotoUrl(item.product.photos)} previewZIndex={80} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{item.product.name || 'Без названия'} · {item.row.techSize}</span>
                  <span className="block font-mono text-xs text-slate-400">{item.row.barcode}</span>
                </span>
                <span className="font-mono text-xs text-emerald-700">{item.linked || 'нет GTIN'}</span>
              </button>
            ))}
          </div>
          {picked && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Выбран размер: {picked.label}
            </div>
          )}
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            GTIN из Teksher
            <input
              value={gtinQuery}
              onChange={(event) => setGtinQuery(event.target.value)}
              placeholder="GTIN или название карточки"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
            />
          </label>
          <div className="max-h-[28vh] overflow-y-auto rounded-xl border border-slate-200">
            {foundGtins.map((card) => (
              <button
                key={card.gtin}
                type="button"
                disabled={!canManage || !picked || saving}
                onClick={() => void save(card.gtin)}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-800">{card.full_name || card.name || 'Без названия'}</span>
                  <span className="block font-mono text-xs text-slate-400">{card.gtin}</span>
                </span>
                <span className="text-xs font-semibold text-emerald-700">{saving ? '…' : 'Связать'}</span>
              </button>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Уже связано</p>
            <div className="mt-2 space-y-2">
              {linkedRows.length === 0 && <p className="text-sm text-slate-400">Связок пока нет.</p>}
              {linkedRows.map((item) => (
                <div key={item.row.rowKey} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{item.product.name || 'Товар'} · {item.row.techSize}</span>
                    <span className="block font-mono text-xs text-slate-400">{item.row.barcode} → {item.linked}</span>
                  </span>
                  {canManage && (
                    <button type="button" disabled={saving} onClick={() => void remove(item.row.barcode)} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
                      Снять
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>,
      document.body,
      )}
    </>
  )
}
