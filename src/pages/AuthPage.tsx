import { useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { supabase } from '../lib/supabase'
import { passwordsMatch, validatePassword } from '../lib/passwordUtils'
import { toUserMessage, USER_MESSAGE_DURATION } from '../lib/userMessage'

interface AuthPageProps {
  isSupabaseConfigured: boolean
  onSignIn: (values: { email: string; password: string }) => Promise<void>
  onSignUp: (values: { fullName: string; email: string; password: string }) => Promise<unknown>
}

type AuthMode = 'sign-in' | 'sign-up' | 'forgot'

const validatePasswordLocal = (password: string) => validatePassword(password)

const initialValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
}

export const AuthPage = ({ isSupabaseConfigured, onSignIn, onSignUp }: AuthPageProps) => {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [values, setValues] = useState(initialValues)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false)

  // Автоскрытие тоста ошибки через 4 сек
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), USER_MESSAGE_DURATION.error)
    return () => clearTimeout(t)
  }, [error])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!isSupabaseConfigured) {
      setError('Supabase не настроен. Проверь `.env`.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      if (mode === 'sign-up' && !values.fullName.trim()) {
        setError('Введите имя')
        return
      }

      const passwordError = validatePasswordLocal(values.password)

      if (passwordError) {
        setError(passwordError)
        return
      }

      if (mode === 'sign-up' && !passwordsMatch(values.password, values.confirmPassword)) {
        setError('Пароли не совпадают')
        return
      }

      if (mode === 'sign-in') {
        await onSignIn({
          email: values.email.trim(),
          password: values.password,
        })
        return
      }

      await onSignUp({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
      })

      setSuccess('Регистрация выполнена. Если включено email confirmation, подтверди почту и затем войди.')
      setMode('sign-in')
      setValues((current) => ({ ...current, password: '' }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ошибка авторизации')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setIsForgotSubmitting(true)
    setError(null)
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const { error: forgotErr } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), { redirectTo })
      if (forgotErr) throw forgotErr
      setForgotSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки')
    } finally {
      setIsForgotSubmitting(false)
    }
  }

  return (
    <div className="flex h-[100dvh] min-h-[100svh] w-full items-center justify-center overflow-hidden bg-slate-50 p-3 sm:p-4">
      {success ? (
        <div className="fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-50 w-[min(640px,calc(100%-24px))] -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm sm:top-5 sm:w-[min(640px,calc(100%-32px))] sm:px-5 sm:py-4">
          Подтвердите почту, чтобы завершить регистрацию и войти в систему.
        </div>
      ) : null}
      {error ? (
        <div className="fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-lg sm:left-auto sm:right-5 sm:top-5 sm:max-w-sm sm:px-5 sm:py-4">
          {toUserMessage(error, 'error')}
          <button type="button" onClick={() => setError(null)} className="ml-3 opacity-70 hover:opacity-100">✕</button>
        </div>
      ) : null}

      <div className="flex max-h-full w-full max-w-[440px] flex-col overflow-y-auto overscroll-contain rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7 [@media(max-height:700px)]:rounded-2xl [@media(max-height:700px)]:p-4">
        <div className="mb-5 [@media(max-height:700px)]:mb-3">
          <div className="text-[28px] font-black uppercase leading-none tracking-tight text-slate-900 sm:text-[30px]">ELESTET</div>
        </div>

        {/* ── Режим: Забыли пароль ── */}
        {mode === 'forgot' && (
          <div className="flex flex-1 flex-col">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Восстановление пароля</h2>
            <p className="mb-5 text-sm text-slate-400 [@media(max-height:700px)]:mb-3">Введите email — отправим ссылку для сброса</p>
            {forgotSent ? (
              <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
                Письмо отправлено на <strong>{forgotEmail}</strong>. Проверьте почту и перейдите по ссылке.
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={handleForgotSubmit}>
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="w-full" disabled={isForgotSubmitting}>
                  {isForgotSubmitting ? 'Отправка...' : 'Отправить ссылку'}
                </Button>
              </form>
            )}
            <button
              type="button"
              onClick={() => { setMode('sign-in'); setForgotSent(false); setForgotEmail(''); setError(null) }}
              className="mt-4 text-sm text-slate-400 hover:text-slate-600"
            >
              ← Назад к входу
            </button>
          </div>
        )}

        {/* ── Режим: Вход / Регистрация ── */}
        {mode !== 'forgot' && (<>

        <div className="mb-5 flex rounded-2xl bg-slate-100 p-1 [@media(max-height:700px)]:mb-3">
          <button
            type="button"
            onClick={() => {
              setMode('sign-in')
              setError(null)
              setSuccess(null)
              setShowPassword(false)
              setShowConfirmPassword(false)
            }}
            className={`flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition ${
              mode === 'sign-in' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('sign-up')
              setError(null)
              setSuccess(null)
              setShowPassword(false)
              setShowConfirmPassword(false)
            }}
            className={`flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition ${
              mode === 'sign-up' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Регистрация
          </button>
        </div>

        <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="grid content-start gap-4 [@media(max-height:700px)]:gap-3">

            {/* Имя занимает место только в регистрации — форма входа остаётся компактной. */}
            <div className={mode === 'sign-up' ? undefined : 'hidden'}>
              <Input
                label="Имя"
                placeholder="Как к вам обращаться"
                value={values.fullName}
                onChange={(event) => setValues((current) => ({ ...current, fullName: event.target.value }))}
                required={mode === 'sign-up'}
                tabIndex={mode === 'sign-up' ? undefined : -1}
              />
            </div>

            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={values.email}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
              required
            />

            {/* Пароль с глазком */}
            <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
              <span className="font-medium">Пароль</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Минимум 6 символов и 1 цифра"
                  value={values.password}
                  onChange={(e) => setValues((c) => ({ ...c, password: e.target.value }))}
                  required
                  minLength={6}
                  className="block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <span className="text-xs text-slate-500">Только буквы и цифры. Хотя бы 1 цифра. Регистр не учитывается.</span>
            </label>

            {/* Подтверждение пароля занимает место только в регистрации. */}
            <div className={mode === 'sign-up' ? undefined : 'hidden'}>
              <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
                <span className="font-medium">Подтвердите пароль</span>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Повторите пароль"
                    value={values.confirmPassword}
                    onChange={(e) => setValues((c) => ({ ...c, confirmPassword: e.target.value }))}
                    required={mode === 'sign-up'}
                    tabIndex={mode === 'sign-up' ? undefined : -1}
                    className="block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPassword ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </label>
            </div>
          </div>

          <Button type="submit" className="mt-5 w-full [@media(max-height:700px)]:mt-3" disabled={isSubmitting}>
            {isSubmitting
              ? 'Подождите...'
              : mode === 'sign-in'
                ? 'Войти'
                : 'Зарегистрироваться'}
          </Button>
          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(null) }}
              className="mt-3 text-center text-xs text-slate-400 hover:text-slate-600"
            >
              Забыли пароль?
            </button>
          )}
        </form>
      </>)}
      </div>
    </div>
  )
}
