import { useEffect, useState } from 'react'
import { fetchLogisticsActivity, type LogisticsActivityEntry } from '../../services/logisticsActivityService'
import { formatDate } from '../../lib/utils'

export function LogisticsActivityJournal({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<LogisticsActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    void fetchLogisticsActivity(accountId)
      .then(setRows)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить журнал'))
      .finally(() => setLoading(false))
  }, [accountId])

  if (loading) return <p className="text-sm text-slate-400">Загрузка журнала…</p>
  if (error) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
  if (rows.length === 0) return <p className="text-sm text-slate-400">Записей пока нет.</p>

  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
          <p className="text-slate-800">{row.message}</p>
          <p className="mt-1 text-xs text-slate-500">
            {row.actor_label}: {row.actor_name || row.actor_email || '—'} · {formatDate(row.created_at)}{' '}
            {new Date(row.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {row.old_value != null && row.new_value != null && (
            <p className="mt-1 text-xs text-slate-400">
              Было: {row.old_value} → Стало: {row.new_value}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
