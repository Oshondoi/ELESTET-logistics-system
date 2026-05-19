import { useState, useEffect, useCallback } from 'react'
import type { BatchOutsourceStage, BatchJournalEntry, FulfillmentBatch, OutsourcePartner } from '../../types'
import {
  fetchOutsourceStages,
  createOutsourceStage,
  deleteOutsourceStage,
  updateStageStatus,
  inviteCompanyToStage,
  fetchBatchJournal,
  findAccountByShortId,
  voteArchiveBatch,
  checkArchiveVote,
  reorderStages,
  fetchMyPartners,
} from '../../services/outsourceService'

// ─── Константы ───────────────────────────────────────────────

const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  accepted: 'Принято',
  in_progress: 'В работе',
  done: 'Выполнено',
  disputed: 'Расхождение',
  cancelled: 'Отменён',
}

const STAGE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  accepted: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-amber-50 text-amber-700',
  done: 'bg-emerald-50 text-emerald-700',
  disputed: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-400',
}

const EVENT_LABELS: Record<string, string> = {
  stage_created: 'Создан этап',
  stage_assigned: 'Назначен исполнитель',
  invite_sent: 'Отправлено приглашение',
  invite_accepted: 'Приглашение принято',
  invite_declined: 'Приглашение отклонено',
  stage_started: 'Этап начат',
  stage_completed: 'Этап выполнен',
  stage_disputed: 'Зафиксировано расхождение',
  stage_replaced: 'Исполнитель заменён',
  qty_declared: 'Заявлено количество',
  qty_received: 'Принято количество',
  discrepancy_flagged: 'Обнаружено расхождение',
  discrepancy_resolved: 'Расхождение урегулировано',
  batch_archived: 'Голос за архивирование',
  company_removed: 'Компания удалена из партии',
  owner_transferred: 'Смена владельца',
}

// ─── Вспомогательные компоненты ──────────────────────────────

const StatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-500'}`}>
    {STAGE_STATUS_LABELS[status] ?? status}
  </span>
)

// ─── Props ───────────────────────────────────────────────────

interface OutsourceStagesModalProps {
  open: boolean
  batch: FulfillmentBatch
  accountId: string
  accountShortId: number | null
  isOwner: boolean    // текущий пользователь — владелец этой партии
  onClose: () => void
}

// ─── Таб ─────────────────────────────────────────────────────

type TabKey = 'stages' | 'journal'

// ─── Компонент ───────────────────────────────────────────────

