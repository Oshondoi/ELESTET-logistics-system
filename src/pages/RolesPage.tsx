import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getLogoUrl } from '../lib/companyLogo'
import { RoleFormModal } from '../components/roles/RoleFormModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import {
  fetchMyPartners,
  sendPartnerRequest,
  respondToPartnerRequest,
  removePartner,
} from '../services/outsourceService'
import { fetchPartnerBatches } from '../services/pipelineService'
import type { Account, Role, RoleFormValues, OutsourcePartner, PartnerBatchInfo } from '../types'

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
}: RolesPageProps) => {
  // Главные вкладки (с запоминанием в localStorage)
  const [mainTab, setMainTab] = useState<'employees' | 'outsource'>(
    () => (localStorage.getItem('rolesMainTab') as 'employees' | 'outsource' | null) ?? 'employees'
  )
  const [outsourceTab, setOutsourceTab] = useState<'partners' | 'services' | 'invites'>(
    () => (localStorage.getItem('rolesOutsourceTab') as 'partners' | 'services' | 'invites' | null) ?? 'partners'
  )
  const [invitesSubTab, setInvitesSubTab] = useState<'incoming' | 'outgoing'>(
    () => (localStorage.getItem('rolesInvitesSubTab') as 'incoming' | 'outgoing' | null) ?? 'incoming'
  )

  const handleSetMainTab = (tab: 'employees' | 'outsource') => {
    setMainTab(tab)
    localStorage.setItem('rolesMainTab', tab)
  }
  const handleSetOutsourceTab = (tab: 'partners' | 'services' | 'invites') => {
    setOutsourceTab(tab)
    localStorage.setItem('rolesOutsourceTab', tab)
  }
  const handleSetInvitesSubTab = (tab: 'incoming' | 'outgoing') => {
    setInvitesSubTab(tab)
    localStorage.setItem('rolesInvitesSubTab', tab)
  }

  // Стейт роли / удаления
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')

  // Аутсорс: партнёры
  const [partners, setPartners] = useState<OutsourcePartner[]>([])
  const [partnersLoading, setPartnersLoading] = useState(false)
  const [partnersError, setPartnersError] = useState<string | null>(null)

  // Аутсорс: мои услуги
  const [myServices, setMyServices] = useState<PartnerBatchInfo[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)

  // Аутсорс: отправить приглашение
  const [inviteInput, setInviteInput] = useState('')
  const [isSendingInvite, setIsSendingInvite] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Аутсорс: ответ на приглашение (по id → состояние)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const loadPartners = useCallback(async () => {
    if (!activeAccountId) return
    setPartnersLoading(true)
    setPartnersError(null)
    try {
      const data = await fetchMyPartners(activeAccountId)
      setPartners(data)
    } catch (e) {
      setPartnersError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setPartnersLoading(false)
    }
  }, [activeAccountId])

  const loadServices = useCallback(async () => {
    if (!activeAccountId) return
    setServicesLoading(true)
    try {
      const data = await fetchPartnerBatches(activeAccountId)
      setMyServices(data)
    } catch {
      // ignore
    } finally {
      setServicesLoading(false)
    }
  }, [activeAccountId])

  useEffect(() => {
    if (mainTab === 'outsource') {
      if (outsourceTab === 'partners' || outsourceTab === 'invites') void loadPartners()
      if (outsourceTab === 'services') void loadServices()
    }
  }, [mainTab, outsourceTab, loadPartners, loadServices])

  const handleSendInvite = async () => {
    // Принимаем любой формат: С-45, C45, с 45, С - 14, c-14 и т.д. — берём только цифры
    const digits = inviteInput.replace(/\D/g, '')
    const shortId = parseInt(digits, 10)
    if (!digits || isNaN(shortId) || shortId <= 0) {
      setInviteMsg({ text: 'Введите корректный ID компании (например C1234)', ok: false })
      return
    }
    setIsSendingInvite(true)
    setInviteMsg(null)
    try {
      const result = await sendPartnerRequest(activeAccountId, shortId)
      if (result?.error) {
        setInviteMsg({ text: result.error, ok: false })
      } else {
        setInviteMsg({ text: 'Приглашение отправлено', ok: true })
        setInviteInput('')
        await loadPartners()
      }
    } catch (e) {
      setInviteMsg({ text: e instanceof Error ? e.message : 'Ошибка', ok: false })
    } finally {
      setIsSendingInvite(false)
    }
  }

  const handleRespond = async (connectionId: string, accept: boolean) => {
    setRespondingId(connectionId)
    try {
      const result = await respondToPartnerRequest(connectionId, accept)
      if (result?.error) {
        alert(result.error)
      } else {
        await loadPartners()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setRespondingId(null)
    }
  }

  const handleRemovePartner = async (connectionId: string) => {
    if (!confirm('Удалить партнёра? Это действие нельзя отменить.')) return
    setRemovingId(connectionId)
    try {
      await removePartner(connectionId)
      await loadPartners()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setRemovingId(null)
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

  return (
    <>
      {/* Главная навигация */}
      <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {([
          { key: 'employees', label: 'Сотрудники' },
          { key: 'outsource', label: 'Аутсорс' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleSetMainTab(tab.key)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
              mainTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Вкладка: Сотрудники ── */}
      {mainTab === 'employees' && (
        <div className="space-y-4">
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
                  <Button className="h-10 rounded-2xl px-5" onClick={handleOpenCreate}>
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
                  <Button className="mt-1 h-10 rounded-2xl px-5" onClick={handleOpenCreate}>
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
        </div>
      )}

      {/* ── Вкладка: Аутсорс ── */}
      {mainTab === 'outsource' && (
        <div className="space-y-4">
          {/* Подвкладки */}
          <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
            {([
              { key: 'partners', label: 'Аутсорс' },
              { key: 'services', label: 'Мои услуги' },
              { key: 'invites', label: 'Приглашения' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSetOutsourceTab(tab.key)}
                className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                  outsourceTab === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Подвкладка: Аутсорс (партнёры + форма приглашения) ── */}
          {outsourceTab === 'partners' && (
            <div className="space-y-4">
              {/* Мой ID */}
              {activeAccountShortId != null && (() => {
                const myAccount = accounts.find(a => a.id === activeAccountId)
                const myLogo = myAccount ? getLogoUrl(myAccount) : null
                const myInitial = (myAccount?.name?.charAt(0) ?? '?').toUpperCase()
                return (
                  <Card className="rounded-3xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-violet-100">
                        {myLogo ? (
                          <img src={myLogo} alt="logo" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-violet-600">{myInitial}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Ваш ID компании (для приглашений)</p>
                        <p className="font-mono text-lg font-bold text-slate-800">C{activeAccountShortId}</p>
                      </div>
                    </div>
                  </Card>
                )
              })()}

              {/* Форма: отправить приглашение */}
              <Card className="rounded-3xl p-4">
                <p className="mb-3 text-sm font-semibold text-slate-700">Пригласить компанию</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteInput}
                    onChange={(e) => { setInviteInput(e.target.value); setInviteMsg(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSendInvite() }}
                    placeholder="ID компании (например C1234)"
                    className="h-10 flex-1 rounded-2xl bg-slate-100 px-4 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    disabled={isSendingInvite}
                  />
                  <Button
                    className="h-10 rounded-2xl px-5"
                    onClick={() => void handleSendInvite()}
                    disabled={isSendingInvite || !inviteInput.trim()}
                  >
                    {isSendingInvite ? 'Отправка...' : 'Пригласить'}
                  </Button>
                </div>
                {inviteMsg && (
                  <p className={`mt-2 text-xs ${inviteMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {inviteMsg.text}
                  </p>
                )}
              </Card>

              {/* Принятые партнёры */}
              {partnersLoading ? (
                <div className="py-6 text-center text-sm text-slate-400">Загрузка...</div>
              ) : partnersError ? (
                <div className="py-4 text-center text-sm text-rose-500">{partnersError}</div>
              ) : partners.filter((p) => p.status === 'accepted').length > 0 ? (
                <Card className="overflow-hidden rounded-3xl">
                  {partners
                    .filter((p) => p.status === 'accepted')
                    .map((p) => (
                      <div
                        key={p.connection_id}
                        className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Аватар-логотип */}
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-600 uppercase">
                            {p.partner_name?.charAt(0) ?? '?'}
                          </div>
                          <span className="font-mono text-xs text-slate-400 flex-shrink-0">C{p.partner_short_id}</span>
                          <span className="text-sm font-semibold text-slate-900 truncate">{p.partner_name}</span>
                        </div>
                        <button
                          type="button"
                          disabled={removingId === p.connection_id}
                          onClick={() => void handleRemovePartner(p.connection_id)}
                          className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        >
                          {removingId === p.connection_id ? 'Удаление...' : 'Удалить'}
                        </button>
                      </div>
                    ))}
                </Card>
              ) : (
                <Card className="rounded-3xl">
                  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Партнёров пока нет</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Пригласите компанию-партнёра по её ID
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── Подвкладка: Мои услуги ── */}
          {outsourceTab === 'services' && (
            <div>
              {servicesLoading ? (
                <div className="py-6 text-center text-sm text-slate-400">Загрузка...</div>
              ) : myServices.length === 0 ? (
                <Card className="rounded-3xl">
                  <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Нет активных услуг</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Здесь будут отображаться партии, в которых вы выполняете этап
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="overflow-hidden rounded-3xl">
                  {myServices.map((svc) => (
                    <div
                      key={svc.my_stage_id}
                      className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {svc.batch_name}
                          </p>
                          <span className="font-mono text-[10px] text-slate-400">
                            #{svc.batch_short_id}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {svc.owner_name}
                          {svc.owner_short_id != null && (
                            <span className="ml-1 font-mono text-slate-400">C{svc.owner_short_id}</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Этап: <span className="font-medium">{svc.my_stage_name}</span>
                        </p>
                      </div>
                      <span
                        className={`mt-0.5 flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          svc.my_stage_status === 'done'
                            ? 'bg-emerald-50 text-emerald-600'
                            : svc.my_stage_status === 'active'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {svc.my_stage_status === 'done'
                          ? 'Выполнено'
                          : svc.my_stage_status === 'active'
                          ? 'В работе'
                          : 'Ожидает'}
                      </span>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          )}

          {/* ── Подвкладка: Приглашения ── */}
          {outsourceTab === 'invites' && (
            <div className="space-y-4">
              {/* Суб-табы */}
              <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
                {([
                  { key: 'incoming', label: 'Приглашён' },
                  { key: 'outgoing', label: 'Пригласили' },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleSetInvitesSubTab(tab.key)}
                    className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                      invitesSubTab === tab.key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {partnersLoading ? (
                <div className="py-6 text-center text-sm text-slate-400">Загрузка...</div>
              ) : partnersError ? (
                <div className="py-4 text-center text-sm text-rose-500">{partnersError}</div>
              ) : invitesSubTab === 'incoming' ? (
                /* Входящие (Приглашён) */
                partners.filter((p) => !p.is_requester && p.status === 'pending').length > 0 ? (
                  <Card className="overflow-hidden rounded-3xl">
                    {partners
                      .filter((p) => !p.is_requester && p.status === 'pending')
                      .map((p) => (
                        <div
                          key={p.connection_id}
                          className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-600 uppercase">
                              {p.partner_name?.charAt(0) ?? '?'}
                            </div>
                            <span className="font-mono text-xs text-slate-400 flex-shrink-0">C{p.partner_short_id}</span>
                            <span className="text-sm font-semibold text-slate-900 truncate">{p.partner_name}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={respondingId === p.connection_id}
                              onClick={() => void handleRespond(p.connection_id, true)}
                              className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-50"
                            >
                              Принять
                            </button>
                            <button
                              type="button"
                              disabled={respondingId === p.connection_id}
                              onClick={() => void handleRespond(p.connection_id, false)}
                              className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                            >
                              Отклонить
                            </button>
                          </div>
                        </div>
                      ))}
                  </Card>
                ) : (
                  <Card className="rounded-3xl px-4 py-4 text-sm text-slate-400">
                    Нет входящих приглашений
                  </Card>
                )
              ) : (
                /* Исходящие (Пригласили) */
                partners.filter((p) => p.is_requester && p.status !== 'accepted').length > 0 ? (
                  <Card className="overflow-hidden rounded-3xl">
                    {partners
                      .filter((p) => p.is_requester && p.status !== 'accepted')
                      .map((p) => (
                        <div
                          key={p.connection_id}
                          className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-600 uppercase">
                              {p.partner_name?.charAt(0) ?? '?'}
                            </div>
                            <span className="font-mono text-xs text-slate-400 flex-shrink-0">C{p.partner_short_id}</span>
                            <span className="text-sm font-semibold text-slate-900 truncate">{p.partner_name}</span>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              p.status === 'pending'
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-rose-50 text-rose-600'
                            }`}
                          >
                            {p.status === 'pending' ? 'Ожидает ответа' : 'Отклонено'}
                          </span>
                        </div>
                      ))}
                  </Card>
                ) : (
                  <Card className="rounded-3xl px-4 py-4 text-sm text-slate-400">
                    Нет отправленных приглашений
                  </Card>
                )
              )}
            </div>
          )}
        </div>
      )}

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
