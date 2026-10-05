import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function ImplementationInquiryForm({ accountId }: { accountId: string }) {
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const lock = useRef(false)
  const requestId = useRef(crypto.randomUUID())
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase || lock.current) return
    lock.current = true; setBusy(true); setMessage(''); setFailed(false)
    try {
      const { error } = await supabase.from('implementation_inquiries' as never).insert({
        id: requestId.current, account_id: accountId, description: description.trim(),
      } as never)
      // Repeating the same submitted UUID after a lost response must not duplicate it.
      if (error && error.code !== '23505') throw error
      setDescription(''); requestId.current = crypto.randomUUID()
      setMessage('Обращение отправлено команде ELESTET.')
    } catch { setFailed(true); setMessage('Не удалось отправить обращение. Попробуйте ещё раз.') }
    finally { setBusy(false); lock.current = false }
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Обсудить внедрение</h2>
    <p className="mt-2 text-sm text-slate-500">Опишите задачу — обращение поступит нашей команде. Объём работ и начало согласуем отдельно.</p>
    <form onSubmit={e => void submit(e)} className="mt-4 grid gap-3">
      <label className="text-sm">Описание задачи
        <textarea required minLength={10} maxLength={10000} disabled={busy} value={description} onChange={e => { setDescription(e.target.value); requestId.current = crypto.randomUUID() }} className="mt-1 h-32 w-full rounded-xl border border-slate-200 p-3" />
      </label>
      <div className="h-12 overflow-auto text-sm" aria-live="polite"><span className={failed ? 'text-red-600' : 'text-emerald-700'}>{message}</span></div>
      <button disabled={busy || description.trim().length < 10} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Отправка…' : 'Отправить описание'}</button>
    </form>
    <a href="https://t.me/elestet" target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-blue-600">Связаться отдельно в Telegram</a>
  </section>
}
