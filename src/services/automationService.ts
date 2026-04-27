import { supabase } from '../lib/supabase'

export interface AutomationSettings {
  account_id: string
  is_enabled: boolean
  source: 'ai' | 'templates' | 'ai_with_fallback'
  daily_limit: number
  target_ratings: number[]
  require_text: boolean
  delay_seconds: number
  store_ids: string[]
  daily_sent_count: number
  daily_reset_date: string | null
  last_run_at: string | null
  last_log: string[]
}

export interface AutomationLog {
  id: string
  account_id: string
  run_at: string
  sent_count: number
  log: string[]
  error: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any

export async function loadAutomationSettings(accountId: string): Promise<AutomationSettings | null> {
  if (!supabase) return null
  const { data, error } = await db()
    .from('automation_settings')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null // not found
    throw error
  }
  return data as AutomationSettings
}

export async function saveAutomationSettings(
  accountId: string,
  values: Partial<Omit<AutomationSettings, 'account_id' | 'daily_sent_count' | 'daily_reset_date' | 'last_run_at' | 'last_log'>>,
): Promise<void> {
  if (!supabase) return
  const { error } = await db()
    .from('automation_settings')
    .upsert({ account_id: accountId, ...values, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function loadAutomationLogs(accountId: string, limit = 20): Promise<AutomationLog[]> {
  if (!supabase) return []
  const { data, error } = await db()
    .from('automation_logs')
    .select('*')
    .eq('account_id', accountId)
    .order('run_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as AutomationLog[]
}
