import { supabase } from '../lib/supabase'

export type TrackedRequest = {
  id: string; short_id: number; title: string; status: string; created_at: string; updated_at: string;
  applicant_company_short_id: number; executor_company_short_id: number; executor_company_name: string;
}
export type TrackedItem = { barcode: string; name: string; article: string; size: string; color: string;
  declared: number | null; received: number | null; defect: number | null; otk: number | null; marked: number | null; packed: number | null }
export type TrackingDetail = TrackedRequest & {
  synced_at: string; work_started_at: string | null; history_allowed: boolean; documents_allowed: boolean;
  batches: Array<{ id: string; short_id: number; owner_short_id: number; name: string; store_name: string; status: string; acceptance_status: string;
    stages: Array<{ id: string; order_index: number; company_short_id: number; company_name: string; step: string; status: string;
      activated_at: string | null; completed_at: string | null; confirmed_at: string | null; items: TrackedItem[] }>;
    documents: Array<{ id: string; kind: string; revision: number; status: string; issued_at: string; accepted_quantity: number | null }> }>;
  history: Array<{ id: string; at: string; kind: string; event: string; version: number; batch_short_id: number | null; owner_short_id: number | null; company_short_id: number | null }>;
}
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Сервис недоступен')
  const { data, error } = await supabase.rpc(name as never, args as never)
  if (error) throw new Error(error.message)
  return data as T
}
export const listRequestTracking = (accountId: string, search: string, offset: number) =>
  call<{rows: TrackedRequest[]; total: number; synced_at: string}>('list_client_request_tracking', {p_account: accountId, p_search: search, p_offset: offset})
export const getRequestTracking = (accountId: string, requestId: string) =>
  call<TrackingDetail>('get_client_request_tracking', {p_account: accountId, p_request: requestId})
