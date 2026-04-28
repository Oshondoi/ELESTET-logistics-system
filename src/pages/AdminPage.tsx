import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'

interface AdminUser {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  companies: number
  stores: number
  company_names: string[]
  short_id: number | null
}

interface AdminStats {
  total_users: number
  total_companies: number
  total_stores: number
  users: AdminUser[]
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export const AdminPage = () => {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<AdminStats & { error?: string }>(
        'admin-stats',
      )
      if (fnErr) throw fnErr
      if (!data) throw new Error('Пустой ответ')
      if (data.error) throw new Error(data.error)
      setStats(data as AdminStats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = stats?.users.filter((u) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return u.email.toLowerCase().includes(q) || u.company_names.some((n) => n.toLowerCase().includes(q))
  }) ?? []

  return (
    <div className="space-y-4">
      {/* Метрики */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Пользователей', value: stats?.total_users ?? '—', color: 'text-blue-600' },
          { label: 'Компаний', value: stats?.total_companies ?? '—', color: 'text-violet-600' },
          { label: 'Магазинов', value: stats?.total_stores ?? '—', color: 'text-emerald-600' },
        ].map((m) => (
          <Card key={m.label} className="rounded-3xl p-5">
            <div className={`text-3xl font-black ${m.color}`}>{m.value}</div>
            <div className="mt-1 text-sm text-slate-500">{m.label}</div>
          </Card>
        ))}
      </div>

      {/* Таблица пользователей */}
      <Card className="overflow-hidden rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Поиск по email или компании..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-transparent bg-slate-100 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.36 2.64L21 3v6h-6l2.12-2.12" />
            </svg>
            Обновить
          </button>
        </div>

        {error && (
          <div className="px-5 py-4 text-sm text-rose-500">{error}</div>
        )}

        {isLoading && !stats && (
          <div className="flex items-center justify-center py-14 text-sm text-slate-400">Загрузка...</div>
        )}

        {stats && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-slate-400">№</th>
                  <th className="px-4 py-3 text-slate-400">ID</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-4 py-3">Зарегистрирован</th>
                  <th className="px-4 py-3">Последний вход</th>
                  <th className="px-4 py-3 text-center">Компаний</th>
                  <th className="px-4 py-3 text-center">Магазинов</th>
                  <th className="px-4 py-3">Компании</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((u, idx) => (
                  <tr key={u.id} className="align-middle hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-400">
                      {u.short_id != null ? `U${u.short_id}` : '—'}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-800">{u.email}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(u.last_sign_in_at)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${u.companies > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'}`}>
                        {u.companies}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${u.stores > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                        {u.stores}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.company_names.map((name) => (
                          <span key={name} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {name}
                          </span>
                        ))}
                        {u.company_names.length === 0 && (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Ничего не найдено</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
