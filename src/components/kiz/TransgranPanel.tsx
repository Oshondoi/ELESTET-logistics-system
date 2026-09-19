import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import type { Store } from '../../types'
import { PhotoThumb } from '../ui/PhotoThumb'

type ShipmentStatus = 'draft' | 'checking' | 'ready' | 'submitting' | 'waiting' | 'progress' | 'completed' | 'rejected' | 'cancel_requested' | 'cancelled' | 'error'

interface Shipment {
  id: string
  account_id: string
  store_id: string
  scheme: 'fbo' | 'fbs'
  fulfillment_supply_id: string | null
  wb_supply_id: string | null
  document_number: string | null
  document_date: string | null
  shipment_date: string | null
  recipient_name: string
  recipient_inn: string
  recipient_kpp: string
  destination_city: string | null
  destination_name: string | null
  movement_kind: 'border_crossing' | 'inside_russia'
  physical_status: string
  product_group_id: number | null
  product_group_code: string | null
  product_group_alias: string
  product_group_name: string | null
  products_payload: Array<{ gtin: string; productionDate?: string; expirationDate?: string }>
  status: ShipmentStatus
  teksher_operation_id: string | null
  teksher_status: string | null
  teksher_process_description: string | null
  last_error: string | null
  spot_channel: 'wb' | 'cargo' | 'direct'
  spot_status: 'not_started' | 'data_ready' | 'requested' | 'qr_ready' | 'crossed' | 'revoked'
  carrier_legal_name: string | null
  carrier_tax_id: string | null
  carrier_country: string
  vehicle_number: string | null
  trailer_number: string | null
  spot_qr_file_url: string | null
  customs_declaration_numbers: string[]
  created_at: string
  updated_at: string
  submitted_at: string | null
  completed_at: string | null
}

interface Issue {
  code: string
  level: 'warning' | 'error'
  message: string
  details?: { shipments?: Array<Record<string, unknown>> }
}

interface Item {
  id: string
  shipment_id: string
  source_pair_kind: 'fulfillment' | 'fbs'
  wb_order_id: string | null
  barcode: string | null
  kiz_raw: string
  kiz_normalized: string
  gtin: string | null
  serial_number: string | null
  validation_level: 'unchecked' | 'ok' | 'warning' | 'error'
  issues: Issue[]
  teksher_status: string | null
  product_snapshot: Record<string, unknown>
  source_snapshot: Record<string, unknown>
  previous_shipments?: Array<Record<string, unknown>>
}

interface Group {
  id?: number
  code?: string
  alias?: string
  name?: string
}

interface FboSource {
  id: string
  batch_id: string
  supply_number: number
  warehouse_name: string
  wb_supply_id: string | null
  batch_name: string
  batch_short_id: number | null
}

interface FbsSource {
  wb_supply_id: string
  name: string | null
  done: boolean
  destination_name: string | null
  wb_created_at: string | null
}

const DATE_GROUPS = new Set(['petfood', 'chemistry', 'milk', 'autofluids'])

const STATUS: Record<ShipmentStatus, { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'bg-slate-100 text-slate-700' },
  checking: { label: 'Проверяется', cls: 'bg-blue-50 text-blue-700' },
  ready: { label: 'Проверен', cls: 'bg-amber-50 text-amber-700' },
  submitting: { label: 'Отправляется', cls: 'bg-blue-50 text-blue-700' },
  waiting: { label: 'Ожидает Teksher', cls: 'bg-amber-50 text-amber-700' },
  progress: { label: 'Выполняется Teksher', cls: 'bg-blue-50 text-blue-700' },
  completed: { label: 'Выполнен', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Отклонён', cls: 'bg-red-50 text-red-700' },
  cancel_requested: { label: 'Отмена запрошена', cls: 'bg-orange-50 text-orange-700' },
  cancelled: { label: 'Отменён', cls: 'bg-slate-100 text-slate-500' },
  error: { label: 'Ошибка', cls: 'bg-red-50 text-red-700' },
}

const PHYSICAL = [
  ['preparing', 'Готовится в КР'],
  ['awaiting_departure', 'Готов к отправке'],
  ['in_transit', 'Пересекает границу / в пути'],
  ['in_russia', 'В России у посредника'],
  ['handed_to_wb', 'Передан WB'],
  ['cancelled', 'Физическая отправка отменена'],
] as const

