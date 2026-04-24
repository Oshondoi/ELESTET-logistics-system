import { useState } from 'react'
import { RoleFormModal } from '../components/roles/RoleFormModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import type { Account, Role, RoleFormValues } from '../types'

// ─── Иконка щита ─────────────────────────────────────────────

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

// ─── Бейдж доступов ───────────────────────────────────────────

const permLabels: Record<string, string> = {
  shipments_view: 'Логистика (просмотр)',
  shipments_manage: 'Логистика (управление)',
  stores_view: 'Магазины (просмотр)',
  stores_manage: 'Магазины (управление)',
  directories_view: 'Справочники (просмотр)',
  directories_manage: 'Справочники (управление)',
  stickers_view: 'Стикеры (просмотр)',
  stickers_manage: 'Стикеры (управление)',
  roles_manage: 'Управление ролями',
  members_manage: 'Управление участниками',
}

// ─── Строка роли ─────────────────────────────────────────────

interface RoleRowProps {
  role: Role
  onEdit: (role: Role) => void
  onDelete: (role: Role) => void
  canManage?: boolean
}

const RoleRow = ({ role, onEdit, onDelete, canManage = true }: RoleRowProps) => {
  const enabledPerms = Object.entries(role.permissions)
    .filter(([, v]) => v)
    .map(([k]) => permLabels[k] ?? k)

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
          <ShieldIcon />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{role.name}</p>
          {/* Назначенный пользователь */}
          {(role.assigned_user_name || role.assigned_user_short_id) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <svg viewBox="0 0 24 24" className="h-3 w-3 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
              {role.assigned_user_name && <span className="font-medium">{role.assigned_user_name}</span>}
              {role.assigned_user_short_id && (
                <span className="rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-400">
                  U{role.assigned_user_short_id}
                </span>
              )}
            </p>
          )}
          {enabledPerms.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {enabledPerms.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">Нет доступов</p>
          )}
        </div>
      </div>

      <div className="flex h-7 flex-shrink-0 items-center gap-1">
        {canManage && (
        <>
        {/* Редактировать */}
        <button
          type="button"
          onClick={() => onEdit(role)}
          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
          title="Редактировать"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        {/* Удалить */}
        <button
          type="button"
          onClick={() => onDelete(role)}
          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
          title="Удалить"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
        </>
        )}
      </div>
    </div>
  )
}

// ─── Страница ─────────────────────────────────────────────────

interface RolesPageProps {
  roles: Role[]
  accounts: Account[]
  activeAccountId: string
  isLoading: boolean
  onAdd: (values: RoleFormValues) => Promise<Role>
  onUpdate: (roleId: string, values: Partial<RoleFormValues>) => Promise<Role>
  onDelete: (roleId: string) => Promise<void>
  onClone: (role: Role, targetAccountId: string) => Promise<void>
  canManage?: boolean
}

export const RolesPage = ({
  roles,
  accounts,
  activeAccountId,
  isLoading,
  onAdd,
  onUpdate,
  onDelete,
  onClone,
  canManage = true,
}: RolesPageProps) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleOpenCreate = () => {
    setEditingRole(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (role: Role) => {
    setEditingRole(role)
    setModalOpen(true)
  }

  const handleSubmit = async (values: RoleFormValues) => {
    if (editingRole) {
      await onUpdate(editingRole.id, values)
    } else {
      await onAdd(values)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        {/* Топ-бар */}
        <Card className="rounded-3xl p-2.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex h-10 min-w-[260px] items-center rounded-2xl bg-slate-100 px-4 text-sm text-slate-400">
              {roles.length === 0 && !isLoading
                ? 'Ролей ещё нет'
                : `${roles.length} ${roles.length === 1 ? 'роль' : roles.length < 5 ? 'роли' : 'ролей'}`}
            </div>
            <div className="flex items-center gap-2.5">
              {canManage && (
              <Button className="rounded-2xl px-5 py-2.5" onClick={handleOpenCreate}>
                + Создать роль
              </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Список */}
        <Card className="overflow-hidden rounded-3xl">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">Загрузка...</div>
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                <ShieldIcon />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Нет ролей</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Создайте роль и настройте доступы для участников компании
                </p>
              </div>
              {canManage && (
              <Button className="mt-1 rounded-2xl px-5 py-2.5" onClick={handleOpenCreate}>
                + Создать роль
              </Button>
              )}
            </div>
          ) : (
            roles.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                onEdit={handleOpenEdit}
                onDelete={setDeleteTarget}                canManage={canManage}              />
            ))
          )}
        </Card>
      </div>

      <RoleFormModal
        open={modalOpen}
        initialValues={editingRole ?? undefined}
        accounts={accounts}
        currentAccountId={activeAccountId}
        onClose={() => { setModalOpen(false); setEditingRole(null) }}
        onSubmit={handleSubmit}
        onClone={onClone}
      />

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить роль"
        description={`Роль «${deleteTarget?.name ?? ''}» будет удалена без возможности восстановления.`}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={() => { if (!isDeleting) { setDeleteTarget(null); setDeleteError(null) } }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  )
}
