import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

interface AuthPageProps {
  isSupabaseConfigured: boolean
  onSignIn: (values: { email: string; password: string }) => Promise<void>
  onSignUp: (values: { fullName: string; email: string; password: string }) => Promise<unknown>
}

type AuthMode = 'sign-in' | 'sign-up'

const passwordPattern = /^(?=.*\d)[A-Za-z\d]{6,}$/

const validatePassword = (password: string) => {
  if (!passwordPattern.test(password)) {
    return 'Пароль: минимум 6 символов, только буквы и цифры, хотя бы 1 цифра. Регистр не учитывается.'
  }

  return null
}

const initialValues = {
  fullName: '',
  email: '',
  password: '',
}

export const AuthPage = ({ isSupabaseConfigured, onSignIn, onSignUp }: AuthPageProps) => {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [values, setValues] = useState(initialValues)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
      const passwordError = validatePassword(values.password)

      if (passwordError) {
        setError(passwordError)
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      {success ? (
        <div className="fixed left-1/2 top-5 z-50 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm">
          Подтвердите почту, чтобы завершить регистрацию и войти в систему.
        </div>
      ) : null}

      <div className="w-full max-w-[440px] rounded-[28px] border border-slate-200 bg-white p-7 shadow-sm min-h-[506px]">
        <div className="mb-6">
          <div className="text-[30px] font-black uppercase leading-none tracking-tight text-slate-900">ELESTET</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Supply Logistics
          </div>
        </div>

        <div className="mb-5 flex rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('sign-in')
              setError(null)
              setSuccess(null)
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
            }}
            className={`flex-1 cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition ${
              mode === 'sign-up' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Регистрация
          </button>
        </div>

        <form className="flex min-h-[320px] flex-col" onSubmit={handleSubmit}>
          <div className="grid content-start gap-4">
            {mode === 'sign-up' ? (
              <Input
                label="Имя"
                placeholder="Как к вам обращаться"
                value={values.fullName}
                onChange={(event) => setValues((current) => ({ ...current, fullName: event.target.value }))}
                required
              />
            ) : null}

            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={values.email}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
              required
            />

            <Input
              label="Пароль"
              type="password"
            placeholder="Минимум 6 символов и 1 цифра"
              value={values.password}
              onChange={(event) => setValues((current) => ({ ...current, password: event.target.value }))}
              required
              minLength={6}
            hint="Только буквы и цифры. Хотя бы 1 цифра. Регистр не учитывается."
            />

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : null}

          </div>

          <Button type="submit" className="mt-auto w-full" disabled={isSubmitting}>
            {isSubmitting
              ? 'Подождите...'
              : mode === 'sign-in'
                ? 'Войти'
                : 'Зарегистрироваться'}
          </Button>
        </form>
      </div>
    </div>
  )
}