const SPOT_STATUS = [
  ['not_started', 'Не начат'],
  ['data_ready', 'Данные перевозчика готовы'],
  ['requested', 'Заявка отправлена в СПОТ'],
  ['qr_ready', 'QR готов'],
  ['crossed', 'Граница пересечена'],
  ['revoked', 'Заявка / QR отозваны'],
] as const

function displayDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU')
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function invokeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Неизвестная ошибка'
}

async function invoke(storeId: string, action: string, extra: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase не инициализирован')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Сессия истекла. Войдите снова.')
  const { data, error } = await supabase.functions.invoke('teksher-auth', {
    body: { store_id: storeId, action, ...extra },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    try {
      const context = (error as { context?: Response }).context
      const payload = context ? await context.clone().json() as { error?: string } : null
      if (payload?.error) throw new Error(payload.error)
    } catch (nested) { if (nested instanceof Error && nested.message !== 'Unexpected end of JSON input') throw nested }
    throw error
  }
  const result = data as Record<string, unknown>
  if (result?.error) throw new Error(String(result.error))
  return result
}

function productFor(item: Item) {
  const snapshot = object(item.product_snapshot)
  const direct = object(snapshot.local_product)
  const possible = array(snapshot.possible_products).map(object)
  const product = Object.keys(direct).length > 0 ? direct : possible[0] ?? snapshot
  const photos = array(product.photos).map(object)
  const photo = String(product.photo_url ?? photos[0]?.c246x328 ?? photos[0]?.big ?? '') || null
  const sizes = array(product.sizes).map(object)
  const size = sizes.find((entry) => array(entry.skus).map(String).includes(String(item.barcode ?? '')))
  return {
    photo,
    name: String(product.name ?? snapshot.product_name ?? product.article ?? 'Товар не определён'),
    nmId: String(product.nm_id ?? product.nmId ?? snapshot.nm_id ?? '—'),
    vendorCode: String(product.vendor_code ?? product.article ?? snapshot.article ?? '—'),
    barcode: String(item.barcode ?? snapshot.barcode ?? '—'),
    size: String(size?.techSize ?? size?.tech_size ?? snapshot.size ?? '—'),
    color: String(product.color ?? snapshot.color ?? '—'),
    brand: String(product.brand ?? snapshot.brand ?? '—'),
    category: String(product.category ?? snapshot.category ?? '—'),
  }
}

