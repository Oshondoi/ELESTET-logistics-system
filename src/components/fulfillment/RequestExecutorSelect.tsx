import { useEffect, useId, useRef, useState } from 'react'
import { fetchRecentExecutorAccounts, searchExecutorAccounts } from '../../services/requestService'
import type { ExecutorAccountSearchResult } from '../../types'

export function RequestExecutorSelect({ value, onChange, accountId, disabled = false }: {
  value: ExecutorAccountSearchResult | null
  onChange: (value: ExecutorAccountSearchResult) => void
  accountId?: string
  disabled?: boolean
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const [recent, setRecent] = useState<ExecutorAccountSearchResult[]>([])
  const [results, setResults] = useState<ExecutorAccountSearchResult[]>([])
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setRecent([])
    if (accountId) void fetchRecentExecutorAccounts(accountId).then(rows => { if (!cancelled) setRecent(rows) }).catch(() => { if (!cancelled) setError('Не удалось загрузить список. Используйте поиск.') })
    return () => { cancelled = true }
  }, [accountId])
  useEffect(() => {
    let cancelled = false
    setResults([])
    setError('')
    setLoading(Boolean(open && query.trim()))
    if (!open || !query.trim()) return
    const timer = window.setTimeout(() => {
      void searchExecutorAccounts(query.trim()).then(rows => { if (!cancelled) setResults(rows) })
        .catch(() => { if (!cancelled) setError('Не удалось выполнить поиск. Повторите попытку.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, query])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const choose = (row: ExecutorAccountSearchResult) => { onChange(row); setOpen(false); setQuery('') }
  const option = (row: ExecutorAccountSearchResult) => <button type="button" key={row.id} onClick={() => choose(row)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50">C-{row.short_id} · {row.name}</button>
  return <div ref={root} className="relative text-sm" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation() } }}>
    <span id={id}>Исполнитель</span>
    <button type="button" aria-labelledby={id} aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)} className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left disabled:opacity-50">
      <span>{value ? `C-${value.short_id} · ${value.name}` : 'Выберите исполнителя'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="absolute z-20 mt-1 w-full rounded-xl border bg-white p-2 shadow-xl">
      <div className="max-h-44 overflow-y-auto">
        <p className="px-3 py-1 text-xs text-slate-500">Работали вместе</p>
        {recent.length ? recent.map(option) : <p className="px-3 py-2 text-xs text-slate-400">Пока нет подтверждённых заявок</p>}
      </div>
      <input autoFocus aria-label="Поиск исполнителя" placeholder="Название или точный C-ID" value={query} onChange={event => setQuery(event.target.value)} className="my-2 w-full rounded-lg border px-3 py-2" />
      <div className="max-h-44 overflow-y-auto">
        {loading ? <p className="px-3 py-2 text-slate-400">Поиск…</p> : error ? <p role="alert" className="px-3 py-2 text-rose-600">{error}</p> : query.trim() ? results.length ? results.map(option) : <p className="px-3 py-2 text-slate-400">Ничего не найдено</p> : value && option(value)}
      </div>
    </div>}
  </div>
}
