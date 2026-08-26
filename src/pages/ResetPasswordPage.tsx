import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { validatePassword, normalizePassword, passwordsMatch } from '../lib/passwordUtils'

interface ResetPasswordPageProps {
  onSuccess: () => void
}

export const ResetPasswordPage = ({ onSuccess }: ResetPasswordPageProps) => {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validationError = validatePassword(newPassword)
    if (validationError) { setError(validationError); return }
    if (!passwordsMatch(newPassword, confirmPassword)) { setError('Пароли не совпадают'); return }
    if (!supabase) return

    setIsSubmitting(true)
    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        password: normalizePassword(newPassword),
      })
      if (updateErr) throw updateErr
      setDone(true)
      setTimeout(() => onSuccess(), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при смене пароля')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-[440px] rounded-[28px] border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6">
          <div className="text-[30px] font-black uppercase leading-none tracking-tight text-slate-900">ELESTET</div>
        </div>

        {done ? (
          <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
            Пароль успешно изменён. Перенаправляем на вход...
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Новый пароль</h2>
            <p className="mb-5 text-sm text-slate-400">Введите новый пароль для вашего аккаунта</p>

            <form className="grid gap-4" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-2 text-sm text-slate-700">
                <span className="font-medium">Новый пароль</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Минимум 6 символов и 1 цифра"
                    required
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
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

              <label className="flex flex-col gap-2 text-sm text-slate-700">
                <span className="font-medium">Подтвердите пароль</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите пароль"
                  required
                  className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
                />
              </label>

              {error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 h-11 w-full rounded-2xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Сохранение...' : 'Сохранить пароль'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
