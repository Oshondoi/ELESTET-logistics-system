import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { RoleFormModal } from '../components/roles/RoleFormModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import type { Account, Role, RoleFormValues, IncomingInvite, OutgoingInvite, OutsourceBatch, OutsourcePartner } from '../types'
import {
  fetchIncomingInvites,
  fetchOutgoingInvites,
  fetchOutsourceBatches,
  respondToInvite,
  fetchMyPartners,
  respondToPartnerRequest,
  removePartner,
} from '../services/outsourceService'

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
  shipments_delete_any: 'Удаление поставок (любой статус)',
  shipments_delete_trip: 'Удаление рейсов',
  shipments_manage_payments: 'Управление оплатой',
  stores_view: 'Магазины (просмотр)',
  stores_manage: 'Магазины (управление)',
  stores_delete: 'Удаление магазинов',
  stores_sync: 'Синхронизация с WB',
  directories_view: 'Справочники (просмотр)',
  directories_manage: 'Справочники (управление)',
  directories_delete: 'Удаление справочников',
  directories_tariff_manage: 'Редактирование тарифов работ',
  stickers_view: 'Стикеры (просмотр)',
  stickers_manage: 'Стикеры (управление)',
  stickers_delete: 'Удаление стикеров',
  stickers_import: 'Импорт из WB',
  reviews_view: 'Отзывы (просмотр)',
  reviews_manage: 'Отзывы (ответы)',
  reviews_ai: 'ИИ-ответы',
  reviews_automation: 'Автоматизация отзывов',
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

type MainTab = 'employees' | 'outsource'
type OutsourceTab = 'partners' | 'services'

const INVITE_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  accepted: 'Принято',
  declined: 'Отклонено',
}

const INVITE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-slate-100 text-slate-500',
}

interface RolesPageProps {
  roles: Role[]
  accounts: Account[]
  activeAccountId: string
  activeAccountShortId?: number | null
  isLoading: boolean
  onAdd: (values: RoleFormValues) => Promise<Role>
  onUpdate: (roleId: string, values: Partial<RoleFormValues>) => Promise<Role>
  onDelete: (roleId: string) => Promise<void>
  onClone: (role: Role, targetAccountId: string) => Promise<void>
  canManage?: boolean
  onAddOutsource?: () => void
}

