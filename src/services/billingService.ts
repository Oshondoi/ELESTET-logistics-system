import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/** Активировать grace period (3 дня в долг) */
export async function activateGracePeriod(accountId: string): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await db.rpc('activate_grace_period', { p_account_id: accountId })
  if (error) throw new Error(error.message)
  return (data ?? {}) as { ok?: boolean; error?: string }
}

/** Суперадмин: установить план вручную */
export async function adminSetPlan(
  accountId: string,
  plan: string,
  planUntil: string,
  note?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await db.rpc('admin_set_plan', {
    p_account_id: accountId,
    p_plan: plan,
    p_plan_until: planUntil,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? {}) as { ok?: boolean; error?: string }
}

/** Загрузить историю изменений подписки для аккаунта */
export async function fetchPlanHistory(accountId: string): Promise<PlanHistoryEntry[]> {
  const { data, error } = await db
    .from('account_plan_history')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanHistoryEntry[]
}

/** Загрузить всю историю (для AdminPage) */
export async function fetchAllPlanHistory(): Promise<PlanHistoryEntry[]> {
  const { data, error } = await db
    .from('account_plan_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanHistoryEntry[]
}

export interface PlanHistoryEntry {
  id: string
  account_id: string
  event_type: string
  old_plan: string | null
  new_plan: string | null
  old_plan_until: string | null
  new_plan_until: string | null
  note: string | null
  changed_by: string | null
  created_at: string
}
