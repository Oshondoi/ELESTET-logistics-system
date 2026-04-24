import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { supabase } from '../../lib/supabase'

interface ProfileModalProps {
  open: boolean
  onClose: () => void
  userEmail: string
  userName: string
  userId: string
  onNameChange: (name: string) => void
}

export const ProfileModal = ({
  open,
  onClose,
  userEmail,
  userName,
  userId,
  onNameChange,
}: ProfileModalProps) => {
  const [fullName, setFullName] = useState(userName)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingName, setIsSavingName] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSuccess, setNameSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  useEffect(() => {
    if (open) {
      setFullName(userName)
      setNewPassword('')
      setConfirmPassword('')
      setNameError(null)
      setNameSuccess(false)
      setPasswordError(null)
      setPasswordSuccess(false)
    }
  }, [open, userName])

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) {
      setNameError('Введите имя')
      return
    }
    if (!supabase) return
    setIsSavingName(true)
    setNameError(null)
    setNameSuccess(false)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() },
      })
      if (error) throw error

      await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('user_id', userId)

      onNameChange(fullName.trim())
      setNameSuccess(true)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Ошибка при сохранении')
    } finally {
      setIsSavingName(false)
    }
  }

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPassword) {
      setPasswordError('Введите новый пароль')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Пароль должен быть не менее 6 символов')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Пароли не совпадают')
      return
    }
    if (!supabase) return
    setIsSavingPassword(true)
    setPasswordError(null)
    setPasswordSuccess(false)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess(true)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Ошибка при смене пароля')
    } finally {
      setIsSavingPassword(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Настройки профиля">
      <div className="grid gap-6">
        {/* Email */}
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Email</p>
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {userEmail}
          </p>
        </div>

        {/* Имя */}
        <form className="grid gap-3" onSubmit={(e) => void handleSaveName(e)}>
          <Input
            label="Полное имя"
            placeholder="Ваше имя"
            value={fullName}
            onChange={(e) => { setFullName(e.target.value); setNameSuccess(false) }}
          />
          {nameError ? (
            <p className="text-sm text-rose-500">{nameError}</p>
          ) : null}
          {nameSuccess ? (
            <p className="text-sm text-emerald-600">Имя обновлено</p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={isSavingName}>
              {isSavingName ? 'Сохранение...' : 'Сохранить имя'}
            </Button>
          </div>
        </form>

        <hr className="border-slate-100" />

        {/* Смена пароля */}
        <form className="grid gap-3" onSubmit={(e) => void handleSavePassword(e)}>
          <p className="text-sm font-medium text-slate-700">Смена пароля</p>
          <Input
            label="Новый пароль"
            type="password"
            placeholder="Минимум 6 символов"
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPasswordSuccess(false) }}
          />
          <Input
            label="Повторите пароль"
            type="password"
            placeholder=""
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setPasswordSuccess(false) }}
          />
          {passwordError ? (
            <p className="text-sm text-rose-500">{passwordError}</p>
          ) : null}
          {passwordSuccess ? (
            <p className="text-sm text-emerald-600">Пароль успешно изменён</p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={isSavingPassword}>
              {isSavingPassword ? 'Сохранение...' : 'Сменить пароль'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
