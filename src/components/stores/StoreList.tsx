import { useState } from 'react'
import type { Store } from '../../types'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal'

interface StoreListProps {
  stores: Store[]
  onEdit: (store: Store) => void
  onDelete: (storeId: string) => Promise<void>
  onSync: (store: Store) => Promise<void>
  canManage?: boolean
}

export const StoreList = ({ stores, onEdit, onDelete, onSync, canManage = true }: StoreListProps) => {
  const [deleteTarget, setDeleteTarget] = useState<Store | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<{ id: string; msg: string } | null>(null)

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !supabase) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const email = userData.user?.email
      if (!email) throw new Error('Не удалось определить пользователя')
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password: deletePassword })
      if (authError) throw new Error('Неверный пароль')
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
      setDeletePassword('')
    } catch (err) {
      if (err instanceof Error) {
        setDeleteError(err.message)
      } else if (err && typeof err === 'object' && 'message' in err) {
        const e = err as { message?: string; details?: string; code?: string }
        setDeleteError(`${e.message ?? 'Ошибка'}${e.details ? ` — ${e.details}` : ''}${e.code ? ` (${e.code})` : ''}`)
      } else {
        setDeleteError(JSON.stringify(err))
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSync = async (store: Store) => {
    setSyncingId(store.id)
    setSyncError(null)
    try {
      await onSync(store)
    } catch (err) {
      setSyncError({ id: store.id, msg: err instanceof Error ? err.message : 'Ошибка синхронизации' })
    } finally {
      setSyncingId(null)
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
                <th className="px-3 py-2.5">API ключ</th>
                <th className="px-3 py-2.5">Поставщик</th>
                <th className="px-3 py-2.5">Наим. для стикера</th>
                <th className="px-3 py-2.5">Адрес</th>
                <th className="px-3 py-2.5">Создан</th>
                <th className="w-28 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {stores.map((store) => {
                const isSyncing = syncingId === store.id
                const hasKey = Boolean(store.api_key)
                const err = syncError?.id === store.id ? syncError.msg : null
                return (
                  <tr key={store.id} className="transition hover:bg-slate-50/70">
                    <td className="px-3 py-3.5 font-medium text-slate-900">{store.name}</td>
                    <td className="px-3 py-3.5 text-slate-600">{store.marketplace}</td>
                    <td className="px-3 py-3.5 font-semibold text-slate-900">{store.store_code}</td>
                    <td className="px-3 py-3.5">
                      {hasKey ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Есть
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-slate-600">
                      {store.supplier || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3.5 text-slate-500">
                      {store.supplier_full || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-3.5 text-slate-500">
                      {store.address || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3.5 text-slate-600">
                      {new Date(store.created_at).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="px-3 py-3.5">
                      {err && <p className="mb-1 text-[10px] text-rose-500">{err}</p>}
                      {canManage ? (
                      <div className="flex items-center">
                        {/* Синхронизация из WB */}
                        <button
                          type="button"
                          disabled={!hasKey || isSyncing}
                          onClick={() => void handleSync(store)}
                          aria-label={`Синхронизировать ${store.name} с WB`}
                          title={hasKey ? 'Получить данные из WB' : 'Нет API ключа'}
                          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                            <path d="M21 8v-4" /><path d="M3 16v4" />
                          </svg>
                        </button>
                        {/* Редактировать */}
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
                        {/* Удалить */}
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
                      ) : null}
                    </td>
                  </tr>
                )
              })}
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
        onClose={() => { if (!isDeleting) { setDeleteTarget(null); setDeleteError(null); setDeletePassword('') } }}
        onConfirm={() => void handleConfirmDelete()}
        requirePassword
        passwordValue={deletePassword}
        onPasswordChange={setDeletePassword}
      />
    </>
  )
}
