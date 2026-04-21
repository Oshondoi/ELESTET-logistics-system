import { useState } from 'react'
import type { Store } from '../../types'
import { Card } from '../ui/Card'
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal'

interface StoreListProps {
  stores: Store[]
  onEdit: (store: Store) => void
  onDelete: (storeId: string) => Promise<void>
}

export const StoreList = ({ stores, onEdit, onDelete }: StoreListProps) => {
  const [deleteTarget, setDeleteTarget] = useState<Store | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Card className="overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Название</th>
                <th className="px-3 py-2.5">Маркетплейс</th>
                <th className="px-3 py-2.5">Store Code</th>
                <th className="px-3 py-2.5">Создан</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {stores.map((store) => (
                <tr key={store.id} className="transition hover:bg-slate-50/70">
                  <td className="px-3 py-3.5 font-medium text-slate-900">{store.name}</td>
                  <td className="px-3 py-3.5 text-slate-600">{store.marketplace}</td>
                  <td className="px-3 py-3.5 font-semibold text-slate-900">{store.store_code}</td>
                  <td className="px-3 py-3.5 text-slate-600">
                    {new Date(store.created_at).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onEdit(store)}
                        aria-label={`Редактировать ${store.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(store)}
                        aria-label={`Удалить ${store.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d="M9 4h6" /><path d="M5 7h14" />
                          <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                          <path d="M10 11v4" /><path d="M14 11v4" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить магазин?"
        description={`Магазин «${deleteTarget?.name ?? ''}» будет удалён. Это действие нельзя отменить.`}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={() => { if (!isDeleting) { setDeleteTarget(null); setDeleteError(null) } }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  )
}
