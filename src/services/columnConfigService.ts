import { supabase } from '../lib/supabase'

export interface CustomColDef {
  key: string
  name: string
  type: 'text' | 'number' | 'date' | 'boolean'
  position: number
}

export interface ColumnConfig {
  hiddenBuiltin: string[]
  customCols: CustomColDef[]
}

export const DEFAULT_COLUMN_CONFIG: ColumnConfig = {
  hiddenBuiltin: [],
  customCols: [],
}

export const BUILTIN_TRIP_COLS = [
  { key: 'carrier', label: 'Перевозчик' },
  { key: 'departure_date', label: 'Дата отправки' },
  { key: 'lines_count', label: 'Поставок' },
  { key: 'status', label: 'Статус' },
  { key: 'payment', label: 'Оплата' },
  { key: 'comment', label: 'Комментарий' },
] as const

export const BUILTIN_LINE_COLS = [
  { key: 'shipment', label: 'Поставка' },
  { key: 'volume', label: 'Объём' },
  { key: 'reception_date', label: 'Дата приёма' },
  { key: 'status', label: 'Статус' },
  { key: 'arrival_date', label: 'Прибыл' },
  { key: 'shipped_date', label: 'Отгружено' },
  { key: 'marketplace_delivery_date', label: 'Дата МП' },
  { key: 'payment', label: 'Оплата' },
  { key: 'comment', label: 'Комментарий' },
] as const

export async function fetchColumnConfig(
  accountId: string,
  entityType: 'trip' | 'trip_line',
): Promise<ColumnConfig> {
  const { data, error } = await supabase
    .from('column_configs')
    .select('hidden_builtin, custom_cols')
    .eq('account_id', accountId)
    .eq('entity_type', entityType)
    .maybeSingle()

  if (error) throw error
  if (!data) return DEFAULT_COLUMN_CONFIG

  return {
    hiddenBuiltin: data.hidden_builtin ?? [],
    customCols: (data.custom_cols as CustomColDef[]) ?? [],
  }
}

export async function upsertColumnConfig(
  accountId: string,
  entityType: 'trip' | 'trip_line',
  config: ColumnConfig,
): Promise<void> {
  const { error } = await supabase.from('column_configs').upsert(
    {
      account_id: accountId,
      entity_type: entityType,
      hidden_builtin: config.hiddenBuiltin,
      custom_cols: config.customCols,
    },
    { onConflict: 'account_id,entity_type' },
  )
  if (error) throw error
}

export async function updateTripCustomFieldsInSupabase(
  tripId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('trips')
    .update({ custom_fields: fields })
    .eq('id', tripId)
  if (error) throw error
}

export async function updateLineCustomFieldsInSupabase(
  lineId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('trip_lines')
    .update({ custom_fields: fields })
    .eq('id', lineId)
  if (error) throw error
}
