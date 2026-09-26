import { supabase } from '../lib/supabase'
import type { ExecutorAccountSearchResult, ServiceRequest, ServiceRequestStore } from '../types'

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase as any
}

const throwRpc = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Не удалось выполнить действие')
}

export const fetchServiceRequests = async (accountId: string): Promise<ServiceRequest[]> => {
  const { data, error } = await client()
    .from('service_requests')
    .select('*, stores:service_request_stores(*)')
    .or(`applicant_account_id.eq.${accountId},executor_account_id.eq.${accountId}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: ServiceRequest) => ({
    ...row,
    stores: (row.stores ?? []).filter((store) => !store.deleted_at).sort((a, b) => a.position - b.position),
  }))
}

export const createServiceRequestDraft = async (accountId: string, executorAccountId?: string | null): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc('create_service_request_draft', {
    p_applicant_account_id: accountId,
    p_executor_account_id: executorAccountId ?? null,
    p_title: '',
  })
  throwRpc(error)
  return data as ServiceRequest
}

export const getPublicServiceRequestInvite = async (token: string): Promise<{ executor_account_id: string; executor_short_id: number; executor_name: string; expires_at: string; is_available: boolean }> => {
  const { data, error } = await client().rpc('get_service_request_invite', { p_token: token })
  throwRpc(error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Ссылка не найдена')
  return row
}

export const claimServiceRequestInvite = async (token: string): Promise<ExecutorAccountSearchResult> => {
  const { data, error } = await client().rpc('claim_service_request_invite', { p_token: token })
  throwRpc(error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Ссылка не найдена')
  return row as ExecutorAccountSearchResult
}

export interface SaveRequestDraftInput {
  title: string
  executorAccountId: string
  applicantName: string
  applicantEmail: string
  comment: string
  stores: Array<{
    store_id: string
    position: number
    delivery_mode: 'pickup' | 'self_delivery'
    intake_mode: 'bulk' | 'catalog' | 'barcodes' | 'boxes'
    payload: Record<string, unknown>
  }>
}

export const saveServiceRequestDraft = async (requestId: string, input: SaveRequestDraftInput): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc('save_service_request_draft', {
    p_request_id: requestId,
    p_title: input.title,
    p_executor_account_id: input.executorAccountId,
    p_applicant_name: input.applicantName,
    p_applicant_email: input.applicantEmail,
    p_comment: input.comment,
    p_stores: input.stores,
  })
  throwRpc(error)
  return data as ServiceRequest
}

export const submitServiceRequest = async (requestId: string) => {
  const { data, error } = await client().rpc('submit_service_request', { p_request_id: requestId })
  throwRpc(error)
  return data as { ok: boolean; version: number }
}

export const acceptServiceRequest = async (requestId: string) => {
  const { data, error } = await client().rpc('accept_service_request', { p_request_id: requestId })
  throwRpc(error)
  return data as { ok: boolean }
}

export const rejectServiceRequest = async (requestId: string, comment: string) => {
  const { data, error } = await client().rpc('reject_service_request', { p_request_id: requestId, p_comment: comment })
  throwRpc(error)
  return data as { ok: boolean }
}

export const copyServiceRequest = async (requestId: string): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc('copy_service_request', { p_request_id: requestId })
  throwRpc(error)
  return data as ServiceRequest
}

export const searchExecutorAccounts = async (query: string): Promise<ExecutorAccountSearchResult[]> => {
  if (!query.trim()) return []
  const { data, error } = await client().rpc('search_executor_accounts', { p_query: query.trim() })
  throwRpc(error)
  return (data ?? []) as ExecutorAccountSearchResult[]
}

export const fetchRequestStoreRows = async (requestId: string): Promise<ServiceRequestStore[]> => {
  const { data, error } = await client().from('service_request_stores').select('*').eq('request_id', requestId).is('deleted_at', null).order('position')
  if (error) throw error
  return (data ?? []) as ServiceRequestStore[]
}

export const createServiceRequestInvite = async (executorAccountId: string): Promise<{ token: string; expires_at: string }> => {
  const { data, error } = await client().rpc('create_service_request_invite', { p_executor_account_id: executorAccountId })
  throwRpc(error)
  return data as { token: string; expires_at: string }
}
