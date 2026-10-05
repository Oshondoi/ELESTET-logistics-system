import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { createEmailCodeRequest } from '../../lib/emailCodeRequest'
import { EmailCodeRequestHint } from './EmailCodeRequestHint'

export function SignupConfirmationForm({ email, justSent, initialRequestedAt, onBack }: { email: string; justSent: boolean; initialRequestedAt?: string | null; onBack: () => void }) {
  const [requestedAt, setRequestedAt] = useState(initialRequestedAt)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const locked = useRef(false)
  const [retryAt, setRetryAt] = useState(() => justSent ? Date.now() + 60_000 : 0)
  const [now, setNow] = useState(Date.now())
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  async function submit(resend: boolean) {
    if (!supabase || locked.current || (resend && Date.now() < retryAt)) return
    locked.current = true
    setBusy(true)
    setSending(resend)
    setError('')
    try {
      const request = resend ? await createEmailCodeRequest(email, 'signup') : null
      const result = resend
        ? await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: request!.redirectTo } })
        : await supabase.auth.verifyOtp({ type: 'signup', email, token: code })
      if (result.error) {
        if (result.error.status === 429) {
          setRetryAt(Date.now() + 60_000)
          setError('Слишком много попыток. Подождите минуту и повторите.')
        } else {
          setError(resend ? 'Не удалось отправить код. Повторите попытку позже.' : 'Код неверный или срок его действия истёк. Проверьте код или запросите новый.')
        }
        return
      }
      if (resend) { setRequestedAt(request!.requestedAt); setRetryAt(Date.now() + 60_000); setNow(Date.now()); setCode('') }
      // Successful signup verification establishes the main Auth session.
    } catch {
      setError('Не удалось выполнить запрос. Проверьте соединение и повторите попытку.')
    } finally { locked.current = false; setBusy(false); setSending(false) }
  }

  return <div className="grid h-[520px] content-start gap-4 overflow-auto">
    <h2 className="text-lg font-semibold text-slate-800">Подтвердите почту</h2>
    <EmailCodeRequestHint requestedAt={requestedAt} sending={sending} />
    <p className="text-sm text-slate-600">Введите шестизначный код из письма на <strong className="break-all">{email}</strong>, чтобы завершить регистрацию.</p>
    <div className="h-20 overflow-auto">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</div>
    <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void submit(false) }}>
      <Input label="Код подтверждения" placeholder="Шестизначный код" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required disabled={busy} />
      <Button type="submit" disabled={busy || code.length !== 6}>Подтвердить почту</Button>
    </form>
    <button type="button" disabled={busy || remaining > 0} onClick={() => void submit(true)} className="text-sm text-blue-600 disabled:text-slate-400">{remaining > 0 ? `Отправить повторно через ${remaining} с` : 'Отправить код повторно'}</button>
    <button type="button" disabled={busy} onClick={onBack} className="text-sm text-slate-500">Изменить адрес / вернуться к входу</button>
  </div>
}
