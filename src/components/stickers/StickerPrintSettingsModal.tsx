import { useEffect, useMemo, useState } from 'react'
import type { StickerTemplate } from '../../types'

export interface StickerPrintSizeDraft {
  key: string
  barcode: string
  size: string
  checked: boolean
  copies: number
  source: StickerTemplate
}

export interface StickerPrintGroupDraft {
  key: string
  label: string
  productId?: string
  wbProductMissing?: boolean
  availableColors: string[]
  name: string
  article: string
  sellerArticle: string
  showWbArticle: boolean
  showSellerArticle: boolean
  brand: string
  composition: string
  color: string
  supplier: string
  supplierAddress: string
  productionDate: string
  country: string
  iconWash: boolean
  iconIron: boolean
  iconNoBleach: boolean
  iconNoTumbleDry: boolean
  iconEac: boolean
  sizes: StickerPrintSizeDraft[]
}

interface Props {
  open: boolean
  title: string
  groups: StickerPrintGroupDraft[]
  showColorTabs?: boolean
  allowCreateBundle?: boolean
  onClose: () => void
  onRemember: (groups: StickerPrintGroupDraft[]) => Promise<void>
  onPrint: (stickers: StickerTemplate[]) => void
  onCreateBundle?: (stickers: StickerTemplate[]) => void
}

export function groupsToStickers(groups: StickerPrintGroupDraft[]): StickerTemplate[] {
  return groups.flatMap((group) => group.sizes
    .filter((size) => size.checked && size.copies > 0)
    .map((size) => ({
      ...size.source,
      barcode: size.barcode,
      name: group.name,
      composition: group.composition || null,
      article: group.article || null,
      seller_article: group.sellerArticle || null,
      show_wb_article: group.showWbArticle,
      show_seller_article: group.showSellerArticle,
      brand: group.brand || null,
      size: size.size || null,
      color: group.color || null,
      supplier: group.supplier || null,
      supplier_address: group.supplierAddress || null,
      production_date: group.productionDate || null,
      country: group.country,
      copies: Math.max(1, size.copies),
      icon_wash: group.iconWash,
      icon_iron: group.iconIron,
      icon_no_bleach: group.iconNoBleach,
      icon_no_tumble_dry: group.iconNoTumbleDry,
      icon_eac: group.iconEac,
    })))
}

const fieldClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export function StickerPrintSettingsModal({ open, title, groups: initialGroups, showColorTabs = false, allowCreateBundle = false, onClose, onRemember, onPrint, onCreateBundle }: Props) {
  const [groups, setGroups] = useState<StickerPrintGroupDraft[]>(initialGroups)
  const [activeKey, setActiveKey] = useState(initialGroups[0]?.key ?? '')
  const [isRemembering, setIsRemembering] = useState(false)
  const [rememberError, setRememberError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setGroups(initialGroups)
    setActiveKey(initialGroups[0]?.key ?? '')
    setRememberError(null)
  }, [open, initialGroups])

  const activeIndex = Math.max(0, groups.findIndex((group) => group.key === activeKey))
  const group = groups[activeIndex]
  const selectedCount = useMemo(() => groups.reduce((sum, item) => sum + item.sizes.filter((size) => size.checked).length, 0), [groups])

  if (!open || !group) return null

  const patchGroup = (patch: Partial<StickerPrintGroupDraft>) => {
    setGroups((current) => current.map((item, index) => index === activeIndex ? { ...item, ...patch } : item))
  }
  const patchShared = (patch: Partial<StickerPrintGroupDraft>) => {
    setGroups((current) => current.map((item) => ({ ...item, ...patch })))
  }
  const patchSize = (key: string, patch: Partial<StickerPrintSizeDraft>) => {
    patchGroup({ sizes: group.sizes.map((size) => size.key === key ? { ...size, ...patch } : size) })
  }

  const remember = async () => {
    setIsRemembering(true)
    setRememberError(null)
    try { await onRemember(groups) }
    catch (error) { setRememberError(error instanceof Error ? error.message : 'Не удалось сохранить настройки') }
    finally { setIsRemembering(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">Настройте данные, размеры и количество перед печатью</p>
            {group.wbProductMissing && <p className="mt-2 inline-flex rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">Товар не найден в текущей базе WB — показана последняя сохранённая информация</p>}
          </div>
          <button type="button" title="Закрыть" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">×</button>
        </div>

        {showColorTabs && groups.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-6 py-3">
            {groups.map((item) => (
              <button key={item.key} type="button" onClick={() => setActiveKey(item.key)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition ${item.key === group.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {item.color || 'Без цвета'} · {item.article || item.label}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-slate-500">Название товара</span><input className={fieldClass} value={group.name} onChange={(e) => patchGroup({ name: e.target.value })} /></label>

            <label>
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500"><input type="checkbox" checked={group.showWbArticle} onChange={(e) => patchShared({ showWbArticle: e.target.checked })} className="accent-blue-600" /> Артикул WB</span>
              <input className={fieldClass} value={group.article} onChange={(e) => patchGroup({ article: e.target.value })} />
            </label>
            <label>
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500"><input type="checkbox" checked={group.showSellerArticle} onChange={(e) => patchShared({ showSellerArticle: e.target.checked })} className="accent-blue-600" /> Артикул продавца</span>
              <input className={fieldClass} value={group.sellerArticle} onChange={(e) => patchGroup({ sellerArticle: e.target.value })} />
            </label>

            <label><span className="mb-1 block text-xs font-medium text-slate-500">Бренд</span><input className={fieldClass} value={group.brand} onChange={(e) => patchGroup({ brand: e.target.value })} /></label>
            {group.availableColors.length > 0 ? (
              <label><span className="mb-1 block text-xs font-medium text-slate-500">Цвет</span><select className={fieldClass} value={group.color} onChange={(e) => patchGroup({ color: e.target.value })}><option value="">Выберите цвет</option>{group.availableColors.map((color) => <option key={color} value={color}>{color}</option>)}</select></label>
            ) : (
              <label><span className="mb-1 block text-xs font-medium text-slate-500">Цвет</span><input className={fieldClass} value={group.color} onChange={(e) => patchGroup({ color: e.target.value })} /></label>
            )}
            <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-slate-500">Состав</span><input className={fieldClass} value={group.composition} onChange={(e) => patchGroup({ composition: e.target.value })} /></label>

            <label><span className="mb-1 block text-xs font-medium text-slate-500">Поставщик</span><input className={fieldClass} value={group.supplier} onChange={(e) => patchShared({ supplier: e.target.value })} /></label>
            <label><span className="mb-1 block text-xs font-medium text-slate-500">Адрес поставщика</span><input className={fieldClass} value={group.supplierAddress} onChange={(e) => patchShared({ supplierAddress: e.target.value })} /></label>
            <label><span className="mb-1 block text-xs font-medium text-slate-500">Дата производства</span><div className="flex gap-2"><input type="date" className={fieldClass} value={group.productionDate} onChange={(e) => patchShared({ productionDate: e.target.value })} /><button type="button" onClick={() => patchShared({ productionDate: localToday() })} className="rounded-xl border border-slate-200 px-3 text-xs font-medium text-blue-600">Сегодня</button></div></label>
            <label><span className="mb-1 block text-xs font-medium text-slate-500">Страна производства</span><input className={fieldClass} value={group.country} onChange={(e) => patchGroup({ country: e.target.value })} /></label>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Размеры и количество</div>
            <div className="divide-y divide-slate-100">
              {group.sizes.map((size) => (
                <div key={size.key} className={`grid grid-cols-[auto_minmax(70px,1fr)_minmax(150px,2fr)_90px] items-center gap-3 px-4 py-3 ${size.checked ? 'bg-blue-50/40' : ''}`}>
                  <input type="checkbox" checked={size.checked} onChange={(e) => patchSize(size.key, { checked: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                  <input value={size.size} onChange={(e) => patchSize(size.key, { size: e.target.value })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-400" aria-label="Размер" />
                  <input value={size.barcode} readOnly className="h-9 rounded-lg border border-slate-100 bg-slate-100 px-2 font-mono text-xs text-slate-500" title="Баркод нельзя изменить" />
                  <input type="number" min={1} max={999} value={size.copies} disabled={!size.checked} onChange={(e) => patchSize(size.key, { copies: Math.max(1, Number(e.target.value) || 1) })} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-semibold text-slate-900 disabled:bg-slate-100" aria-label="Количество" />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Знаки и уход</p>
            <div className="flex flex-wrap gap-2">
              {([
                ['iconWash', '/icons/wash-30.svg', 'Стирка при 30 °C'],
                ['iconIron', '/icons/iron.svg', 'Разрешено гладить'],
                ['iconNoBleach', '/icons/no-bleach.svg', 'Не отбеливать'],
                ['iconNoTumbleDry', '/icons/no-tumble-dry.svg', 'Не сушить в барабане'],
                ['iconEac', '/eac.svg', 'Знак соответствия ЕАЭС'],
              ] as const).map(([key, src, titleText]) => {
                const checked = group[key]
                return <button key={key} type="button" title={titleText} onClick={() => patchShared({ [key]: !checked } as Partial<StickerPrintGroupDraft>)} className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 transition ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white opacity-40'}`}><img src={src} alt={titleText} className="h-8 w-8" /></button>
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <span className={`text-sm ${rememberError ? 'text-rose-600' : 'text-slate-500'}`}>{rememberError ?? <>Выбрано размеров: <b className="text-slate-900">{selectedCount}</b></>}</span>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Отмена</button>
            <button type="button" disabled={isRemembering} onClick={() => void remember()} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">{isRemembering ? 'Сохранение…' : 'Запомнить настройки'}</button>
            {allowCreateBundle && onCreateBundle && <button type="button" disabled={selectedCount === 0} onClick={() => onCreateBundle(groupsToStickers(groups))} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 disabled:opacity-40">Создать набор</button>}
            <button type="button" disabled={selectedCount === 0} onClick={() => onPrint(groupsToStickers(groups))} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Печать</button>
          </div>
        </div>
      </div>
    </div>
  )
}
