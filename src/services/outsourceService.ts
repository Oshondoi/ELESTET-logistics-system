import { supabase } from '../lib/supabase'
import type { BatchNotification, ExecutorOption, OutsourcePartner } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// Уведомления

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

// Опции исполнителя для пайплайна

export async function fetchExecutorOptions(accountId: string): Promise<ExecutorOption[]> {
  const { data, error } = await db.rpc('get_executor_options', { p_account_id: accountId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ExecutorOption[]
}

// Партнёры (аутсорс)

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
  return (data ?? {}) as { ok?: boolean; error?: string }
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
  return (data ?? {}) as { ok?: boolean; error?: string }
}

export async function removePartner(connectionId: string): Promise<void> {
  const { error } = await db.rpc('remove_partner', { p_connection_id: connectionId })
  if (error) throw new Error(error.message)
}