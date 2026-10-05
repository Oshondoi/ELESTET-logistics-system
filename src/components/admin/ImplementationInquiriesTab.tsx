import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Inquiry { id: string; account_id: string; user_id: string; description: string; created_at: string }
export function ImplementationInquiriesTab() {
  const [rows, setRows] = useState<Inquiry[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function reload() {
    if (!supabase) return
    setBusy(true); setError('')
    try {
      const { data, error } = await supabase.from('implementation_inquiries' as never).select('*').order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      setRows(data as unknown as Inquiry[])
    } catch { setError('Не удалось загрузить обращения.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void reload() }, [])
  return <section className="grid gap-4">
    <div className="flex justify-between"><h2 className="font-semibold">Обращения на внедрение — последние 100</h2><button disabled={busy} onClick={() => void reload()}>Обновить</button></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!busy && !error && !rows.length && <p>Обращений пока нет.</p>}
    {rows.map(row => <article key={row.id} className="rounded-2xl border bg-white p-4">
      <p className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString('ru-RU')} · Компания: {row.account_id} · Автор: {row.user_id}</p>
      <p className="mt-3 whitespace-pre-wrap break-words">{row.description}</p>
    </article>)}
  </section>
}