export const RolesPage = ({
  roles,
  accounts,
  activeAccountId,
  activeAccountShortId,
  isLoading,
  onAdd,
  onUpdate,
  onDelete,
  onClone,
  canManage = true,
  onAddOutsource,
}: RolesPageProps) => {
  const [mainTab, setMainTabRaw] = useState<MainTab>(
    () => (localStorage.getItem('roles_main_tab') as MainTab) ?? 'employees'
  )
  const [outsourceTab, setOutsourceTabRaw] = useState<OutsourceTab>(
    () => (localStorage.getItem('roles_outsource_tab') as OutsourceTab) ?? 'partners'
  )
  const setMainTab = (tab: MainTab) => {
    setMainTabRaw(tab)
    localStorage.setItem('roles_main_tab', tab)
  }
  const setOutsourceTab = (tab: OutsourceTab) => {
    setOutsourceTabRaw(tab)
    localStorage.setItem('roles_outsource_tab', tab)
  }
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Аутсорс данные
  const [partners, setPartners] = useState<OutsourcePartner[]>([])
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([])
  const [outgoingInvites, setOutgoingInvites] = useState<OutgoingInvite[]>([])
  const [outsourceBatches, setOutsourceBatches] = useState<OutsourceBatch[]>([])
  const [isLoadingOutsource, setIsLoadingOutsource] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')
  const [outsourceSearch, setOutsourceSearch] = useState('')

  // Подтверждение удаления партнёра (для is_requester, без пароля)
  const [removeConfirmTarget, setRemoveConfirmTarget] = useState<string | null>(null)

  // Подтверждение отключения от партнёра (для !is_requester)
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null)
  const [disconnectPassword, setDisconnectPassword] = useState('')
  const [disconnectPasswordVisible, setDisconnectPasswordVisible] = useState(false)
  const [disconnectPasswordReady, setDisconnectPasswordReady] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const [disconnectLoading, setDisconnectLoading] = useState(false)

  const loadOutsourceData = useCallback(async () => {
    setIsLoadingOutsource(true)
    try {
      const [partners, inc, out, batches] = await Promise.all([
        fetchMyPartners(activeAccountId),
        fetchIncomingInvites(),
        fetchOutgoingInvites(),
        fetchOutsourceBatches(),
      ])
      setPartners(partners)
      setIncomingInvites(inc)
      setOutgoingInvites(out)
      setOutsourceBatches(batches)
    } catch {
      // ignore
    } finally {
      setIsLoadingOutsource(false)
    }
  }, [activeAccountId])

  useEffect(() => {
    if (mainTab === 'outsource') void loadOutsourceData()
  }, [mainTab, loadOutsourceData])

  const handleRespondInvite = async (inviteId: string, accept: boolean) => {
    setRespondingId(inviteId)
    try {
      const result = await respondToInvite(inviteId, accept)
      if (result.error) { alert(result.error); return }
      await loadOutsourceData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setRespondingId(null)
    }
  }

  const handleRespondPartner = async (connectionId: string, accept: boolean) => {
    setRespondingId(connectionId)
    try {
      const result = await respondToPartnerRequest(connectionId, accept)
      if (result.error) { alert(result.error); return }
      await loadOutsourceData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setRespondingId(null)
    }
  }

  const handleRemovePartner = async (connectionId: string) => {
    setRespondingId(connectionId)
    try {
      await removePartner(connectionId)
      await loadOutsourceData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setRespondingId(null)
    }
  }

  const handleDisconnectConfirm = async () => {
    if (!disconnectTarget || !disconnectPassword.trim() || !supabase) return
    setDisconnectLoading(true)
    setDisconnectError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('Не удалось получить пользователя')
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: disconnectPassword,
      })
      if (error) {
        setDisconnectError('Неверный пароль')
        return
      }
      await removePartner(disconnectTarget)
      await loadOutsourceData()
      setDisconnectTarget(null)
      setDisconnectPassword('')
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setDisconnectLoading(false)
    }
  }

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

  const filteredRoles = roleSearch.trim()
    ? roles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
    : roles
  const _q = outsourceSearch.toLowerCase().trim()
  const filteredPartners = _q
    ? partners.filter((p) =>
        p.partner_name.toLowerCase().includes(_q) ||
        String(p.partner_short_id).includes(_q)
      )
    : partners
  const filteredIncoming = _q
    ? incomingInvites.filter((i) =>
        (i.inviting_company_name ?? '').toLowerCase().includes(_q) ||
        (i.stage_name ?? '').toLowerCase().includes(_q) ||
        String(i.batch_short_id ?? '').includes(_q) ||
        (i.batch_name ?? '').toLowerCase().includes(_q)
      )
    : incomingInvites
  const filteredOutgoing = _q
    ? outgoingInvites.filter((i) =>
        (i.invited_company_name ?? '').toLowerCase().includes(_q) ||
        (i.stage_name ?? '').toLowerCase().includes(_q) ||
        String(i.batch_short_id ?? '').includes(_q) ||
        (i.batch_name ?? '').toLowerCase().includes(_q)
      )
    : outgoingInvites
  const filteredBatches = _q
    ? outsourceBatches.filter((b) =>
        (b.owner_company_name ?? '').toLowerCase().includes(_q) ||
        (b.stage_name ?? '').toLowerCase().includes(_q) ||
        String(b.batch_short_id ?? '').includes(_q) ||
        (b.batch_name ?? '').toLowerCase().includes(_q)
      )
    : outsourceBatches

  const pendingIncomingCount = incomingInvites.filter((i) => i.status === 'pending').length
  const pendingPartnerCount = partners.filter((p) => p.status === 'pending' && !p.is_requester).length
  const totalPendingCount = pendingIncomingCount + pendingPartnerCount

  return (
    <>
      <div className="space-y-4">
        {/* Главные табы */}
        <Card className="overflow-hidden rounded-3xl p-0">
          <div className="flex border-b border-slate-100">
            <button
              type="button"
              onClick={() => setMainTab('employees')}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition-colors ${
                mainTab === 'employees'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Сотрудники
            </button>
            <button
              type="button"
              onClick={() => setMainTab('outsource')}
              className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition-colors ${
                mainTab === 'outsource'
                  ? 'border-b-2 border-violet-500 text-violet-600'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="7" width="20" height="14" rx="2"/>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                <line x1="12" y1="12" x2="12" y2="16"/>
                <line x1="10" y1="14" x2="14" y2="14"/>
              </svg>
              Аутсорс
              {pendingIncomingCount > 0 && (
                <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
                  {totalPendingCount}
                </span>
              )}
            </button>
          </div>
        </Card>

        {/* ── ТАБ: СОТРУДНИКИ ───────────────────────────────── */}
        {mainTab === 'employees' && (
          <>
            <Card className="rounded-3xl p-2.5">
              <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                <input
                  type="text"
                  value={roleSearch}
                  onChange={(e) => setRoleSearch(e.target.value)}
                  placeholder={
                    isLoading
                      ? 'Загрузка...'
                      : roles.length === 0
                      ? 'Ролей ещё нет'
                      : `Поиск среди ${roles.length} ${roles.length === 1 ? 'роли' : roles.length < 5 ? 'ролей' : 'ролей'}...`
                  }
                  autoComplete="off"
                  className="h-10 min-w-[260px] rounded-2xl bg-slate-100 px-4 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none focus:bg-slate-50 focus:ring-2 focus:ring-blue-100"
                />
                <div className="flex items-center gap-2.5">
                  {canManage && (
                    <Button className="rounded-2xl px-5 py-2.5" onClick={handleOpenCreate}>
                      + Создать роль
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden rounded-3xl">
              {isLoading ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">Загрузка...</div>
              ) : filteredRoles.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                    <ShieldIcon />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {roleSearch ? `Нет ролей по запросу «${roleSearch}»` : 'Нет ролей'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {roleSearch ? 'Попробуйте изменить запрос' : 'Создайте роль и настройте доступы для участников компании'}
                    </p>
                  </div>
                  {canManage && !roleSearch && (
                    <Button className="mt-1 rounded-2xl px-5 py-2.5" onClick={handleOpenCreate}>
                      + Создать роль
                    </Button>
                  )}
                </div>
              ) : (
                filteredRoles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    onEdit={handleOpenEdit}
                    onDelete={setDeleteTarget}
                    canManage={canManage}
                  />
                ))
              )}
            </Card>
          </>
        )}

        {/* ── ТАБ: АУТСОРС ────────────────────────────────── */}
        {mainTab === 'outsource' && (
          <div className="space-y-4">
            {/* Тулбар: поиск + добавить */}
            <Card className="rounded-3xl p-2.5">
              <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                <input
                  type="text"
                  value={outsourceSearch}
                  onChange={(e) => setOutsourceSearch(e.target.value)}
                  placeholder="Поиск по компании, этапу, партии..."
                  autoComplete="off"
                  className="h-10 min-w-[260px] rounded-2xl bg-slate-100 px-4 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none focus:bg-slate-50 focus:ring-2 focus:ring-violet-100"
                />
                <div className="flex items-center gap-2.5">
                  {activeAccountShortId != null && (
                    <span className="flex h-10 items-center rounded-2xl bg-violet-50 px-3 font-mono text-xs font-semibold text-violet-600">
                      C-{activeAccountShortId}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onAddOutsource?.()}
                    className="flex h-10 items-center gap-1.5 rounded-2xl bg-violet-500 px-5 text-sm font-medium text-white hover:bg-violet-600"
                  >
                    + Добавить аутсорс
                  </button>
                </div>
              </div>
            </Card>

            {/* Суб-табы */}
            <Card className="overflow-hidden rounded-3xl p-0">
              <div className="flex border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setOutsourceTab('partners')}
                  className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition-colors ${
                    outsourceTab === 'partners'
                      ? 'border-b-2 border-violet-500 text-violet-600'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Партнёры
                </button>
                <button
                  type="button"
                  onClick={() => setOutsourceTab('services')}
                  className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition-colors ${
                    outsourceTab === 'services'
                      ? 'border-b-2 border-violet-500 text-violet-600'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2" y="7" width="20" height="14" rx="2"/>
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                    <line x1="12" y1="12" x2="12" y2="16"/>
                    <line x1="10" y1="14" x2="14" y2="14"/>
                  </svg>
                  Мои услуги
                  {(pendingIncomingCount + pendingPartnerCount) > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                      {pendingIncomingCount + pendingPartnerCount}
                    </span>
                  )}
                </button>
              </div>

              {isLoadingOutsource ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">Загрузка...</div>
              ) : (
                <>
                  {/* ── ПАРТНЁРЫ ─────────────────────────────── */}
                  {outsourceTab === 'partners' && (
                    <div>
                      {/* Принятые партнёры (ты пригласил) */}
                      {filteredPartners.filter((p) => p.status === 'accepted' && p.is_requester).length > 0 && (
                        <div>
                          <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Подключены
                          </p>
                          {filteredPartners
                            .filter((p) => p.status === 'accepted' && p.is_requester)
                            .map((p) => (
                              <div key={p.connection_id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 font-mono text-xs font-bold text-emerald-600">
                                    C-{p.partner_short_id}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{p.partner_name}</p>
                                    <p className="text-xs text-slate-400">Аутсорс-партнёр</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setRemoveConfirmTarget(p.connection_id)}
                                  disabled={respondingId === p.connection_id}
                                  className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 transition-colors"
                                >
                                  Удалить
                                </button>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Отправленные запросы (ожидают ответа) */}
                      {filteredPartners.filter((p) => p.status === 'pending' && p.is_requester).length > 0 && (
                        <div>
                          <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Отправленные запросы
                          </p>
                          {filteredPartners
                            .filter((p) => p.status === 'pending' && p.is_requester)
                            .map((p) => (
                              <div key={p.connection_id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0 opacity-80">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 font-mono text-xs font-bold text-amber-600">
                                    C-{p.partner_short_id}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{p.partner_name}</p>
                                    <p className="text-xs text-slate-400">Ожидает ответа</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setRemoveConfirmTarget(p.connection_id)}
                                  disabled={respondingId === p.connection_id}
                                  className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 transition-colors"
                                >
                                  Отменить
                                </button>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Отклонённые (только исходящие) */}
                      {filteredPartners.filter((p) => p.status === 'declined' && p.is_requester).length > 0 && (
                        <div>
                          <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Отклонены
                          </p>
                          {filteredPartners
                            .filter((p) => p.status === 'declined' && p.is_requester)
                            .map((p) => (
                              <div key={p.connection_id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0 opacity-50">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-mono text-xs font-bold text-slate-400">
                                    C-{p.partner_short_id}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-600 truncate">{p.partner_name}</p>
                                    <p className="text-xs text-slate-400">
                                      {p.is_requester ? 'Запрос отклонён' : 'Вы отклонили запрос'}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setRemoveConfirmTarget(p.connection_id)}
                                  disabled={respondingId === p.connection_id}
                                  className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                                >
                                  Убрать
                                </button>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Пустое состояние */}
                      {filteredPartners.filter((p) => p.is_requester).length === 0 && (
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-300">
                            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                              <circle cx="9" cy="7" r="4"/>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-700">
                              {outsourceSearch ? `Нет партнёров по запросу «${outsourceSearch}»` : 'Нет аутсорс-партнёров'}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {outsourceSearch
                                ? 'Попробуйте изменить запрос'
                                : 'Нажмите «+ Добавить партнёра» чтобы подключить аутсорс-компанию по C-ID'}
                            </p>
                          </div>
                          {!outsourceSearch && (
                            <button
                              type="button"
                              onClick={() => onAddOutsource?.()}
                              className="mt-1 flex items-center gap-1.5 rounded-2xl bg-violet-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-600"
                            >
                              + Добавить партнёра
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── МОИ УСЛУГИ ──────────────────────────── */}
                  {outsourceTab === 'services' && (
                    <div>
                      {filteredIncoming.length === 0 && filteredBatches.length === 0 && filteredPartners.filter((p) => !p.is_requester).length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                          </div>
                          <p className="text-sm text-slate-500">
                            {outsourceSearch ? `Нет результатов по запросу «${outsourceSearch}»` : 'Нет входящих приглашений'}
                          </p>
                          {!outsourceSearch && (
                            <p className="text-xs text-slate-400">
                              Когда другие компании пригласят вас на этап партии — они появятся здесь
                            </p>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* Входящие запросы на партнёрство */}
                          {filteredPartners.filter((p) => p.status === 'pending' && !p.is_requester).length > 0 && (
                            <div>
                              <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Запросы на партнёрство
                              </p>
                              {filteredPartners
                                .filter((p) => p.status === 'pending' && !p.is_requester)
                                .map((p) => (
                                  <div key={p.connection_id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 font-mono text-xs font-bold text-violet-600">
                                        C-{p.partner_short_id}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 truncate">{p.partner_name}</p>
                                        <p className="text-xs text-slate-400">Хочет добавить вас как партнёра</p>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleRespondPartner(p.connection_id, true)}
                                        disabled={respondingId === p.connection_id}
                                        className="rounded-xl bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                                      >
                                        Принять
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleRespondPartner(p.connection_id, false)}
                                        disabled={respondingId === p.connection_id}
                                        className="rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                                      >
                                        Отклонить
                                      </button>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}

                          {/* Подключены как исполнитель */}
                          {filteredPartners.filter((p) => p.status === 'accepted' && !p.is_requester).length > 0 && (
                            <div>
                              <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Подключены как партнёр
                              </p>
                              {filteredPartners
                                .filter((p) => p.status === 'accepted' && !p.is_requester)
                                .map((p) => (
                                  <div key={p.connection_id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 font-mono text-xs font-bold text-emerald-600">
                                        C-{p.partner_short_id}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 truncate">{p.partner_name}</p>
                                        <p className="text-xs text-slate-400">Вы — аутсорс-исполнитель</p>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => { setDisconnectTarget(p.connection_id); setDisconnectPassword(''); setDisconnectError(null); setDisconnectPasswordReady(false) }}
                                      className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                                    >
                                      Отключиться
                                    </button>
                                  </div>
                                ))}
                            </div>
                          )}

                          {/* Ожидающие приглашения на этап */}
                          {filteredIncoming.filter((i) => i.status === 'pending').length > 0 && (
                            <div>
                              <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Ожидают ответа
                              </p>
                              {filteredIncoming
                                .filter((i) => i.status === 'pending')
                                .map((invite) => (
                                  <div key={invite.invite_id} className="flex items-start justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-semibold text-violet-600">
                                          C-{invite.inviting_company_short_id}
                                        </span>
                                        <span className="text-sm font-medium text-slate-800">{invite.inviting_company_name}</span>
                                      </div>
                                      <p className="mt-0.5 text-xs text-slate-500">
                                        Партия <span className="font-mono font-semibold">P-{invite.batch_short_id}</span>{' '}
                                        {invite.batch_name} · Этап: <strong>{invite.stage_name}</strong>
                                      </p>
                                      <p className="mt-0.5 text-[10px] text-slate-400">
                                        {new Date(invite.created_at).toLocaleString('ru-RU')}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleRespondInvite(invite.invite_id, true)}
                                        disabled={respondingId === invite.invite_id}
                                        className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                      >
                                        Принять
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleRespondInvite(invite.invite_id, false)}
                                        disabled={respondingId === invite.invite_id}
                                        className="rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                                      >
                                        Отклонить
                                      </button>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}

                          {/* Принятые партии */}
                          {filteredBatches.length > 0 && (
                            <div>
                              <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                Активные партии
                              </p>
                              {filteredBatches.map((b) => (
                                <div key={b.stage_id} className="flex items-start justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs font-semibold text-violet-600">
                                        C-{b.owner_company_short_id}
                                      </span>
                                      <span className="text-sm font-medium text-slate-800">{b.owner_company_name}</span>
                                    </div>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                      Партия <span className="font-mono font-semibold">P-{b.batch_short_id}</span>{' '}
                                      {b.batch_name} · Этап: <strong>{b.stage_name}</strong>
                                    </p>
                                  </div>
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                    b.stage_status === 'done' ? 'bg-emerald-50 text-emerald-700' :
                                    b.stage_status === 'in_progress' ? 'bg-amber-50 text-amber-700' :
                                    'bg-blue-50 text-blue-600'
                                  }`}>
                                    {b.stage_status === 'done' ? 'Выполнено' :
                                     b.stage_status === 'in_progress' ? 'В работе' : 'Принято'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* История приглашений */}
                          {filteredIncoming.filter((i) => i.status !== 'pending').length > 0 && (
                            <div>
                              <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                История
                              </p>
                              {filteredIncoming
                                .filter((i) => i.status !== 'pending')
                                .map((invite) => (
                                  <div key={invite.invite_id} className="flex items-start justify-between gap-4 border-b border-slate-50 px-4 py-3.5 last:border-0 opacity-60">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-violet-500">C-{invite.inviting_company_short_id}</span>
                                        <span className="text-sm text-slate-600">{invite.inviting_company_name}</span>
                                      </div>
                                      <p className="mt-0.5 text-xs text-slate-400">
                                        P-{invite.batch_short_id} · {invite.stage_name}
                                      </p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${INVITE_STATUS_COLORS[invite.status] ?? ''}`}>
                                      {INVITE_STATUS_LABELS[invite.status] ?? invite.status}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
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

      {/* Подтверждение удаления партнёра (is_requester, без пароля) */}
      {removeConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-slate-800">Подтвердите действие</h2>
            <p className="mt-1 text-sm text-slate-500">Партнёр будет удалён из вашего списка. Вы уверены?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveConfirmTarget(null)}
                className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => { void handleRemovePartner(removeConfirmTarget); setRemoveConfirmTarget(null) }}
                className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения отключения паролем */}
      {disconnectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-slate-800">Подтвердите отключение</h2>
            <p className="mt-1 text-sm text-slate-500">
              Введите ваш пароль чтобы отключиться от партнёра
            </p>
            <div className="relative mt-4">
              <input
                type={disconnectPasswordVisible ? 'text' : 'password'}
                readOnly={!disconnectPasswordReady}
                onFocus={() => setDisconnectPasswordReady(true)}
                value={disconnectPassword}
                onChange={(e) => { setDisconnectPassword(e.target.value); setDisconnectError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleDisconnectConfirm() }}
                placeholder="Ваш пароль"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-4 pr-10 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <button
                type="button"
                onClick={() => setDisconnectPasswordVisible((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {disconnectPasswordVisible ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            {disconnectError && (
              <p className="mt-2 text-xs text-rose-500">{disconnectError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDisconnectTarget(null); setDisconnectPassword(''); setDisconnectError(null) }}
                disabled={disconnectLoading}
                className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectConfirm()}
                disabled={disconnectLoading || !disconnectPassword.trim()}
                className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {disconnectLoading ? 'Проверка...' : 'Отключиться'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
