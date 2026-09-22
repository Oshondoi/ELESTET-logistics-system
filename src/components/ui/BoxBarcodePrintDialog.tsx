import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FulfillmentSupplyWithBoxes } from '../../types'
import { supabase } from '../../lib/supabase'
import { buildFulfillmentBoxBarcode } from '../../lib/fulfillmentBoxBarcode'
import { buildFulfillmentBoxQrPdf } from '../../lib/fulfillmentBoxQrPdf'
import { fetchSupplies, saveFulfillmentWbSupplyId } from '../../services/fulfillmentService'
import { getWbFulfillmentSupplyPackageCodes } from '../../services/tripService'

interface Props {
  supplyIds: string[]
  boxId?: string
  allowSupplyMapping?: boolean
  onClose: () => void
  onSaved?: () => void
  onIdSaved?: (id: string) => Promise<void>
}

interface SupplyPrintMetadata {
  wbWarehouseName: string
  plannedDeliveryDate: string
  wbCargoType: number | null
}

export const BoxBarcodePrintDialog = ({ supplyIds, boxId, allowSupplyMapping = false, onClose, onSaved, onIdSaved }: Props) => {
  const [supplies, setSupplies] = useState<FulfillmentSupplyWithBoxes[]>([])
  const [accountShortId, setAccountShortId] = useState<number | null>(null)
  const [batchShortId, setBatchShortId] = useState<number | null>(null)
  const [sellerName, setSellerName] = useState('')
  const [printMetadata, setPrintMetadata] = useState<Record<string, SupplyPrintMetadata>>({})
  const [tab, setTab] = useState<'system' | 'wb'>('system')
  const [idDraft, setIdDraft] = useState<Record<string, string>>({})
  const [lastMappedCount, setLastMappedCount] = useState<Record<string, number>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!supabase || supplyIds.length === 0) throw new Error('Поставка не выбрана')
    const { data: first, error: supplyError } = await (supabase as any)
      .from('fulfillment_supplies').select('batch_id,account_id').eq('id', supplyIds[0]).single()
    if (supplyError || !first) throw supplyError ?? new Error('Поставка не найдена')
    const [rows, accountResult, batchResult] = await Promise.all([
      fetchSupplies(first.batch_id),
      (supabase as any).from('accounts').select('short_id').eq('id', first.account_id).single(),
      (supabase as any).from('fulfillment_batches').select('short_id,store_id').eq('id', first.batch_id).single(),
    ])
    if (accountResult.error) throw accountResult.error
    if (batchResult.error) throw batchResult.error
    let resolvedSellerName = ''
    if (batchResult.data?.store_id) {
      const { data: store, error: storeError } = await (supabase as any)
        .from('stores')
        .select('name,supplier,supplier_full')
        .eq('id', batchResult.data.store_id)
        .eq('account_id', first.account_id)
        .maybeSingle()
      if (storeError) throw storeError
      resolvedSellerName = store?.supplier_full?.trim()
        || store?.supplier?.trim()
        || store?.name?.trim()
        || ''
    }
    const selected = rows.filter((row) => supplyIds.includes(row.id))
    if (selected.length !== supplyIds.length) throw new Error('Часть поставок недоступна')
    const tripLineIds = [...new Set(selected.map((row) => row.trip_line_id).filter((id): id is string => Boolean(id)))]
    const nextPrintMetadata: Record<string, SupplyPrintMetadata> = {}
    if (tripLineIds.length > 0) {
      const { data: tripLines, error: tripLinesError } = await (supabase as any)
        .from('trip_lines')
        .select('id,wb_warehouse_name,planned_marketplace_delivery_date,wb_cargo_type')
        .in('id', tripLineIds)
      if (tripLinesError) throw tripLinesError
      for (const line of tripLines ?? []) {
        nextPrintMetadata[line.id] = {
          wbWarehouseName: line.wb_warehouse_name?.trim() ?? '',
          plannedDeliveryDate: line.planned_marketplace_delivery_date ?? '',
          wbCargoType: typeof line.wb_cargo_type === 'number' ? line.wb_cargo_type : null,
        }
      }
    }
    setSupplies(selected)
    setAccountShortId(accountResult.data?.short_id ?? null)
    setBatchShortId(batchResult.data?.short_id ?? null)
    setSellerName(resolvedSellerName)
    setPrintMetadata(nextPrintMetadata)
    setIdDraft(Object.fromEntries(selected.map((row) => [row.id, row.wb_supply_id ?? ''])))
  }, [supplyIds])

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить короба'))
  }, [reload])

  const run = async (task: () => Promise<void>) => {
    setWorking(true)
    setError(null)
    try { await task(); await reload(); onSaved?.() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить данные') }
    finally { setWorking(false) }
  }

  const fetchCodes = (supply: FulfillmentSupplyWithBoxes) => run(async () => {
    if (!allowSupplyMapping || boxId) throw new Error('Привязка ШК WB доступна только на уровне поставки')
    const id = (idDraft[supply.id] ?? '').trim()
    if (!id) throw new Error('Укажите ID поставки WB')
    if (!/^\d+$/.test(id)) throw new Error('Для FBO укажите числовой ID поставки WB. ID вида WB-GI-… относится к FBS.')
    if (id !== (supply.wb_supply_id ?? '')) {
      await saveFulfillmentWbSupplyId(supply.id, id)
      await onIdSaved?.(id)
    }
    const codes = await getWbFulfillmentSupplyPackageCodes(supply.account_id, supply.id)
    if (codes.length === 0) throw new Error(`WB API пока вернул 0 ШК коробов. В ELESTET создано ${supply.boxes.length} коробов. Это не связано с пустым содержимым: WB обычно отдаёт и пустые короба. Повторите синхронизацию после обновления данных поставки на стороне WB.`)
    if (codes.length !== supply.boxes.length) throw new Error(`WB вернул ${codes.length} ШК, а в поставке ELESTET ${supply.boxes.length} коробов. Сверьте упаковку перед привязкой.`)
    setLastMappedCount((current) => ({ ...current, [supply.id]: codes.length }))
    setTab('wb')
  })

  const saveWbSupplyId = (supply: FulfillmentSupplyWithBoxes) => run(async () => {
    const id = (idDraft[supply.id] ?? '').trim()
    if (id && !/^\d+$/.test(id)) throw new Error('Для FBO укажите числовой ID поставки WB. ID вида WB-GI-… относится к FBS.')
    await saveFulfillmentWbSupplyId(supply.id, id)
    await onIdSaved?.(id)
    setTab('system')
    setLastMappedCount((current) => ({ ...current, [supply.id]: 0 }))
  })

  const visible = supplies.flatMap((supply) => supply.boxes
    .filter((box) => !boxId || box.id === boxId)
    .map((box) => ({ supply, box })))
    .sort((left, right) => left.supply.supply_number - right.supply.supply_number || left.box.box_number - right.box.box_number)
  const allMapped = visible.length > 0 && visible.every(({ supply, box }) => supply.wb_supply_id && box.wb_external_barcode)
  const wbAvailable = supplies.length > 0 && allMapped

  const makePdf = () => {
    if (accountShortId == null || batchShortId == null) throw new Error('Не найден номер компании или партии')
    if (tab === 'wb' && !allMapped) throw new Error('Получите ШК WB для каждого выбранного короба через поставку')
    const labels = visible.map(({ supply, box }) => ({
      barcode: tab === 'wb' ? box.wb_external_barcode! : (box.barcode || buildFulfillmentBoxBarcode({
        accountShortId, batchShortId, supplyNumber: supply.supply_number, boxNumber: box.box_number,
      })),
      accountShortId,
      batchShortId,
      supplyNumber: supply.supply_number,
      boxNumber: box.box_number,
      sellerName,
      warehouseName: supply.destination_type === 'fbo' && supply.wb_supply_id && supply.trip_line_id
        ? printMetadata[supply.trip_line_id]?.wbWarehouseName || supply.warehouse_name
        : supply.warehouse_name,
      itemQuantity: box.items.reduce((total, item) => total + item.qty, 0),
      wbSupplyId: supply.destination_type === 'fbo' ? supply.wb_supply_id ?? '' : '',
      plannedDeliveryDate: supply.destination_type === 'fbo' && supply.wb_supply_id && supply.trip_line_id
        ? printMetadata[supply.trip_line_id]?.plannedDeliveryDate ?? ''
        : '',
      wbCargoType: supply.destination_type === 'fbo' && supply.wb_supply_id && supply.trip_line_id
        ? printMetadata[supply.trip_line_id]?.wbCargoType ?? null
        : null,
    }))
    return buildFulfillmentBoxQrPdf(labels)
  }

  const print = () => {
    try {
      const url = URL.createObjectURL(makePdf())
      if (!window.open(url, '_blank')) {
        URL.revokeObjectURL(url)
        throw new Error('Разрешите всплывающие окна для открытия PDF')
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось открыть PDF') }
  }

  const download = () => {
    try {
      const url = URL.createObjectURL(makePdf())
      const scope = boxId && visible[0]
        ? `S${visible[0].supply.supply_number}_B${visible[0].box.box_number}`
        : supplies.length === 1 ? `S${supplies[0].supply_number}` : 'BATCH'
      const link = document.createElement('a')
      link.href = url
      link.download = `EL_P${batchShortId}_${scope}_${tab === 'wb' ? 'WB' : 'SYSTEM'}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось скачать PDF') }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div><h2 className="text-lg font-semibold text-slate-900">ШК коробов</h2><p className="text-sm text-slate-500">Выберите источник кода, затем откройте или скачайте PDF</p></div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Закрыть">✕</button>
        </div>
        <div className="flex gap-2 border-b border-slate-100 px-5 pt-3">
          {(['system', 'wb'] as const).map((value) => <button key={value} type="button" disabled={value === 'wb' && !wbAvailable} onClick={() => { setTab(value); setError(null) }} className={`border-b-2 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${tab === value ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>{value === 'system' ? 'Системный ШК' : 'ШК WB'}</button>)}
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          {supplies.map((supply) => <section key={supply.id} className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-800">Поставка S{supply.supply_number} · {supply.warehouse_name}</p>
            {allowSupplyMapping && !boxId && supply.destination_type === 'fbo' && <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500" htmlFor={`wb-id-${supply.id}`}>ID поставки WB</label>
              <input id={`wb-id-${supply.id}`} inputMode="numeric" value={idDraft[supply.id] ?? ''} onChange={(event) => setIdDraft((current) => ({ ...current, [supply.id]: event.target.value }))} placeholder="Числовой ID FBW-поставки" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
              <button type="button" disabled={working || (idDraft[supply.id] ?? '') === (supply.wb_supply_id ?? '')} onClick={() => void saveWbSupplyId(supply)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 disabled:opacity-40">Сохранить ID</button>
            </div>}
            {allowSupplyMapping && !boxId && supply.destination_type === 'fbo' && <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={working || !(idDraft[supply.id] ?? '').trim()} onClick={() => void fetchCodes(supply)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-blue-700 disabled:opacity-40">{supply.boxes.some((box) => box.wb_barcode || box.wb_external_barcode) ? 'Обновить ШК из WB' : 'Получить и привязать ШК из WB'}</button>
              <span className="text-xs text-slate-400">{lastMappedCount[supply.id] ? `Обновлено ${lastMappedCount[supply.id]} ШК: первый из актуального ответа WB → короб №1 и далее по номеру` : 'Синхронизация обновляет только тот вид ШК, который вернул WB; второй вид ШК сохраняется'}</span>
            </div>}
            <div className="mt-3 space-y-2">
              {supply.boxes.filter((box) => !boxId || box.id === boxId).map((box) => <div key={box.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
                <span className="w-20 font-semibold text-slate-700">Короб №{box.box_number}</span>
                {tab === 'system'
                  ? <span className="break-all text-slate-600">{box.barcode || (accountShortId != null && batchShortId != null ? buildFulfillmentBoxBarcode({ accountShortId, batchShortId, supplyNumber: supply.supply_number, boxNumber: box.box_number }) : 'Загрузка…')}</span>
                  : <span className="min-w-0 text-slate-600">
                    <span className="block break-all">ШК WB: {box.wb_barcode || 'не получен'}</span>
                    <span className="mt-0.5 block break-all">Для других сервисов: {box.wb_external_barcode || 'не получен'}</span>
                  </span>}
              </div>)}
            </div>
          </section>)}
          {supplies.length === 0 && !error && <p className="text-sm text-slate-400">Загрузка коробов…</p>}
          {!allowSupplyMapping && !wbAvailable && <p className="text-xs text-slate-500">Чтобы печатать ШК WB, откройте поставку и получите её коды из WB. Здесь доступна только печать.</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600">Отмена</button>
          <button type="button" onClick={download} disabled={working || visible.length === 0 || (tab === 'wb' && !allMapped)} className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-40">Скачать PDF</button>
          <button type="button" onClick={print} disabled={working || visible.length === 0 || (tab === 'wb' && !allMapped)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Открыть PDF</button>
        </div>
      </div>
    </div>, document.body,
  )
}
