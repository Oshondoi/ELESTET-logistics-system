import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { normalizePassword, passwordsMatch, validatePassword } from '../../lib/passwordUtils'
import { createEmailCodeRequest } from '../../lib/emailCodeRequest'
import { EmailCodeRequestHint } from './EmailCodeRequestHint'

export const RECOVERY_MESSAGE = 'Если аккаунт с этой почтой существует, мы отправили код. Не получили письмо? Проверьте адрес и папку «Спам».'

export function PasswordRecoveryForm({ initialEmail = '', onBack }: { initialEmail?: string; onBack: () => void }) {
  // Recovery credentials stay in this form's memory. Verifying the code must not
  // sign the main app in before the user has saved their new password.
  const [client] = useState(() => createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'elestet-password-recovery' },
  }))
  const [step, setStep] = useState<'email' | 'code' | 'password' | 'done'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [retryAt, setRetryAt] = useState(0)
  const [requestedAt, setRequestedAt] = useState<string | null>(null)
  const [senderName, setSenderName] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => { window.clearInterval(timer) }
  }, [])

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await action() } catch { setError('Не удалось выполнить запрос. Проверьте соединение и повторите попытку.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function sendCode() {
    if (Date.now() < retryAt) return
    await run(async () => {
      // /recover deliberately returns the same response for missing accounts;
      // unlike /otp it never signs an unknown email up.
      const request = await createEmailCodeRequest(email, 'recovery')
      const { error: sendError } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: request.redirectTo,
      })
      if (sendError && sendError.status !== 429) throw sendError
      setRequestedAt(sendError ? null : request.requestedAt)
      setSenderName(sendError ? null : request.senderName)
      setCode('')
      setStep('code')
      setRetryAt(Date.now() + 60_000)
      setNow(Date.now())
    })
  }

  async function verifyCode() {
    await run(async () => {
      const { data, error: verifyError } = await client.auth.verifyOtp({ email: email.trim(), token: code, type: 'recovery' })
      if (verifyError || !data.session) {
        setError('Код неверный или срок его действия истёк. Проверьте код или запросите новый.')
        return
      }
      setCode('')
      setStep('password')
    })
  }

  async function savePassword() {
    const invalid = validatePassword(password)
    if (invalid) { setError(invalid); return }
    if (!passwordsMatch(password, repeat)) { setError('Пароли не совпадают'); return }
    await run(async () => {
      const { error: updateError } = await client.auth.updateUser({ password: normalizePassword(password) })
      if (updateError) {
        setError(updateError.code === 'same_password' ? 'Укажите пароль, который отличается от прежнего.' : 'Не удалось сохранить пароль. Повторите попытку или запросите новый код.')
        return
      }
      // Revoke refresh sessions, including the temporary recovery session.
      await client.auth.signOut({ scope: 'global' })
      setPassword('')
      setRepeat('')
      setStep('done')
    })
  }

  return <div className="grid h-[580px] content-start gap-4 overflow-auto">
    <h2 className="text-lg font-semibold text-slate-800">Восстановление пароля</h2>
    <div className="h-20 overflow-auto">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</div>
    {step === 'email' && <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void sendCode() }}>
      <Input label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
      <Button type="submit" disabled={busy || remaining > 0}>{remaining > 0 ? `Отправить код через ${remaining} с` : busy ? 'Отправка…' : 'Отправить код'}</Button>
    </form>}
    {step === 'code' && <>
      <p className="text-sm text-slate-600">{RECOVERY_MESSAGE}</p>
      <p className="break-all text-sm font-medium">{email.trim()}</p>
      <EmailCodeRequestHint requestedAt={requestedAt} senderName={senderName} />
      <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void verifyCode() }}>
        <Input label="Код из письма" placeholder="Шестизначный код" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required disabled={busy} />
        <Button type="submit" disabled={busy || code.length !== 6}>Подтвердить код</Button>
      </form>
      <button type="button" disabled={busy || remaining > 0} onClick={() => void sendCode()} className="text-sm text-blue-600 disabled:text-slate-400">{remaining > 0 ? `Отправить повторно через ${remaining} с` : 'Отправить код повторно'}</button>
      <button type="button" disabled={busy} onClick={() => { setStep('email'); setCode(''); setError('') }} className="text-sm text-blue-600">Изменить почту</button>
    </>}
    {step === 'password' && <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void savePassword() }}>
      <Input label="Новый пароль" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
      <Input label="Повторите пароль" type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required disabled={busy} />
      <Button type="submit" disabled={busy}>Сохранить пароль</Button>
    </form>}
    {step === 'done' && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Пароль изменён. Войдите с новым паролем.</p>}
    <button type="button" disabled={busy} onClick={onBack} className="text-sm text-slate-500">← Назад к входу</button>
  </div>
}
