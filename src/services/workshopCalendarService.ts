import { supabase } from '../lib/supabase'

export type WorkshopOccupancy = {
  id: string
  title: string
  planStart: string
  planEnd: string
  factStart: string | null
  factEnd: string | null
}

type OccupancyRow = {
  id: string
  title: string
  plan_start: string
  plan_end: string
  fact_start: string | null
  fact_end: string | null
}

type DbError = { message?: string; code?: string } | null

function db() {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  return supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            order: (column: string, options: { ascending: boolean }) => Promise<{ data: OccupancyRow[] | null; error: DbError }>
          }
        }
      }
      insert: (row: Record<string, unknown>) => {
        select: (columns: string) => {
          single: () => Promise<{ data: OccupancyRow | null; error: DbError }>
        }
      }
      update: (row: Record<string, unknown>) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            is: (column: string, value: null) => {
              select: (columns: string) => {
                single: () => Promise<{ data: OccupancyRow | null; error: DbError }>
              }
            }
          }
        }
      }
    }
  }
}

function toOccupancy(row: OccupancyRow): WorkshopOccupancy {
  return {
    id: row.id,
    title: row.title,
    planStart: row.plan_start,
    planEnd: row.plan_end,
    factStart: row.fact_start,
    factEnd: row.fact_end,
  }
}

export function workshopCalendarError(error: DbError): string {
  const message = error?.message ?? ''
  if (error?.code === '23514') return 'Проверьте даты. Конец не может быть раньше начала, а факт заполняется двумя датами.'
  if (error?.code === 'PGRST116') return 'Занятость уже изменена или удалена. Обновите страницу.'
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Нет права записать занятость в эту компанию. Откройте свою компанию и повторите.'
  }
  if (/does not exist|schema cache|workshop_occupancies/i.test(message)) {
    return 'Таблица календаря ещё не готова в базе. Повторите чуть позже.'
  }
  return 'Не удалось записать занятость. Повторите.'
}

export async function fetchWorkshopOccupancies(accountId: string): Promise<WorkshopOccupancy[]> {
  const { data, error } = await db()
    .from('workshop_occupancies')
    .select('id, title, plan_start, plan_end, fact_start, fact_end')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('plan_start', { ascending: true })
  if (error) throw new Error(workshopCalendarError(error))
  return (data ?? []).map(toOccupancy)
}

export async function upsertWorkshopOccupancy(accountId: string, item: WorkshopOccupancy): Promise<WorkshopOccupancy> {
  const row = {
    account_id: accountId,
    title: item.title.trim(),
    plan_start: item.planStart,
    plan_end: item.planEnd,
    fact_start: item.factStart,
    fact_end: item.factEnd,
  }
  if (item.id) {
    const { data, error } = await db()
      .from('workshop_occupancies')
      .update(row)
      .eq('id', item.id)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .select('id, title, plan_start, plan_end, fact_start, fact_end')
      .single()
    if (error) throw new Error(workshopCalendarError(error))
    if (!data) throw new Error('Занятость уже удалена. Обновите страницу.')
    return toOccupancy(data)
  }
  const { data, error } = await db()
    .from('workshop_occupancies')
    .insert(row)
    .select('id, title, plan_start, plan_end, fact_start, fact_end')
    .single()
  if (error) throw new Error(workshopCalendarError(error))
  if (!data) throw new Error('Не удалось записать занятость. Повторите.')
  return toOccupancy(data)
}

export async function deleteWorkshopOccupancy(accountId: string, id: string): Promise<void> {
  const { error } = await db()
    .from('workshop_occupancies')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .select('id')
    .single()
  if (error) throw new Error(workshopCalendarError(error))
}
