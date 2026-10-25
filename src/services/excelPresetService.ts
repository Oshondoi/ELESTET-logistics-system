import { supabase } from '../lib/supabase'
import type { ExcelConstructorColumnKey, ExcelExportPreset } from '../lib/fulfillmentExcelConstructor'

export async function fetchExcelExportPresets(accountId: string): Promise<ExcelExportPreset[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any)
    .from('fulfillment_excel_export_presets')
    .select('*')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name),
    columns: Array.isArray(row.columns) ? row.columns as ExcelConstructorColumnKey[] : [],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }))
}

export async function saveExcelExportPreset(
  accountId: string,
  input: { id?: string; name: string; columns: ExcelConstructorColumnKey[] },
): Promise<ExcelExportPreset> {
  if (!supabase) throw new Error('Supabase не настроен')
  const payload = {
    account_id: accountId,
    name: input.name.trim(),
    columns: input.columns,
    updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { data, error } = await (supabase as any)
      .from('fulfillment_excel_export_presets')
      .update(payload)
      .eq('id', input.id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) throw error
    await logPresetActivity(accountId, input.id, input.name, 'updated', `Изменён набор «${input.name}»`)
    return data as ExcelExportPreset
  }
  const { data, error } = await (supabase as any)
    .from('fulfillment_excel_export_presets')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  await logPresetActivity(accountId, String(data.id), input.name, 'created', `Создан набор «${input.name}»`)
  return data as ExcelExportPreset
}

export async function deleteExcelExportPreset(accountId: string, presetId: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any)
    .from('fulfillment_excel_export_presets')
    .delete()
    .eq('id', presetId)
    .eq('account_id', accountId)
  if (error) throw error
  await logPresetActivity(accountId, presetId, name, 'deleted', `Удалён набор «${name}»`)
}

async function logPresetActivity(
  accountId: string,
  presetId: string,
  presetName: string,
  action: string,
  message: string,
): Promise<void> {
  if (!supabase) return
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  const { data: profile } = user
    ? await supabase.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle()
    : { data: null }
  await (supabase as any).from('fulfillment_excel_preset_activity').insert({
    account_id: accountId,
    preset_id: presetId,
    preset_name: presetName,
    action,
    actor_user_id: user?.id ?? null,
    actor_name: profile?.full_name ?? null,
    actor_email: user?.email ?? null,
    message,
  })
}

export async function fetchExcelPresetActivity(accountId: string) {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any)
    .from('fulfillment_excel_preset_activity')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}
