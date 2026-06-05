import { supabase } from '../lib/supabase'

export interface PlanConfig {
  key: string
  label: string
  description: string
  features: string[]
  price_sale: number
  price_full: number | null
  is_active?: boolean
  sort_order: number
  updated_at?: string
}

/** Для страницы подписки — только активные тарифы */
export async function getPlanConfigs(): Promise<PlanConfig[]> {
  if (!supabase) return []
  const { data, error } = await (supabase as any).rpc('get_plan_configs')
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    features: Array.isArray(r.features) ? r.features : [],
  }))
}

/** Для AdminPage — все тарифы включая неактивные */
export async function adminGetPlanConfigs(): Promise<PlanConfig[]> {
  if (!supabase) return []
  const { data, error } = await (supabase as any).rpc('admin_get_plan_configs')
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    features: Array.isArray(r.features) ? r.features : [],
  }))
}

/** Сохранить тариф */
export async function adminUpsertPlanConfig(plan: PlanConfig): Promise<void> {
  if (!supabase) throw new Error('No supabase')
  const { error } = await (supabase as any).rpc('admin_upsert_plan_config', {
    p_key:         plan.key,
    p_label:       plan.label,
    p_description: plan.description,
    p_features:    plan.features,
    p_price_sale:  plan.price_sale,
    p_price_full:  plan.price_full ?? null,
    p_is_active:   plan.is_active ?? true,
    p_sort_order:  plan.sort_order,
  })
  if (error) throw new Error(error.message)
}
