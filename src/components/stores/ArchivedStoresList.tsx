import { useState } from 'react'
import type { Store } from '../../types'
import { Card } from '../ui/Card'

interface ArchivedStoresListProps {
  stores: Store[]
  canManage?: boolean
  onRestore: (storeId: string) => Promise<void>
}

const daysLeft = (deletedAt: string) => {
  const msLeft = new Date(deletedAt).getTime() + 15 * 24 * 60 * 60 * 1000 - Date.now()
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
}

export const ArchivedStoresList = ({ stores, canManage = true, onRestore }: ArchivedStoresListProps) => {
  const [open, setOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  if (stores.length === 0) return null

  const handleRestore = async (storeId: string) => {
    setRestoringId(storeId)
    setRestoreError(null)
    try {
      await onRestore(storeId)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Ошибка восстановления')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span>
          Архив магазинов
          <span className="ml-1.5 inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-500">
            {stores.length}
          </span>
        </span>
      </button>

      {open && (
        <Card className="mt-2 overflow-hidden rounded-3xl">
          {restoreError && (
            <div className="mx-3 mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-600">
              {restoreError}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Название</th>
                  <th className="px-3 py-2.5">Маркетплейс</th>
                  <th className="px-3 py-2.5">Store Code</th>
                  <th className="px-3 py-2.5">Удалён</th>
                  <th className="px-3 py-2.5">Осталось</th>
                  {canManage && <th className="w-28 px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {stores.map((store) => {
                  const days = store.deleted_at ? daysLeft(store.deleted_at) : 0
                  const isRestoring = restoringId === store.id
                  return (
                    <tr key={store.id} className="transition hover:bg-slate-50/70">
                      <td className="px-3 py-3 font-medium text-slate-500">{store.name}</td>
                      <td className="px-3 py-3 text-slate-400">{store.marketplace}</td>
                      <td className="px-3 py-3 font-semibold text-slate-400">{store.store_code}</td>
                      <td className="px-3 py-3 text-slate-400">
                        {store.deleted_at
                          ? new Date(store.deleted_at).toLocaleDateString('ru-RU')
                          : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${
                            days <= 3
                              ? 'bg-rose-50 text-rose-600'
                              : days <= 7
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {days} дн.
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            disabled={isRestoring}
                            onClick={() => void handleRestore(store.id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className={`h-3 w-3 ${isRestoring ? 'animate-spin' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              {isRestoring ? (
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                              ) : (
                                <>
                                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                                  <path d="M21 3v5h-5" />
                                </>
                              )}
                            </svg>
                            {isRestoring ? 'Восстановление...' : 'Восстановить'}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
