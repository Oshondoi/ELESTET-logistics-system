import { useState, useEffect } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface DeleteConfirmModalProps {
  open: boolean
  title: string
  description: string
  isSubmitting: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
  requirePassword?: boolean
  passwordValue?: string
  onPasswordChange?: (value: string) => void
}

export const DeleteConfirmModal = ({
  open,
  title,
  description,
  isSubmitting,
  error,
  onClose,
  onConfirm,
  requirePassword,
  passwordValue,
  onPasswordChange,
}: DeleteConfirmModalProps) => {
  const [pwReady, setPwReady] = useState(false)

  useEffect(() => {
    if (!open) setPwReady(false)
  }, [open])

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="space-y-4 pt-1">
        {error ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error}
          </div>
        ) : null}

        {requirePassword && (
          <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
            <span className="font-medium">Введите пароль для подтверждения</span>
            <input
              type="password"
              readOnly={!pwReady}
              onFocus={() => setPwReady(true)}
              placeholder="Ваш пароль"
              value={passwordValue ?? ''}
              onChange={(e) => onPasswordChange?.(e.target.value)}
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore
              className="block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-0"
            />
          </label>
        )}

        <div className="flex justify-center gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || (requirePassword && !passwordValue?.trim())}
            className="inline-flex items-center justify-center rounded-xl border border-[#FF5B5B] bg-[#FF5B5B] px-4 py-2 text-sm font-medium text-white transition hover:border-[#F04444] hover:bg-[#F04444] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Удаление...' : 'Удалить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}