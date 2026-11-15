import { useEffect, useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { createBatch } from '../../services/fulfillmentService'
import {
  fetchWorkshopCollections,
  startWorkshop,
  type WorkshopCollection,
} from '../../services/workshopService'
import type { Store } from '../../types'

type Props = {
  accountId: string
  stores: Store[]
  canManage: boolean
  reloadKey: number
  onOpen: (collection: WorkshopCollection) => void
  onPlan: (collection: WorkshopCollection) => void
}

function todayCollectionName() {
  const date = new Date()
  const label = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `Сбор ${label}`
}

export function WorkshopCollectionsPanel({
  accountId,
  stores,
  canManage,
  reloadKey,
  onOpen,
  onPlan,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [storeId, setStoreId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [rows, setRows] = useState<WorkshopCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const storeName = useMemo(() => {
    const map = new Map(stores.map((store) => [store.id, store.name]))
    return (storeId: string | null) => (storeId ? map.get(storeId) ?? '—' : '—')
  }, [stores])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchWorkshopCollections(accountId)
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, reloadKey])

  const createCollection = async () => {
    if (!storeId) return
    setCreating(true)
    setCreateError(null)
    try {
      const batch = await createBatch(accountId, {
        name: todayCollectionName(),
        store_id: storeId,
        stage_otk: false,
        stage_packaging: false,
        stage_marking: false,
        stage_packing: false,
        stage_logistics: false,
      })
      await startWorkshop(batch.id)
      setCreateOpen(false)
      setStoreId('')
      onOpen({
        batchId: batch.id,
        name: batch.name,
        shortId: batch.short_id,
        storeId: batch.store_id,
        createdAt: batch.created_at,
        issuedCount: 100,
        active: true,
        filledCount: 0,
        takenCount: 0,
      })
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : 'Не удалось создать сбор')
    } finally {
      setCreating(false)
    }
  }

  const visible = rows.filter((row) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return [row.name, row.shortId == null ? '' : String(row.shortId), storeName(row.storeId)]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })

  return (
    <>
      <Card className="rounded-3xl p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex min-w-[280px] flex-1 items-center">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по сборам…"
              className="h-9 w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-4 pr-3 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setStoreId('')
                setCreateError(null)
                setCreateOpen(true)
              }}
              className="flex h-9 items-center gap-1.5 rounded-2xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Создать сбор
            </button>
          )}
        </div>
      </Card>
      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      <Card className="overflow-hidden rounded-3xl p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">Загрузка…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="font-medium text-slate-700">
              {rows.length === 0 ? 'Нажмите «Создать сбор» чтобы начать' : 'Ничего не найдено'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Сбор</th>
                <th className="px-4 py-3 text-left">Магазин</th>
                <th className="px-4 py-3 text-left">Короба</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Создан</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => (
                <tr
                  key={row.batchId}
                  onClick={() => onOpen(row)}
                  className="cursor-pointer transition-colors hover:bg-slate-50/80"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.shortId ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-800">{row.name}</td>
                  <td className="px-4 py-3 text-slate-600">{storeName(row.storeId)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.filledCount} / {row.issuedCount}
                    {row.takenCount > 0 ? ` · ${row.takenCount} в поставках` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.active ? 'Идёт' : 'Завершён'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(row.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      onClick={() => onPlan(row)}
                    >
                      Поставка
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {createOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-slate-100 px-6 py-5">
              <p className="text-base font-semibold text-slate-800">Новый сбор</p>
            </div>
            <form
              className="space-y-4 p-6"
              onSubmit={(event) => {
                event.preventDefault()
                void createCollection()
              }}
            >
              {createError && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{createError}</div>}
              <label className="block text-xs font-medium text-slate-500">
                Магазин
                <select
                  value={storeId}
                  onChange={(event) => setStoreId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-300"
                >
                  <option value="">Выберите магазин</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500" onClick={() => setCreateOpen(false)}>
                  Отмена
                </button>
                <button type="submit" disabled={creating || !storeId} className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {creating ? 'Создание…' : 'Создать сбор'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