export const OutsourceStagesModal = ({
  open,
  batch,
  accountId,
  accountShortId,
  isOwner,
  onClose,
}: OutsourceStagesModalProps) => {
  const [tab, setTab] = useState<TabKey>('stages')
  const [stages, setStages] = useState<BatchOutsourceStage[]>([])
  const [journal, setJournal] = useState<BatchJournalEntry[]>([])
  const [isLoadingStages, setIsLoadingStages] = useState(false)
  const [isLoadingJournal, setIsLoadingJournal] = useState(false)
  const [hasVoted, setHasVoted] = useState(false)
  const [isVoting, setIsVoting] = useState(false)

  // Создание нового этапа
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageDesc, setNewStageDesc] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Приглашение компании
  const [inviteStageId, setInviteStageId] = useState<string | null>(null)
  const [inviteMode, setInviteMode] = useState<'partners' | 'manual'>('partners')
  const [partners, setPartners] = useState<OutsourcePartner[]>([])
  const [inviteInput, setInviteInput] = useState('')
  const [invitePreview, setInvitePreview] = useState<{ id: string; name: string; short_id: number } | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [isInviting, setIsInviting] = useState(false)
  const [isLookingUp, setIsLookingUp] = useState(false)

  // Количество (для передачи этапа)
  const [qtyStageId, setQtyStageId] = useState<string | null>(null)
  const [qtyDeclared, setQtyDeclared] = useState('')
  const [qtyReceived, setQtyReceived] = useState('')
  const [isUpdatingQty, setIsUpdatingQty] = useState(false)

  const loadStages = useCallback(async () => {
    setIsLoadingStages(true)
    try {
      const [data, voted, myPartners] = await Promise.all([
        fetchOutsourceStages(batch.id),
        checkArchiveVote(batch.id, accountId),
        fetchMyPartners(accountId),
      ])
      setStages(data)
      setHasVoted(voted)
      setPartners(myPartners.filter((p) => p.status === 'accepted'))
    } catch {
      // ignore
    } finally {
      setIsLoadingStages(false)
    }
  }, [batch.id, accountId])

  const loadJournal = useCallback(async () => {
    setIsLoadingJournal(true)
    try {
      const data = await fetchBatchJournal(batch.id)
      setJournal(data)
    } catch {
      // ignore
    } finally {
      setIsLoadingJournal(false)
    }
  }, [batch.id])

  useEffect(() => {
    if (!open) return
    void loadStages()
  }, [open, loadStages])

  useEffect(() => {
    if (!open || tab !== 'journal') return
    void loadJournal()
  }, [open, tab, loadJournal])

  if (!open) return null

  // ── Создание этапа ────────────────────────────────────────
  const handleCreateStage = async () => {
    if (!newStageName.trim()) return
    setIsCreating(true)
    setCreateError(null)
    try {
      await createOutsourceStage(batch.id, accountId, {
        name: newStageName.trim(),
        description: newStageDesc.trim() || undefined,
      }, stages.length)
      setNewStageName('')
      setNewStageDesc('')
      setShowCreateForm(false)
      await loadStages()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Ошибка создания')
    } finally {
      setIsCreating(false)
    }
  }

  // ── Удаление этапа ────────────────────────────────────────
  const handleDeleteStage = async (stageId: string) => {
    try {
      await deleteOutsourceStage(stageId)
      await loadStages()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка удаления')
    }
  }

  // ── Поиск компании по C-ID ───────────────────────────────
  const handleLookupCompany = async () => {
    const num = parseInt(inviteInput, 10)
    if (isNaN(num)) { setInviteError('Введите числовой ID'); return }
    if (num === accountShortId) { setInviteError('Нельзя пригласить свою компанию'); return }
    setIsLookingUp(true)
    setInviteError(null)
    setInvitePreview(null)
    try {
      const company = await findAccountByShortId(num)
      if (!company) { setInviteError(`Компания C-${num} не найдена`); return }
      setInvitePreview(company)
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Ошибка поиска')
    } finally {
      setIsLookingUp(false)
    }
  }

  // ── Отправить приглашение ────────────────────────────────
  const handleSendInvite = async () => {
    if (!inviteStageId || !invitePreview) return
    setIsInviting(true)
    setInviteError(null)
    try {
      const result = await inviteCompanyToStage(inviteStageId, invitePreview.short_id)
      if (result.error) { setInviteError(result.error); return }
      setInviteStageId(null)
      setInviteInput('')
      setInvitePreview(null)
      await loadStages()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Ошибка отправки')
    } finally {
      setIsInviting(false)
    }
  }

  // ── Обновление количества ────────────────────────────────
  const handleUpdateQty = async (stage: BatchOutsourceStage) => {
    const isDeclaring = stage.assigned_company_id !== accountId
    setIsUpdatingQty(true)
    try {
      const qty = parseInt(isDeclaring ? qtyDeclared : qtyReceived, 10)
      if (isNaN(qty)) return
      await updateStageStatus(stage.id, stage.status === 'accepted' ? 'in_progress' : stage.status, {
        qty_declared: isDeclaring ? qty : stage.qty_declared ?? undefined,
        qty_received: !isDeclaring ? qty : stage.qty_received ?? undefined,
      })
      setQtyStageId(null)
      setQtyDeclared('')
      setQtyReceived('')
      await loadStages()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsUpdatingQty(false)
    }
  }

  // ── Завершить этап ───────────────────────────────────────
  const handleCompleteStage = async (stageId: string) => {
    try {
      await updateStageStatus(stageId, 'done')
      await loadStages()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  // ── Начать работу ────────────────────────────────────────
  const handleStartStage = async (stageId: string) => {
    try {
      await updateStageStatus(stageId, 'in_progress')
      await loadStages()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  // ── Голос за архивирование ───────────────────────────────
  const handleArchiveVote = async () => {
    if (hasVoted) return
    setIsVoting(true)
    try {
      const result = await voteArchiveBatch(batch.id, accountId)
      if (result.error) { alert(result.error); return }
      setHasVoted(true)
      if (result.archived) {
        alert('Партия архивирована')
        onClose()
      } else {
        alert(`Ваш голос записан. Проголосовало ${result.votes} из ${result.total}`)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsVoting(false)
    }
  }

  // ── Перемещение этапа ↑↓ ────────────────────────────────
  const handleMoveStage = async (idx: number, dir: 'up' | 'down') => {
    const newStages = [...stages]
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= newStages.length) return
    // Swap sort_order values
    const aOrder = newStages[idx].sort_order
    const bOrder = newStages[swapIdx].sort_order
    newStages[idx] = { ...newStages[idx], sort_order: bOrder }
    newStages[swapIdx] = { ...newStages[swapIdx], sort_order: aOrder }
    // Sort by new order
    newStages.sort((a, b) => a.sort_order - b.sort_order)
    setStages(newStages)
    try {
      await reorderStages([
        { id: newStages[dir === 'up' ? swapIdx : idx].id, sort_order: bOrder },
        { id: newStages[dir === 'up' ? idx : swapIdx].id, sort_order: aOrder },
      ])
    } catch {
      await loadStages() // rollback on error
    }
  }

  const batchLabel = `${accountShortId != null ? `C-${accountShortId} ` : ''}${batch.short_id != null ? `P-${batch.short_id}` : batch.name}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">

        {/* Шапка */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-violet-50 px-2.5 py-1 font-mono text-xs font-semibold text-violet-600">
                {batchLabel}
              </span>
              <h2 className="text-base font-semibold text-slate-800">Аутсорс-этапы</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{batch.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Табы */}
        <div className="flex shrink-0 gap-1 border-b border-slate-100 px-4 pt-2">
          {([['stages', 'Этапы'], ['journal', 'Журнал']] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-t-xl px-4 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-b-2 border-violet-500 text-violet-600'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Тело */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">

          {/* ── ТАБ: ЭТАПЫ ─────────────────────────────────── */}
          {tab === 'stages' && (
            <div className="space-y-3">
              {isLoadingStages ? (
                <p className="py-8 text-center text-sm text-slate-400">Загрузка...</p>
              ) : stages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                  <p className="text-sm text-slate-400">Аутсорс-этапы не созданы</p>
                  {isOwner && (
                    <p className="mt-1 text-xs text-slate-300">Создайте этапы и назначьте исполнителей</p>
                  )}
                </div>
              ) : (
                stages.map((stage, idx) => {
                  const isMyStage = stage.assigned_company_id === accountId
                  const canInvite = isOwner && !stage.assigned_company_id && stage.status === 'pending'
                  const canStart = isMyStage && stage.status === 'accepted'
                  const canComplete = isMyStage && stage.status === 'in_progress'
                  const canDelete = isOwner && stage.status === 'pending' && !stage.assigned_company_id
                  const isInviteOpen = inviteStageId === stage.id
                  const canMoveUp = isOwner && idx > 0
                  const canMoveDown = isOwner && idx < stages.length - 1

                  return (
                    <div key={stage.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
                      {/* Заголовок этапа */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex flex-col">
                            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100 text-xs font-bold text-violet-600">
                              {idx + 1}
                            </span>
                            {isOwner && (
                              <div className="mt-0.5 flex flex-col">
                                <button
                                  type="button"
                                  onClick={() => void handleMoveStage(idx, 'up')}
                                  disabled={!canMoveUp}
                                  className="flex h-3.5 w-7 items-center justify-center text-slate-300 hover:text-violet-500 disabled:opacity-0"
                                  title="Переместить вверх"
                                >
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6"/></svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleMoveStage(idx, 'down')}
                                  disabled={!canMoveDown}
                                  className="flex h-3.5 w-7 items-center justify-center text-slate-300 hover:text-violet-500 disabled:opacity-0"
                                  title="Переместить вниз"
                                >
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
                                </button>
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-800">{stage.name}</p>
                            {stage.description && (
                              <p className="text-xs text-slate-400">{stage.description}</p>
                            )}
                          </div>
                        </div>
                        <StatusBadge status={stage.status} />
                      </div>

                      {/* Исполнитель */}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        {stage.assigned_company_id ? (
                          <div className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3 py-1.5">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                            </svg>
                            <span className="font-mono text-xs text-violet-600 font-medium">
                              C-{stage.assigned_company_short_id}
                            </span>
                            <span className="text-xs text-slate-600">{stage.assigned_company_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Исполнитель не назначен</span>
                        )}

                        {/* Количество */}
                        {stage.qty_declared != null && (
                          <span className="rounded-xl bg-blue-50 px-2.5 py-1 text-xs text-blue-600">
                            Заявлено: {stage.qty_declared}
                          </span>
                        )}
                        {stage.qty_received != null && (
                          <span className={`rounded-xl px-2.5 py-1 text-xs ${stage.has_discrepancy ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            Принято: {stage.qty_received}
                            {stage.has_discrepancy && ' ⚠️'}
                          </span>
                        )}
                      </div>

                      {/* Расхождение */}
                      {stage.has_discrepancy && (
                        <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          <strong>Расхождение:</strong> заявлено {stage.qty_declared}, принято {stage.qty_received}.
                          Необходима сверка между сторонами.
                        </div>
                      )}

                      {/* Действия */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {canStart && (
                          <button
                            type="button"
                            onClick={() => void handleStartStage(stage.id)}
                            className="rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                          >
                            Начать работу
                          </button>
                        )}
                        {canComplete && (
                          <button
                            type="button"
                            onClick={() => {
                              setQtyStageId(stage.id)
                              setQtyReceived(String(stage.qty_declared ?? ''))
                            }}
                            className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            Завершить
                          </button>
                        )}
                        {canInvite && (
                          <button
                            type="button"
                            onClick={() => {
                              setInviteStageId(stage.id)
                              setInviteMode(partners.length > 0 ? 'partners' : 'manual')
                              setInviteInput('')
                              setInvitePreview(null)
                              setInviteError(null)
                            }}
                            className="rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
                          >
                            + Назначить исполнителя
                          </button>
                        )}
                        {isOwner && stage.assigned_company_id && stage.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => {
                              setInviteStageId(stage.id)
                              setInviteMode(partners.length > 0 ? 'partners' : 'manual')
                              setInviteInput('')
                              setInvitePreview(null)
                              setInviteError(null)
                            }}
                            className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                          >
                            Переназначить
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteStage(stage.id)}
                            className="rounded-xl px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            Удалить
                          </button>
                        )}
                      </div>

                      {/* Форма приглашения */}
                      {isInviteOpen && (
                        <div className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
                          {/* Переключатель режима */}
                          <div className="flex gap-1.5 mb-3">
                            <button
                              type="button"
                              onClick={() => { setInviteMode('partners'); setInvitePreview(null); setInviteError(null) }}
                              className={`rounded-xl px-3 py-1 text-xs font-medium transition-colors ${
                                inviteMode === 'partners'
                                  ? 'bg-violet-500 text-white'
                                  : 'bg-white text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              Из партнёров {partners.length > 0 && `(${partners.length})`}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setInviteMode('manual'); setInvitePreview(null); setInviteError(null) }}
                              className={`rounded-xl px-3 py-1 text-xs font-medium transition-colors ${
                                inviteMode === 'manual'
                                  ? 'bg-violet-500 text-white'
                                  : 'bg-white text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              Ввести C-ID
                            </button>
                          </div>

                          {/* Режим: выбор из партнёров */}
                          {inviteMode === 'partners' && (
                            <>
                              {partners.length === 0 ? (
                                <p className="text-xs text-slate-400 py-2">
                                  Нет подключённых партнёров. Добавьте их в разделе Роли → Аутсорс.
                                </p>
                              ) : (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {partners.map((p) => (
                                    <button
                                      key={p.connection_id}
                                      type="button"
                                      onClick={() => {
                                        setInvitePreview({ id: p.partner_id, name: p.partner_name, short_id: p.partner_short_id })
                                        setInviteError(null)
                                      }}
                                      className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                                        invitePreview?.id === p.partner_id
                                          ? 'bg-violet-100 border border-violet-300'
                                          : 'bg-white hover:bg-violet-50 border border-transparent'
                                      }`}
                                    >
                                      <span className="font-mono text-xs font-bold text-violet-600 shrink-0">
                                        C-{p.partner_short_id}
                                      </span>
                                      <span className="text-xs text-slate-700 truncate">{p.partner_name}</span>
                                      {invitePreview?.id === p.partner_id && (
                                        <svg className="h-3.5 w-3.5 text-violet-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                          <path d="M5 13l4 4L19 7"/>
                                        </svg>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}

                          {/* Режим: ввод C-ID вручную */}
                          {inviteMode === 'manual' && (
                            <>
                              <p className="mb-2 text-xs font-medium text-violet-700">Введите C-ID компании</p>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-slate-500">C-</span>
                                <input
                                  type="number"
                                  value={inviteInput}
                                  onChange={(e) => { setInviteInput(e.target.value); setInvitePreview(null) }}
                                  className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
                                  placeholder="ID"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleLookupCompany()}
                                  disabled={isLookingUp || !inviteInput}
                                  className="rounded-xl bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-200 disabled:opacity-50"
                                >
                                  {isLookingUp ? '...' : 'Найти'}
                                </button>
                              </div>
                            </>
                          )}

                          {/* Ошибка */}
                          {inviteError && (
                            <p className="mt-2 text-xs text-rose-600">{inviteError}</p>
                          )}

                          {/* Предпросмотр + кнопка Пригласить */}
                          {invitePreview && (
                            <div className="mt-2 flex items-center justify-between rounded-xl bg-white border border-violet-200 px-3 py-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{invitePreview.name}</p>
                                <p className="text-xs text-violet-500 font-mono">C-{invitePreview.short_id}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleSendInvite()}
                                disabled={isInviting}
                                className="rounded-xl bg-violet-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                              >
                                {isInviting ? 'Отправка...' : 'Пригласить'}
                              </button>
                            </div>
                          )}

                          {/* Кнопка отмены формы */}
                          <button
                            type="button"
                            onClick={() => { setInviteStageId(null); setInviteError(null); setInvitePreview(null) }}
                            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                          >
                            Отмена
                          </button>
                        </div>
                      )}

                      {/* Форма завершения с количеством */}
                      {qtyStageId === stage.id && (
                        <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
                          <p className="mb-2 text-xs font-medium text-emerald-700">Укажите принятое количество</p>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={qtyReceived}
                              onChange={(e) => setQtyReceived(e.target.value)}
                              className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
                              placeholder="Кол-во"
                            />
                            <button
                              type="button"
                              onClick={() => void handleCompleteStage(stage.id)}
                              className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                            >
                              Завершить
                            </button>
                            <button
                              type="button"
                              onClick={() => setQtyStageId(null)}
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              Отмена
                            </button>
                          </div>
                          {stage.qty_declared != null && parseInt(qtyReceived) !== stage.qty_declared && qtyReceived !== '' && (
                            <p className="mt-1.5 text-xs text-amber-600">
                              ⚠️ Заявлено {stage.qty_declared} — если подтвердить, зафиксируется расхождение
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}

              {/* Кнопка создания этапа (только владелец) */}
              {isOwner && (
                <>
                  {!showCreateForm ? (
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(true)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-violet-200 py-3 text-sm text-violet-500 hover:border-violet-400 hover:bg-violet-50/50"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      Добавить этап
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                      <p className="mb-2 text-xs font-semibold text-violet-700">Новый аутсорс-этап</p>
                      <input
                        type="text"
                        value={newStageName}
                        onChange={(e) => setNewStageName(e.target.value)}
                        placeholder="Название этапа (напр. ФФ, Маркировка, Упаковка)"
                        className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newStageDesc}
                        onChange={(e) => setNewStageDesc(e.target.value)}
                        placeholder="Описание (необязательно)"
                        className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                      />
                      {createError && <p className="mb-2 text-xs text-rose-600">{createError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleCreateStage()}
                          disabled={isCreating || !newStageName.trim()}
                          className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                        >
                          {isCreating ? 'Создание...' : 'Создать'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowCreateForm(false); setNewStageName(''); setNewStageDesc('') }}
                          className="rounded-xl px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Голос за архивирование */}
              <div className="mt-4 border-t border-slate-100 pt-4">
                {hasVoted ? (
                  <div className="w-full rounded-2xl border border-emerald-100 bg-emerald-50 py-2.5 text-center text-sm text-emerald-600">
                    ✓ Вы уже проголосовали за архивирование
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleArchiveVote()}
                    disabled={isVoting}
                    className="w-full rounded-2xl border border-slate-200 py-2.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                  >
                    {isVoting ? 'Голосование...' : 'Проголосовать за архивирование партии'}
                  </button>
                )}
                <p className="mt-1.5 text-center text-xs text-slate-400">
                  Партия уйдёт в архив только когда все участники проголосуют
                </p>
              </div>
            </div>
          )}

          {/* ── ТАБ: ЖУРНАЛ ────────────────────────────────── */}
          {tab === 'journal' && (
            <div>
              {isLoadingJournal ? (
                <p className="py-8 text-center text-sm text-slate-400">Загрузка журнала...</p>
              ) : journal.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">Событий ещё нет</p>
              ) : (
                <div className="space-y-1">
                  {[...journal].reverse().map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100">
                        <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          {EVENT_LABELS[entry.event_type] ?? entry.event_type}
                        </p>
                        {entry.company_name && (
                          <p className="text-xs text-slate-400">
                            <span className="font-mono text-violet-500">C-{entry.company_short_id}</span>{' '}
                            {entry.company_name}
                          </p>
                        )}
                        {entry.payload && Object.keys(entry.payload).length > 0 && (
                          <p className="text-xs text-slate-400 font-mono">
                            {Object.entries(entry.payload)
                              .filter(([k]) => k !== 'stage_id' && k !== 'invite_id')
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                      <time className="shrink-0 text-xs text-slate-400" title={entry.created_at}>
                        {new Date(entry.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZoneName: 'short',
                        })}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
