import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { Account, ResolvedUser, Role, RoleFormValues, RolePermissions } from '../../types'
import { DEFAULT_PERMISSIONS } from '../../types'
import { resolveAccountUser } from '../../services/roleService'

// ─── Группы прав ─────────────────────────────────────────────

interface PermGroup {
  label: string
  items: Array<{ key: keyof RolePermissions; label: string }>
}

const PERMISSION_GROUPS: PermGroup[] = [
  {
    label: 'Логистика',
    items: [
      { key: 'shipments_view', label: 'Просмотр отправлений' },
      { key: 'shipments_manage', label: 'Управление отправлениями' },
    ],
  },
  {
    label: 'Магазины',
    items: [
      { key: 'stores_view', label: 'Просмотр магазинов' },
      { key: 'stores_manage', label: 'Управление магазинами' },
    ],
  },
  {
    label: 'Справочники',
    items: [
      { key: 'directories_view', label: 'Просмотр справочников' },
      { key: 'directories_manage', label: 'Управление справочниками' },
    ],
  },
  {
    label: 'Стикеры',
    items: [
      { key: 'stickers_view', label: 'Просмотр стикеров' },
      { key: 'stickers_manage', label: 'Управление стикерами' },
    ],
  },
  {
    label: 'Администрирование',
    items: [
      { key: 'roles_manage', label: 'Управление ролями' },
      { key: 'members_manage', label: 'Управление участниками' },
    ],
  },
]

// ─── Toggle ───────────────────────────────────────────────────

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) => (
  <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
    <span className="text-sm text-slate-700">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        checked ? 'bg-blue-500' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  </label>
)

// ─── Модал клонирования ───────────────────────────────────────

interface CloneModalProps {
  open: boolean
  role: Role
  accounts: Account[]
  currentAccountId: string
  onClose: () => void
  onClone: (targetAccountId: string) => Promise<void>
}

