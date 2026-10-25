import { supabase } from '../lib/supabase'

export interface LogisticsActivityEntry {
  id: string
  account_id: string
  trip_id: string | null
  trip_line_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  actor_email: string | null
  actor_label: string
  timezone_label: string | null
  message: string
  field_key: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
}

export async function writeLogisticsActivity(input: {
  accountId: string
  tripId?: string | null
  tripLineId?: string | null
  message: string
  fieldKey?: string | null
  oldValue?: string | null
  newValue?: string | null
  actorLabel?: string
}): Promise<void> {
  if (!supabase) return
  const { error } = await (supabase as any).rpc('logistics_write_activity', {
    p_account_id: input.accountId,
    p_trip_id: input.tripId ?? null,
    p_trip_line_id: input.tripLineId ?? null,
    p_message: input.message,
    p_field_key: input.fieldKey ?? null,
    p_old_value: input.oldValue ?? null,
    p_new_value: input.newValue ?? null,
    p_actor_label: input.actorLabel ?? 'Сотрудник',
  })
  if (error) console.warn('logistics activity', error.message)
}

export async function fetchLogisticsActivity(accountId: string, limit = 200): Promise<LogisticsActivityEntry[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('fetch_logistics_activity_log', {
    p_account_id: accountId,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as LogisticsActivityEntry[]
}

export async function setLogisticsManualDate(
  entity: 'trip' | 'trip_line',
  entityId: string,
  field: string,
  date: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any).rpc('set_logistics_manual_date', {
    p_entity: entity,
    p_entity_id: entityId,
    p_field: field,
    p_date: date,
  })
  if (error) throw error
}
