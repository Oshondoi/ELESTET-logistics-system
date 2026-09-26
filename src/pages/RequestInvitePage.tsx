import { useEffect, useState } from 'react'
import { getPublicServiceRequestInvite } from '../services/requestService'
import { validatePassword } from '../lib/passwordUtils'

interface Props {
  token: string
  isSignedIn: boolean
  onSignUp: (values: { fullName: string; email: string; password: string }) => Promise<unknown>
  onContinue: () => void
}

export const RequestInvitePage = ({ token, isSignedIn, onSignUp, onContinue }: Props) => {
  const [inviteName, setInviteName] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  const [passwordReady, setPasswordReady] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)

  useEffect(() => { void getPublicServiceRequestInvite(token).then((row) => { setInviteName(`C-${row.executor_short_id} · ${row.executor_name}`); setAvailable(row.is_available) }).catch((e) => { setError(e instanceof Error ? e.message : 'Ссылка недоступна'); setAvailable(false) }) }, [token])

  const remember = () => { localStorage.setItem('elestet-pending-request-invite', token); onContinue() }
  if (isSignedIn) return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl"><h1 className="text-xl font-semibold">Заявка для {inviteName}</h1><p className="mt-2 text-sm text-slate-500">Исполнитель будет выбран автоматически.</p><button onClick={remember} className="mt-5 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white">Перейти к заявке</button></div></div>
  if (available === null) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">Проверка ссылки…</div>
  if (!available) return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="rounded-3xl bg-white p-8 text-center shadow"><h1 className="font-semibold">Ссылка недействительна</h1><p className="mt-2 text-sm text-slate-500">Срок ссылки — 30 дней. Попросите исполнителя создать новую.</p>{error && <p className="mt-2 text-xs text-rose-500">{error}</p>}</div></div>

  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"><p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Приглашение от {inviteName}</p><h1 className="mt-2 text-xl font-semibold text-slate-900">{passwordReady ? 'Данные заявителя' : 'Создайте пароль'}</h1><p className="mt-1 text-sm text-slate-500">{passwordReady ? 'Почта и имя привяжутся при первой подтверждённой заявке.' : 'Без пароля форма заявки не откроется.'}</p>
    {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
    {!passwordReady ? <div className="mt-5 space-y-3"><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Пароль" className="w-full rounded-xl border px-3 py-2.5" /><input type="password" value={passwordAgain} onChange={(e)=>setPasswordAgain(e.target.value)} placeholder="Повторите пароль" className="w-full rounded-xl border px-3 py-2.5" /><button onClick={()=>{const message=validatePassword(password);if(message){setError(message);return}if(password!==passwordAgain){setError('Пароли не совпадают');return}setError('');setPasswordReady(true)}} className="w-full rounded-2xl bg-blue-600 py-2.5 text-sm font-medium text-white">Продолжить</button></div> : confirmationSent ? <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">Регистрация создана. Если требуется подтверждение почты, подтвердите её и снова откройте эту ссылку.</div> : <div className="mt-5 space-y-3"><input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Имя" className="w-full rounded-xl border px-3 py-2.5" /><input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Почта" className="w-full rounded-xl border px-3 py-2.5" /><button disabled={busy} onClick={async()=>{if(!name.trim()||!email.trim()){setError('Укажите имя и почту');return}setBusy(true);setError('');try{localStorage.setItem('elestet-pending-request-invite',token);await onSignUp({fullName:name.trim(),email:email.trim(),password});setConfirmationSent(true)}catch(e){setError(e instanceof Error?e.message:'Не удалось зарегистрироваться')}finally{setBusy(false)}}} className="w-full rounded-2xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy?'Создание…':'Создать аккаунт и открыть заявку'}</button></div>}
  </div></div>
}