function DiagnosticModal({ shipment, items, loading, onClose }: { shipment: Shipment; items: Item[]; loading: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const totals = items.reduce((sum, item) => {
    sum[item.validation_level] = (sum[item.validation_level] ?? 0) + 1
    return sum
  }, {} as Record<string, number>)
  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Поштучная проверка КИЗов</h2>
            <p className="mt-1 text-xs text-slate-500">{shipment.scheme.toUpperCase()} · документ {shipment.document_number || 'не заполнен'} · ошибки не блокируют решение пользователя</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 text-xs">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Без замечаний: {totals.ok ?? 0}</span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Предупреждения: {totals.warning ?? 0}</span>
          <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">Ошибки: {totals.error ?? 0}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Не проверено: {totals.unchecked ?? 0}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading && <p className="p-8 text-center text-sm text-blue-600">Проверяем каждый КИЗ в Teksher и в БД ELESTET…</p>}
          {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-slate-400">КИЗы не загружены</p>}
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500"><tr>
              <th className="px-3 py-2">Товар</th><th className="px-3 py-2">Артикулы и баркод</th><th className="px-3 py-2">Размер / цвет</th><th className="px-3 py-2">Источник</th><th className="px-3 py-2">Teksher</th><th className="px-3 py-2">Результат</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const product = productFor(item)
                const source = object(item.source_snapshot)
                const open = expanded === item.id
                return <tr key={item.id} className="align-top">
                  <td className="px-3 py-3"><div className="flex min-w-[230px] gap-3"><PhotoThumb url={product.photo} className="h-12 w-12 shrink-0 rounded-lg" previewZIndex={180} /><div><p className="max-w-[230px] font-semibold text-slate-800">{product.name}</p><p className="text-slate-400">{product.brand} · {product.category}</p></div></div></td>
                  <td className="px-3 py-3"><p>WB: <span className="font-mono font-semibold">{product.nmId}</span></p><p>Продавец: {product.vendorCode}</p><p className="font-mono">{product.barcode}</p><p className="mt-1 max-w-[220px] truncate font-mono text-[10px] text-slate-400" title={item.kiz_normalized}>КИЗ: {item.kiz_normalized}</p></td>
                  <td className="px-3 py-3"><p>{product.size}</p><p className="text-slate-500">{product.color}</p><p className="mt-1 font-mono text-slate-400">GTIN {item.gtin || '—'}</p></td>
                  <td className="px-3 py-3"><p>{item.source_pair_kind === 'fbs' ? `FBS заказ ${item.wb_order_id || '—'}` : `Партия ${String(source.batch_short_id ?? '—')}`}</p><p>Поставка {String(source.supply_number ?? source.supply_id ?? '—')}</p><p>Короб {String(source.box_number ?? source.box_id ?? '—')}</p></td>
                  <td className="px-3 py-3"><span className="font-semibold">{item.teksher_status || 'Не найден'}</span></td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setExpanded(open ? null : item.id)} className={`rounded-lg px-2 py-1 text-left ${item.validation_level === 'error' ? 'bg-red-50 text-red-700' : item.validation_level === 'warning' ? 'bg-amber-50 text-amber-700' : item.validation_level === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {item.validation_level === 'error' ? `Ошибок: ${item.issues.length}` : item.validation_level === 'warning' ? `Замечаний: ${item.issues.length}` : item.validation_level === 'ok' ? 'Всё проверено' : 'Не проверен'} {item.issues.length > 0 ? (open ? '▴' : '▾') : ''}
                    </button>
                    {open && <div className="mt-2 w-[320px] space-y-2">{item.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className={`rounded-lg border p-2 ${issue.level === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-amber-100 bg-amber-50 text-amber-800'}`}><p className="font-semibold">{issue.code}</p><p>{issue.message}</p>{array(issue.details?.shipments).map((previous, previousIndex) => { const row = object(previous); return <p key={previousIndex} className="mt-1 border-t border-current/10 pt-1 text-[10px]">{String(row.scheme ?? '').toUpperCase()} · {String(row.document_number ?? row.wb_supply_id ?? 'без номера')} · {String(row.destination_city ?? row.destination_name ?? 'город не указан')} · {String(row.status ?? '')}</p> })}</div>)}</div>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-slate-100 p-4"><button type="button" onClick={onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">Закрыть</button></div>
      </div>
    </div>, document.body,
  )
}

export function TransgranPanel({ store, connected }: { store: Store; connected: boolean }) {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [fboSources, setFboSources] = useState<FboSource[]>([])
  const [fbsSources, setFbsSources] = useState<FbsSource[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [sourceType, setSourceType] = useState<'fbo' | 'fbs'>('fbo')
  const [sourceId, setSourceId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [form, setForm] = useState<Partial<Shipment>>({})
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [modal, setModal] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const selected = shipments.find((shipment) => shipment.id === selectedId) ?? null
  const usedFbo = new Set(shipments.filter((shipment) => !['completed', 'cancelled', 'rejected'].includes(shipment.status)).map((shipment) => shipment.fulfillment_supply_id))
  const usedFbs = new Set(shipments.filter((shipment) => !['completed', 'cancelled', 'rejected'].includes(shipment.status)).map((shipment) => shipment.wb_supply_id))

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const { data: shipmentRows, error: shipmentError } = await (supabase as any).from('transgran_shipments').select('*').eq('store_id', store.id).order('created_at', { ascending: false })
      if (shipmentError) throw shipmentError
      const loaded = (shipmentRows ?? []) as unknown as Shipment[]
      setShipments(loaded)
      if (loaded.length > 0 && !selectedId) setSelectedId(loaded[0].id)
      const ids = loaded.map((shipment) => shipment.id)
      if (ids.length > 0) {
        const { data: itemRows } = await (supabase as any).from('transgran_items').select('shipment_id').in('shipment_id', ids)
        const nextCounts: Record<string, number> = {}
        for (const row of itemRows ?? []) nextCounts[String(row.shipment_id)] = (nextCounts[String(row.shipment_id)] ?? 0) + 1
        setCounts(nextCounts)
      } else setCounts({})

      const { data: batches, error: batchError } = await (supabase as any).from('fulfillment_batches').select('id,name,short_id').eq('store_id', store.id).is('deleted_at', null)
      if (batchError) throw batchError
      const batchRows = (batches ?? []) as Array<{ id: string; name: string; short_id: number | null }>
      const batchMap = new Map(batchRows.map((batch) => [batch.id, batch]))
      if (batchRows.length > 0) {
        const { data: supplies, error: supplyError } = await (supabase as any).from('fulfillment_supplies').select('id,batch_id,supply_number,warehouse_name,wb_supply_id').in('batch_id', batchRows.map((batch) => batch.id)).eq('destination_type', 'fbo').order('created_at', { ascending: false })
        if (supplyError) throw supplyError
        setFboSources((supplies ?? []).map((row: Record<string, any>) => ({ ...row, wb_supply_id: row.wb_supply_id ?? null, batch_name: batchMap.get(row.batch_id)?.name ?? '', batch_short_id: batchMap.get(row.batch_id)?.short_id ?? null })) as FboSource[])
      } else setFboSources([])
      const { data: fbs, error: fbsError } = await (supabase as any).from('fbs_supplies').select('wb_supply_id,name,done,wb_created_at,raw_data').eq('store_id', store.id).order('wb_created_at', { ascending: false }).limit(200)
      if (fbsError) throw fbsError
      setFbsSources((fbs ?? []).map((row: Record<string, any>) => ({ wb_supply_id: row.wb_supply_id, name: row.name, done: row.done, wb_created_at: row.wb_created_at, destination_name: String(object(row.raw_data).destinationOfficeName ?? object(row.raw_data).destinationName ?? '') || null })))
      if (connected) {
        try { const result = await invoke(store.id, 'product_groups'); setGroups(array(result.items).map(object) as Group[]) }
        catch { setGroups([{ alias: 'lp', code: '1', name: 'Одежда и товары лёгкой промышленности' }]) }
      }
    } catch (reason) { setMessage({ type: 'error', text: invokeError(reason) }) }
    finally { setLoading(false) }
  }, [connected, selectedId, store.id])

  useEffect(() => { setSelectedId(null); void load() }, [store.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetails = useCallback(async (shipmentId: string) => {
    if (!supabase) return
    const [{ data: itemRows, error: itemError }, { data: eventRows, error: eventError }] = await Promise.all([
      (supabase as any).from('transgran_items').select('*').eq('shipment_id', shipmentId).order('created_at'),
      (supabase as any).from('transgran_events').select('*').eq('shipment_id', shipmentId).order('created_at', { ascending: false }),
    ])
    if (itemError) throw itemError
    if (eventError) throw eventError
    setItems((itemRows ?? []) as unknown as Item[])
    setEvents((eventRows ?? []) as Array<Record<string, unknown>>)
  }, [])

  useEffect(() => {
    if (!selected) { setItems([]); setEvents([]); setForm({}); return }
    setForm(selected)
    void loadDetails(selected.id).catch((reason) => setMessage({ type: 'error', text: invokeError(reason) }))
  }, [loadDetails, selectedId, selected?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (task: () => Promise<void>, success?: string) => {
    setLoading(true); setMessage(null)
    try { await task(); if (success) setMessage({ type: 'ok', text: success }); await load() }
    catch (reason) { setMessage({ type: 'error', text: invokeError(reason) }) }
    finally { setLoading(false) }
  }

  const createShipment = () => run(async () => {
    if (!supabase || !sourceId) throw new Error('Выберите поставку')
    const rpc = sourceType === 'fbo'
      ? await (supabase as any).rpc('create_transgran_from_fbo', { p_supply_id: sourceId })
      : await (supabase as any).rpc('create_transgran_from_fbs', { p_store_id: store.id, p_wb_supply_id: sourceId })
    if (rpc.error) throw rpc.error
    setSelectedId(String(rpc.data)); setSourceId('')
  }, 'Черновик трансграна создан')

  const save = () => run(async () => {
    if (!supabase || !selected) return
    const group = groups.find((entry) => String(entry.alias ?? '') === String(form.product_group_alias ?? 'lp'))
    const payload = {
      document_number: form.document_number || null,
      document_date: form.document_date || null,
      shipment_date: form.shipment_date || null,
      destination_city: form.destination_city || null,
      destination_name: form.destination_name || null,
      movement_kind: form.movement_kind || 'border_crossing',
      physical_status: form.physical_status || 'preparing',
      product_group_id: group?.id ?? null,
      product_group_code: group?.code ?? null,
      product_group_alias: group?.alias ?? 'lp',
      product_group_name: group?.name ?? null,
      products_payload: form.products_payload ?? [],
      updated_at: new Date().toISOString(),
    }
    const { error } = await (supabase as any).from('transgran_shipments').update(payload).eq('id', selected.id)
    if (error) throw error
  }, 'Данные документа сохранены')

  const diagnose = () => run(async () => {
    if (!selected) return
    setModal(true); setChecking(true)
    try {
      const result = await invoke(store.id, 'transgran_diagnose', { shipment_id: selected.id })
      setItems(array(result.items) as Item[])
    } finally { setChecking(false) }
  }, 'Каждый КИЗ проверен; замечания не блокируют отправку')

  const submit = () => run(async () => {
    if (!selected) return
    await saveWithoutReload()
    const errorCount = items.filter((item) => item.validation_level === 'error').length
    const warningCount = items.filter((item) => item.validation_level === 'warning').length
    const text = errorCount || warningCount
      ? `Проверка показывает: ошибок ${errorCount}, предупреждений ${warningCount}. ELESTET не блокирует решение. Всё равно создать трансгран в Teksher?`
      : 'Создать операцию трансграна в Teksher? После этого редактирование документа будет закрыто.'
    if (!window.confirm(text)) return
    await invoke(store.id, 'transgran_submit', { shipment_id: selected.id })
  }, 'Операция создана в Teksher')

  const saveWithoutReload = async () => {
    if (!supabase || !selected) return
    const group = groups.find((entry) => String(entry.alias ?? '') === String(form.product_group_alias ?? 'lp'))
    const { error } = await (supabase as any).from('transgran_shipments').update({
      document_number: form.document_number || null, document_date: form.document_date || null,
      shipment_date: form.shipment_date || null, destination_city: form.destination_city || null,
      destination_name: form.destination_name || null, movement_kind: form.movement_kind || 'border_crossing', physical_status: form.physical_status || 'preparing',
      product_group_id: group?.id ?? null, product_group_code: group?.code ?? null,
      product_group_alias: group?.alias ?? 'lp', product_group_name: group?.name ?? null,
      products_payload: form.products_payload ?? [], updated_at: new Date().toISOString(),
    }).eq('id', selected.id)
    if (error) throw error
  }

  const sync = () => run(async () => { if (selected) await invoke(store.id, 'transgran_sync', { shipment_id: selected.id }) }, 'Статус обновлён из Teksher')
  const cancel = () => run(async () => {
    if (!selected) return
    const number = window.prompt('Номер документа отмены')?.trim()
    if (!number) return
    await invoke(store.id, 'transgran_cancel', { shipment_id: selected.id, document_number: number })
  }, 'Запрос отмены отправлен в Teksher')

  const saveSpot = () => run(async () => {
    if (!supabase || !selected) return
    const declarations = (form.customs_declaration_numbers ?? [])
      .flatMap((value) => value.split(/[\n,;]+/)).map((value) => value.trim()).filter(Boolean)
    const { error } = await (supabase as any).rpc('save_transgran_spot', {
      p_shipment_id: selected.id,
      p_channel: form.spot_channel ?? 'wb',
      p_status: form.spot_status ?? 'not_started',
      p_carrier_legal_name: form.carrier_legal_name ?? '',
      p_carrier_tax_id: form.carrier_tax_id ?? '',
      p_carrier_country: form.carrier_country ?? 'Кыргызстан',
      p_vehicle_number: form.vehicle_number ?? '',
      p_trailer_number: form.trailer_number ?? '',
      p_qr_file_url: form.spot_qr_file_url ?? '',
      p_customs_declaration_numbers: declarations,
    })
    if (error) throw error
  }, 'Данные СПОТ сохранены')

  const gtins = useMemo(() => [...new Set(items.map((item) => item.gtin).filter(Boolean))] as string[], [items])
  const productsPayload = form.products_payload ?? []
  const setProductDate = (gtin: string, key: 'productionDate' | 'expirationDate', value: string) => {
    const current = new Map(productsPayload.map((row) => [row.gtin, row]))
    current.set(gtin, { ...(current.get(gtin) ?? { gtin }), [key]: value })
    setForm((previous) => ({ ...previous, products_payload: [...current.values()] }))
  }

  if (!connected) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><p className="font-medium text-slate-700">Сначала подключите Teksher на вкладке «Главная»</p></div>

  return <div className="space-y-4">
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <p className="text-sm font-semibold text-blue-900">Трансгран — отдельный документ до пересечения границы</p>
      <p className="mt-1 text-xs leading-relaxed text-blue-800">Приём КИЗов в партии означает только фактическую приёмку товара в ELESTET. Для FBO состав берётся из конкретной поставки внутри партии, для FBS — из конкретной поставки WB. Получатель маркировки для процесса WB: ООО «РВБ». Заявитель СПОТ определяется отдельно по документам белого ввоза.</p>
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs font-medium text-slate-500">Схема</label><div className="flex rounded-xl bg-slate-100 p-1">{(['fbo', 'fbs'] as const).map((value) => <button key={value} type="button" onClick={() => { setSourceType(value); setSourceId('') }} className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${sourceType === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>{value.toUpperCase()}</button>)}</div></div>
        <div className="min-w-[300px] flex-1"><label className="mb-1 block text-xs font-medium text-slate-500">Источник состава КИЗов</label><select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">— Выберите поставку —</option>{sourceType === 'fbo' ? fboSources.filter((row) => !usedFbo.has(row.id)).map((row) => <option key={row.id} value={row.id}>Партия {row.batch_short_id ?? row.batch_name} · поставка {row.supply_number} · {row.warehouse_name} · WB {row.wb_supply_id || 'ID не привязан'}</option>) : fbsSources.filter((row) => !usedFbs.has(row.wb_supply_id)).map((row) => <option key={row.wb_supply_id} value={row.wb_supply_id}>{row.wb_supply_id} · {row.name || 'без названия'} · {row.destination_name || 'склад не указан'} · {row.done ? 'закрыта' : 'открыта'}</option>)}</select></div>
        <button type="button" onClick={() => void createShipment()} disabled={loading || !sourceId} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Создать документ</button>
      </div>
    </div>

    {message && <div className={`rounded-xl border p-3 text-sm ${message.type === 'ok' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>{message.text}</div>}

    <div className="grid min-h-[520px] gap-4 lg:grid-cols-[330px_1fr]">
      <div className="space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between px-1"><h3 className="text-sm font-semibold text-slate-800">Документы</h3><span className="text-xs text-slate-400">{shipments.length}</span></div>
        {shipments.map((shipment) => <button key={shipment.id} type="button" onClick={() => setSelectedId(shipment.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === shipment.id ? 'border-blue-300 bg-blue-50' : 'border-slate-100 hover:border-slate-200'}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-800">{shipment.scheme.toUpperCase()} · {shipment.document_number || shipment.wb_supply_id || 'без номера'}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[shipment.status].cls}`}>{STATUS[shipment.status].label}</span></div>
          <p className="mt-1 text-xs text-slate-500">{shipment.destination_city || shipment.destination_name || 'Город/склад не указан'}</p>
          <p className="mt-1 text-[11px] text-slate-400">КИЗов: {counts[shipment.id] ?? 0} · создан {displayDate(shipment.created_at)}</p>
        </button>)}
        {!loading && shipments.length === 0 && <p className="p-5 text-center text-xs text-slate-400">Создайте первый документ из FBO- или FBS-поставки</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {!selected ? <p className="py-24 text-center text-sm text-slate-400">Выберите документ слева</p> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div><div className="flex items-center gap-2"><h3 className="text-base font-semibold text-slate-900">{selected.scheme.toUpperCase()} · {selected.wb_supply_id || 'поставка без WB ID'}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS[selected.status].cls}`}>{STATUS[selected.status].label}</span></div><p className="mt-1 text-xs text-slate-500">КИЗов: {items.length} · операция Teksher: {selected.teksher_operation_id || 'ещё не создана'}</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setModal(true); if (items.some((item) => item.validation_level === 'unchecked')) void diagnose() }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Список КИЗов и ошибки</button>{selected.teksher_operation_id && <button type="button" onClick={() => void sync()} disabled={loading} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700">Обновить из Teksher</button>}</div>
          </div>

          <div className="grid gap-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs font-medium text-slate-500">Номер документа WB<input value={form.document_number ?? ''} onChange={(event) => setForm((current) => ({ ...current, document_number: event.target.value }))} disabled={Boolean(selected.teksher_operation_id)} placeholder={selected.scheme === 'fbo' ? 'Числовой ID поставки' : 'WB-GI-…'} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50" /></label>
            <label className="text-xs font-medium text-slate-500">Дата документа<input type="date" value={form.document_date ?? ''} onChange={(event) => setForm((current) => ({ ...current, document_date: event.target.value }))} disabled={Boolean(selected.teksher_operation_id)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50" /></label>
            <label className="text-xs font-medium text-slate-500">Дата отгрузки из КР<input type="date" value={form.shipment_date ?? ''} onChange={(event) => setForm((current) => ({ ...current, shipment_date: event.target.value }))} disabled={Boolean(selected.teksher_operation_id)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50" /></label>
            <label className="text-xs font-medium text-slate-500">Город назначения<input value={form.destination_city ?? ''} onChange={(event) => setForm((current) => ({ ...current, destination_city: event.target.value }))} disabled={Boolean(selected.teksher_operation_id)} placeholder="Москва" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50" /></label>
            <label className="text-xs font-medium text-slate-500">Склад / посредник<input value={form.destination_name ?? ''} onChange={(event) => setForm((current) => ({ ...current, destination_name: event.target.value }))} disabled={Boolean(selected.teksher_operation_id)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50" /></label>
            <label className="text-xs font-medium text-slate-500">Фактическое движение<select value={form.physical_status ?? 'preparing'} onChange={(event) => setForm((current) => ({ ...current, physical_status: event.target.value }))} disabled={Boolean(selected.teksher_operation_id && selected.status === 'completed')} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50">{PHYSICAL.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-500 sm:col-span-2 xl:col-span-3">Что происходит с товаром<select value={form.movement_kind ?? 'border_crossing'} onChange={(event) => setForm((current) => ({ ...current, movement_kind: event.target.value as Shipment['movement_kind'] }))} disabled={Boolean(selected.teksher_operation_id)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50"><option value="border_crossing">Новый ввоз из Кыргызстана в Россию — нужен новый трансгран</option><option value="inside_russia">Товар уже ввезён в Россию — только связать FBS с прежней историей</option></select></label>
            <label className="text-xs font-medium text-slate-500 sm:col-span-2 xl:col-span-3">Товарная группа Teksher<select value={form.product_group_alias ?? 'lp'} onChange={(event) => setForm((current) => ({ ...current, product_group_alias: event.target.value, products_payload: [] }))} disabled={Boolean(selected.teksher_operation_id)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50">{groups.length > 0 ? groups.map((group) => <option key={String(group.id ?? group.alias)} value={group.alias}>{group.name || group.alias} ({group.alias})</option>) : <option value="lp">Одежда и товары лёгкой промышленности (lp)</option>}</select></label>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"><p><span className="text-slate-400">Получатель:</span> <span className="font-semibold text-slate-700">{selected.recipient_name}</span></p><p className="mt-1"><span className="text-slate-400">ИНН / КПП:</span> {selected.recipient_inn} / {selected.recipient_kpp}</p><p className="mt-2 text-slate-500">Это получатель операции маркировки WB. Он не назначается автоматически заявителем СПОТ.</p></div>

          <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-violet-900">СПОТ — разрешение на автомобильный ввоз</p><p className="mt-1 max-w-3xl text-xs leading-relaxed text-violet-800">Для WB удобный основной путь — оформить QR прямо в поставке WB: сервис передаст ДОПП в ФНС. Здесь ELESTET хранит точные данные, статус и ссылку на готовый QR. Это отдельный процесс от Teksher.</p></div><a href="https://seller.wildberries.ru/instructions/ru/kg/material/how-to-create-a-spot-qr-code-through-wb-kg" target="_blank" rel="noreferrer" className="text-xs font-semibold text-violet-700 underline">Инструкция WB ↗</a></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-medium text-slate-500">Где оформляется<select value={form.spot_channel ?? 'wb'} onChange={(event) => setForm((current) => ({ ...current, spot_channel: event.target.value as Shipment['spot_channel'] }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900"><option value="wb">Через Wildberries</option><option value="cargo">Оформляет карго</option><option value="direct">Напрямую в ФНС / через ЭДО</option></select></label>
              <label className="text-xs font-medium text-slate-500">Статус СПОТ<select value={form.spot_status ?? 'not_started'} onChange={(event) => setForm((current) => ({ ...current, spot_status: event.target.value as Shipment['spot_status'] }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900">{SPOT_STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-xs font-medium text-slate-500">Страна перевозчика<input value={form.carrier_country ?? 'Кыргызстан'} onChange={(event) => setForm((current) => ({ ...current, carrier_country: event.target.value }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500">Юридическое название перевозчика<input value={form.carrier_legal_name ?? ''} onChange={(event) => setForm((current) => ({ ...current, carrier_legal_name: event.target.value }))} placeholder="ОсОО / ИП" className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500">Налоговый номер перевозчика<input value={form.carrier_tax_id ?? ''} onChange={(event) => setForm((current) => ({ ...current, carrier_tax_id: event.target.value }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500">Госномер автомобиля<input value={form.vehicle_number ?? ''} onChange={(event) => setForm((current) => ({ ...current, vehicle_number: event.target.value }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm uppercase text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500">Госномер прицепа (необязательно)<input value={form.trailer_number ?? ''} onChange={(event) => setForm((current) => ({ ...current, trailer_number: event.target.value }))} className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm uppercase text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500 sm:col-span-2">Ссылка на сохранённый PDF / QR<input value={form.spot_qr_file_url ?? ''} onChange={(event) => setForm((current) => ({ ...current, spot_qr_file_url: event.target.value }))} placeholder="https://…" className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900" /></label>
              <label className="text-xs font-medium text-slate-500 sm:col-span-2 xl:col-span-3">Номера ДТ для товаров, произведённых вне ЕАЭС<textarea value={(form.customs_declaration_numbers ?? []).join('\n')} onChange={(event) => setForm((current) => ({ ...current, customs_declaration_numbers: event.target.value.split('\n') }))} rows={2} placeholder="Один номер на строку; для товара производства ЕАЭС оставьте пустым" className="mt-1 w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-900" /></label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void saveSpot()} disabled={loading} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Сохранить СПОТ</button><p className="text-[11px] text-violet-700">Все поля перевозчика, кроме прицепа, обязательны в форме WB. Отдельный QR нужен для каждой поставки.</p></div>
          </div>

          {DATE_GROUPS.has(String(form.product_group_alias)) && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-800">Teksher требует даты по каждому GTIN этой группы</p><div className="mt-2 space-y-2">{gtins.map((gtin) => { const row = productsPayload.find((entry) => entry.gtin === gtin); return <div key={gtin} className="grid items-center gap-2 sm:grid-cols-[160px_1fr_1fr]"><span className="font-mono text-xs text-slate-700">{gtin}</span><input type="date" value={row?.productionDate ?? ''} onChange={(event) => setProductDate(gtin, 'productionDate', event.target.value)} className="rounded-lg border border-amber-200 px-2 py-1.5 text-xs" /><input type="date" value={row?.expirationDate ?? ''} onChange={(event) => setProductDate(gtin, 'expirationDate', event.target.value)} className="rounded-lg border border-amber-200 px-2 py-1.5 text-xs" /></div> })}</div></div>}

          {selected.last_error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{selected.last_error}</p>}
          {selected.teksher_process_description && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">Teksher: {selected.teksher_process_description}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            {!selected.teksher_operation_id && <><button type="button" onClick={() => void save()} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40">Сохранить</button><button type="button" onClick={() => void diagnose()} disabled={loading || checking} className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-40">{checking ? 'Проверяем поштучно…' : 'Проверить все КИЗы'}</button>{form.movement_kind !== 'inside_russia' && <button type="button" onClick={() => void submit()} disabled={loading || items.length === 0} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Создать трансгран в Teksher</button>}</>}
            {selected.teksher_operation_id && ['WAITING', 'PROGRESS'].includes(String(selected.teksher_status).toUpperCase()) && <button type="button" onClick={() => void cancel()} disabled={loading} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-40">Запросить отмену</button>}
          </div>

          {events.length > 0 && <details className="mt-5 rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">Неизменяемая история ({events.length})</summary><div className="mt-3 space-y-2">{events.map((event) => <div key={String(event.id)} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500"><span>{String(event.event_type)} · {String(event.old_status ?? '—')} → {String(event.new_status ?? '—')}</span><span>{new Date(String(event.created_at)).toLocaleString('ru-RU')}</span></div>)}</div></details>}
        </>}
      </div>
    </div>
    {modal && selected && <DiagnosticModal shipment={selected} items={items} loading={checking} onClose={() => setModal(false)} />}
  </div>
}
