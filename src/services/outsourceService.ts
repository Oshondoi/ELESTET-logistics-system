import { supabase } from '../lib/supabase'
import type {
  BatchOutsourceStage,
  BatchOutsourceStageFormValues,
  BatchJournalEntry,
  BatchNotification,
  IncomingInvite,
  OutgoingInvite,
  OutsourceBatch,
  OutsourcePartner,
} from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ─── Этапы аутсорса ──────────────────────────────────────────

export async function fetchOutsourceStages(batchId: string): Promise<BatchOutsourceStage[]> {
  const { data, error } = await db
    .from('batch_outsource_stages')
    .select(`
      *,
      assigned_company:accounts!batch_outsource_stages_assigned_company_id_fkey(name, short_id)
    `)
    .eq('batch_id', batchId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    ...row,
    assigned_company_name: (row.assigned_company as { name: string } | null)?.name ?? null,
    assigned_company_short_id: (row.assigned_company as { short_id: number } | null)?.short_id ?? null,
    assigned_company: undefined,
  })) as BatchOutsourceStage[]
}

export async function createOutsourceStage(
  batchId: string,
  ownerAccountId: string,
  values: BatchOutsourceStageFormValues,
  sortOrder: number,
): Promise<BatchOutsourceStage> {
  const { data, error } = await db
    .from('batch_outsource_stages')
    .insert({
      batch_id: batchId,
      owner_account_id: ownerAccountId,
      name: values.name,
      description: values.description ?? null,
      sort_order: sortOrder,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  await db.from('batch_journal').insert({
    batch_id: batchId,
    event_type: 'stage_created',
    payload: { stage_id: data.id, stage_name: values.name, sort_order: sortOrder },
  })

  return data as BatchOutsourceStage
}

export async function updateOutsourceStage(
  stageId: string,
  updates: Partial<BatchOutsourceStageFormValues>,
): Promise<BatchOutsourceStage> {
  const { data, error } = await db
    .from('batch_outsource_stages')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', stageId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as BatchOutsourceStage
}

export async function deleteOutsourceStage(stageId: string): Promise<void> {
  const { error } = await db
    .from('batch_outsource_stages')
    .delete()
    .eq('id', stageId)
    .eq('status', 'pending')

  if (error) throw new Error(error.message)
}

export async function updateStageStatus(
  stageId: string,
  status: string,
  extras?: { qty_declared?: number; qty_received?: number },
): Promise<BatchOutsourceStage> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'in_progress') updates.started_at = new Date().toISOString()
  if (status === 'done') updates.completed_at = new Date().toISOString()
  if (extras?.qty_declared != null) updates.qty_declared = extras.qty_declared
  if (extras?.qty_received != null) {
    updates.qty_received = extras.qty_received
    if (extras.qty_declared != null && extras.qty_declared !== extras.qty_received) {
      updates.has_discrepancy = true
      updates.status = 'disputed'
    }
  }

  const { data, error } = await db
    .from('batch_outsource_stages')
    .update(updates)
    .eq('id', stageId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as BatchOutsourceStage
}

// ─── Поиск компании по C-ID ──────────────────────────────────

export async function findAccountByShortId(shortId: number): Promise<{ id: string; name: string; short_id: number } | null> {
  const { data, error } = await db.rpc('find_account_by_short_id', {
    p_short_id: shortId,
  })
  if (error) throw new Error(error.message)
  return (data as { id: string; name: string; short_id: number }[] | null)?.[0] ?? null
}

// ─── Приглашения ─────────────────────────────────────────────

export async function inviteCompanyToStage(
  stageId: string,
  companyShortId: number,
): Promise<{ ok: boolean; invited_company?: { id: string; name: string; short_id: number }; error?: string }> {
  const { data, error } = await db.rpc('invite_company_to_stage', {
    p_stage_id: stageId,
    p_company_short_id: companyShortId,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; invited_company?: { id: string; name: string; short_id: number }; error?: string }
}

export async function respondToInvite(
  inviteId: string,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db.rpc('respond_to_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; error?: string }
}

export async function fetchIncomingInvites(): Promise<IncomingInvite[]> {
  const { data, error } = await db.rpc('get_my_incoming_invites')
  if (error) throw new Error(error.message)
  return (data ?? []) as IncomingInvite[]
}

export async function fetchOutgoingInvites(): Promise<OutgoingInvite[]> {
  const { data, error } = await db.rpc('get_my_outgoing_invites')
  if (error) throw new Error(error.message)
  return (data ?? []) as OutgoingInvite[]
}

// ─── Партии где я аутсорс-исполнитель ────────────────────────

export async function fetchOutsourceBatches(): Promise<OutsourceBatch[]> {
  const { data, error } = await db.rpc('get_outsource_batches')
  if (error) throw new Error(error.message)
  return (data ?? []) as OutsourceBatch[]
}

// ─── Журнал партии ───────────────────────────────────────────

export async function fetchBatchJournal(batchId: string): Promise<BatchJournalEntry[]> {
  const { data, error } = await db.rpc('get_batch_journal', { p_batch_id: batchId })
  if (error) throw new Error(error.message)
  return (data ?? []) as BatchJournalEntry[]
}

export async function addJournalEntry(
  batchId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('batch_journal').insert({
    batch_id: batchId,
    event_type: eventType,
    payload,
  })
  if (error) throw new Error(error.message)
}

// ─── Уведомления ─────────────────────────────────────────────

export async function fetchNotifications(accountId: string): Promise<BatchNotification[]> {
  const { data, error } = await db
    .from('batch_notifications')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as BatchNotification[]
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await db
    .from('batch_notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead(accountId: string): Promise<void> {
  const { error } = await db
    .from('batch_notifications')
    .update({ is_read: true })
    .eq('account_id', accountId)
    .eq('is_read', false)
  if (error) throw new Error(error.message)
}

// ─── Проверка — голосовал ли уже ─────────────────────────────

export async function checkArchiveVote(batchId: string, companyId: string): Promise<boolean> {
  const { data, error } = await db
    .from('batch_archive_votes')
    .select('id')
    .eq('batch_id', batchId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) return false
  return data !== null
}

// ─── Сортировка этапов ────────────────────────────────────────

export async function reorderStages(updates: { id: string; sort_order: number }[]): Promise<void> {
  await Promise.all(
    updates.map(({ id, sort_order }) =>
      db
        .from('batch_outsource_stages')
        .update({ sort_order, updated_at: new Date().toISOString() })
        .eq('id', id),
    ),
  )
}

// ─── Голос за архивирование ───────────────────────────────────

export async function voteArchiveBatch(
  batchId: string,
  companyId: string,
): Promise<{ ok: boolean; archived: boolean; votes?: number; total?: number; error?: string }> {
  const { data, error } = await db.rpc('vote_batch_archive', {
    p_batch_id: batchId,
    p_company_id: companyId,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; archived: boolean; votes?: number; total?: number; error?: string }
}

// ─── Партнёры (B2B контакты) ──────────────────────────────────

export async function fetchMyPartners(accountId: string): Promise<OutsourcePartner[]> {
  const { data, error } = await db.rpc('get_my_partners', { p_account_id: accountId })
  if (error) throw new Error(error.message)
  return (data ?? []) as OutsourcePartner[]
}

export async function sendPartnerRequest(
  myAccountId: string,
  partnerShortId: number,
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await db.rpc('send_partner_request', {
    p_my_account_id: myAccountId,
    p_partner_short_id: partnerShortId,
  })
  if (error) throw new Error(error.message)
  return data as { ok?: boolean; error?: string }
}

export async function respondToPartnerRequest(
  connectionId: string,
  accept: boolean,
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await db.rpc('respond_to_partner_request', {
    p_connection_id: connectionId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message)
  return data as { ok?: boolean; error?: string }
}

export async function removePartner(connectionId: string): Promise<void> {
  await db.rpc('remove_partner', { p_connection_id: connectionId })
}
