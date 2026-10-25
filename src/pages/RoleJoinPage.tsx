import { useEffect, useState } from 'react'
import { acceptRoleInvite, fetchPublicRoleInvite } from '../services/roleInviteService'

interface Props {
  token: string
  isSignedIn: boolean
  onSignIn: (credentials: { email: string; password: string }) => Promise<void>
  onSignUp: (credentials: { email: string; password: string; fullName: string }) => Promise<unknown>
  onJoined: (accountId: string) => void
}

export const RoleJoinPage = ({ token, isSignedIn, onSignIn, onSignUp, onJoined }: Props) => {
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof fetchPublicRoleInvite>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchPublicRoleInvite(token)
      .then(setInvite)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Ссылка недоступна'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!isSignedIn || !invite?.valid) return
    setBusy(true)
    void acceptRoleInvite(token)
      .then(({ account_id }) => {
        window.localStorage.removeItem('elestet-pending-role-join')
        onJoined(account_id)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось принять приглашение'))
      .finally(() => setBusy(false))
  }, [isSignedIn, invite?.valid, token, onJoined])

  const submitAuth = async () => {
    setBusy(true)
    setError(null)
    try {
      window.localStorage.setItem('elestet-pending-role-join', token)
      if (mode === 'signup') {
        await onSignUp({ email: email.trim(), password, fullName: fullName.trim() })
        setError('Подтвердите почту и войдите — приглашение применится автоматически.')
      } else {
        await onSignIn({ email: email.trim(), password })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Загрузка приглашения…
      </div>
    )
  }

  if (!invite?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Ссылка недействительна</p>
          <p className="mt-2 text-sm text-slate-500">Попросите новую ссылку у администратора компании.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Приглашение сотрудника</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{invite.company_name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Роль: <span className="font-semibold text-slate-800">{invite.role_name}</span>
        </p>
        {isSignedIn ? (
          <p className="mt-6 text-sm text-slate-500">{busy ? 'Подключаем к компании…' : 'Подключаем…'}</p>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex rounded-xl bg-slate-100 p-1">
              <button type="button" onClick={() => setMode('login')} className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Вход</button>
              <button type="button" onClick={() => setMode('signup')} className={`flex-1 rounded-lg py-2 text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Регистрация</button>
            </div>
            {mode === 'signup' && (
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Имя и фамилия" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
            )}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Почта" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Пароль" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
            <button type="button" disabled={busy} onClick={() => void submitAuth()} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? '…' : mode === 'signup' ? 'Зарегистрироваться' : 'Войти'}
            </button>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}