const CloneModal = ({ open, role, accounts, currentAccountId, onClose, onClone }: CloneModalProps) => {
  const [selectedId, setSelectedId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const targets = accounts.filter((a) => a.id !== currentAccountId)

  useEffect(() => {
    if (open) {
      setSelectedId(targets[0]?.id ?? '')
      setError(null)
      setSuccess(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId) return
    setIsSubmitting(true)
    setError(null)
    try {
      await onClone(selectedId)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Применить роль «${role.name}» к компании`}>
      {success ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Роль успешно скопирована в выбранную компанию.
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Закрыть</Button>
          </div>
        </div>
      ) : targets.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Других компаний нет. Сначала создайте ещё одну компанию.</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Закрыть</Button>
          </div>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <p className="text-sm text-slate-500">
            Будет создана роль с таким же названием и набором доступов в выбранной компании.
          </p>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-slate-500">Компания</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
            >
              {targets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>Отмена</Button>
            <Button type="submit" disabled={isSubmitting || !selectedId}>
              {isSubmitting ? 'Копирование...' : 'Применить'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ─── Основной модал ───────────────────────────────────────────

interface RoleFormModalProps {
  open: boolean
  initialValues?: Role
  accounts: Account[]
  currentAccountId: string
  onClose: () => void
  onSubmit: (values: RoleFormValues) => Promise<void>
  onClone: (role: Role, targetAccountId: string) => Promise<void>
}

export const RoleFormModal = ({
  open,
  initialValues,
  accounts,
  currentAccountId,
  onClose,
  onSubmit,
  onClone,
}: RoleFormModalProps) => {
  const isEdit = Boolean(initialValues)
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<RolePermissions>({ ...DEFAULT_PERMISSIONS })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)

  // ─── Назначение пользователя ─────────────────────────────────
  const [emailInput, setEmailInput] = useState('')
  const [userIdInput, setUserIdInput] = useState('')
  const [resolvedUser, setResolvedUser] = useState<ResolvedUser | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const lastResolved = useRef<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '')
      setPermissions(initialValues ? { ...DEFAULT_PERMISSIONS, ...initialValues.permissions } : { ...DEFAULT_PERMISSIONS })
      setError(null)
      setEmailInput('')
      setUserIdInput(initialValues?.assigned_user_id ? `U...` : '')
      setResolvedUser(null)
      setResolveError(null)
      lastResolved.current = null
      // При редактировании — сразу резолвим если есть user_id
      if (initialValues?.assigned_user_id) {
        void doResolve({ userId: initialValues.assigned_user_id })
      }
    }
  }, [open, initialValues]) // eslint-disable-line react-hooks/exhaustive-deps

  const doResolve = async (params: { email?: string; userId?: string }, otherValue?: string) => {
    const key = params.email ?? params.userId ?? ''
    if (!key) return
    setIsResolving(true)
    setResolveError(null)
    setResolvedUser(null)
    try {
      const found = await resolveAccountUser(currentAccountId, params)
      if (found) {
        // Если второе поле тоже заполнено — проверяем совпадение
        if (otherValue) {
          const mismatch = params.email
            ? found.user_id !== otherValue
            : found.email.toLowerCase() !== otherValue.toLowerCase()
          if (mismatch) {
            setResolveError('Email и ID не совпадают: в базе это разные аккаунты')
            lastResolved.current = null
            return
          }
        }
        setResolvedUser(found)
        setEmailInput(found.email)
        setUserIdInput(found.short_id ? `U${found.short_id}` : found.user_id)
        lastResolved.current = key
      } else {
        setResolveError('Пользователь не найден в этой компании')
        lastResolved.current = null
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Ошибка поиска')
    } finally {
      setIsResolving(false)
    }
  }

  const handleEmailBlur = () => {
    const val = emailInput.trim()
    if (val && val !== resolvedUser?.email) {
      void doResolve({ email: val }, userIdInput.trim() || undefined)
    }
  }

  const handleUserIdBlur = () => {
    const val = userIdInput.trim()
    if (!val || val === (resolvedUser ? `U${resolvedUser.short_id ?? ''}` : '') || val === resolvedUser?.user_id) return
    // Парсим U{n} формат
    const shortMatch = /^[Uu](\d+)$/.exec(val)
    if (shortMatch) {
      void doResolve({ shortId: parseInt(shortMatch[1]) }, emailInput.trim() || undefined)
    } else {
      void doResolve({ userId: val }, emailInput.trim() || undefined)
    }
  }

  const clearUser = () => {
    setEmailInput('')
    setUserIdInput('')
    setResolvedUser(null)
    setResolveError(null)
    lastResolved.current = null
  }

  const setPerm = (key: keyof RolePermissions, value: boolean) => {
    setPermissions((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название роли'); return }
    // Проверка: хотя бы одно поле заполнено → должен быть resolved пользователь
    const hasInput = Boolean(emailInput.trim() || userIdInput.trim())
    if (hasInput && !resolvedUser) {
      setError('Пользователь не найден или данные не совпадают. Проверьте email или ID.')
      return
    }
    if (!resolvedUser) {
      setError('Укажите email или ID пользователя')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        permissions,
        assigned_user_id: resolvedUser.user_id,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  const enabledCount = Object.values(permissions).filter(Boolean).length

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? 'Редактировать роль' : 'Новая роль'}
      >
        <form className="grid gap-5" onSubmit={(e) => void handleSubmit(e)}>
          <Input
            label="Название роли"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Менеджер склада"
            required
          />

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Доступы</span>
              {enabledCount > 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                  {enabledCount} включено
                </span>
              )}
            </div>

            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2">
                <div className="mb-1 text-xs font-semibold text-slate-400">{group.label}</div>
                {group.items.map((item) => (
                  <Toggle
                    key={item.key}
                    label={item.label}
                    checked={permissions[item.key]}
                    onChange={(v) => setPerm(item.key, v)}
                  />
                ))}
              </div>
            ))}
          </div>

          {error ? <p className="text-sm text-rose-500">{error}</p> : null}

          {/* ─── Назначение пользователя ───────────────────── */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Назначить пользователю</span>
              <span className="text-xs text-rose-400">обязательно одно из двух</span>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              {resolvedUser ? (
                /* Пользователь найден */
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-xs font-bold text-emerald-600">
                      {(resolvedUser.full_name || resolvedUser.email).slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      {resolvedUser.full_name && (
                        <p className="text-sm font-medium text-slate-900">{resolvedUser.full_name}</p>
                      )}
                      <p className="text-xs text-slate-500">{resolvedUser.email}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {resolvedUser.short_id ? `U${resolvedUser.short_id}` : resolvedUser.user_id}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearUser}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                    title="Убрать пользователя"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                /* Поля ввода */
                <div className="grid gap-2.5">
                  <div className="grid gap-1">
                    <label className="text-xs font-medium text-slate-500">Email (почта)</label>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => { setEmailInput(e.target.value); setResolveError(null) }}
                      onBlur={handleEmailBlur}
                      placeholder="user@example.com"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span>или</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs font-medium text-slate-500">ID пользователя (U1, U2, ... или UUID)</label>
                    <input
                      type="text"
                      value={userIdInput}
                      onChange={(e) => { setUserIdInput(e.target.value); setResolveError(null) }}
                      onBlur={handleUserIdBlur}
                      placeholder="U5  или  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
                    />
                  </div>
                  {isResolving && <p className="text-xs text-slate-400">Поиск...</p>}
                  {resolveError && !isResolving && (
                    <p className="text-xs text-rose-500">{resolveError}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    Укажите email <span className="font-medium">или</span> ID — второе поле заполнится автоматически. Если оба заполнены, они должны совпадать в базе.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            {isEdit ? (
              <button
                type="button"
                onClick={() => setCloneOpen(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Применить к другой компании
              </button>
            ) : <span />}

            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>Отмена</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {initialValues && (
        <CloneModal
          open={cloneOpen}
          role={initialValues}
          accounts={accounts}
          currentAccountId={currentAccountId}
          onClose={() => setCloneOpen(false)}
          onClone={(targetId) => onClone(initialValues, targetId)}
        />
      )}
    </>
  )
}
