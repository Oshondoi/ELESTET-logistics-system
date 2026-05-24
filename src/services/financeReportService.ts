import { supabase } from '../lib/supabase'
import type {
  Product,
  WbFinanceReportRow,
  WbFinanceSyncResult,
  WbFinanceWeeklyReport,
  WbFinanceWeeklyReportRow,
} from '../types'

interface SyncParams {
  accountId: string
  storeId: string
  dateFrom: string
  dateTo: string
}

interface WeeklyDetailsSyncParams {
  accountId: string
  storeId: string
  reportId: number
}

export const syncWbFinanceReport = async ({ accountId, storeId, dateFrom, dateTo }: SyncParams): Promise<WbFinanceSyncResult> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase.functions.invoke<WbFinanceSyncResult & { error?: string }>(
    'wb-finance-report',
    {
      body: {
        account_id: accountId,
        store_id: storeId,
        date_from: dateFrom,
        date_to: dateTo,
      },
    },
  )

  if (error) throw error
  if (!data) throw new Error('Пустой ответ сервера')
  if (data.error) throw new Error(data.error)

  return { success: Boolean(data.success), count: data.count ?? 0 }
}

export const syncWbWeeklyReportsList = async ({ accountId, storeId, dateFrom, dateTo }: SyncParams): Promise<WbFinanceSyncResult> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase.functions.invoke<WbFinanceSyncResult & { error?: string }>(
    'wb-finance-report',
    {
      body: {
        account_id: accountId,
        store_id: storeId,
        date_from: dateFrom,
        date_to: dateTo,
        mode: 'weekly_list',
      },
    },
  )

  if (error) throw error
  if (!data) throw new Error('Пустой ответ сервера')
  if (data.error) throw new Error(data.error)

  return { success: Boolean(data.success), count: data.count ?? 0 }
}

export const syncWbWeeklyReportDetails = async ({ accountId, storeId, reportId }: WeeklyDetailsSyncParams): Promise<WbFinanceSyncResult> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase.functions.invoke<WbFinanceSyncResult & { error?: string }>(
    'wb-finance-report',
    {
      body: {
        account_id: accountId,
        store_id: storeId,
        report_id: reportId,
        mode: 'weekly_details',
      },
    },
  )

  if (error) throw error
  if (!data) throw new Error('Пустой ответ сервера')
  if (data.error) throw new Error(data.error)

  return { success: Boolean(data.success), count: data.count ?? 0 }
}

export const fetchWbFinanceRows = async ({ accountId, storeId, dateFrom, dateTo }: SyncParams): Promise<WbFinanceReportRow[]> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data, error } = await db
    .from('wb_finance_report_rows')
    .select('*')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    // Берём все строки синка, период которого пересекается с запрошенным диапазоном.
    // period_from/period_to = параметры запроса, с которыми шёл синк.
    .lte('period_from', dateTo)
    .gte('period_to', dateFrom)
    .order('report_date', { ascending: false, nullsFirst: false })
    .order('nm_id', { ascending: true })

  if (error) throw error
  return (data ?? []) as WbFinanceReportRow[]
}

export const fetchStoreProductCosts = async (storeId: string): Promise<Array<Pick<Product, 'nm_id' | 'vendor_code' | 'cost_price'>>> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  // Generated Supabase types may lag behind SQL patches (cost_price).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data, error } = await db
    .from('products')
    .select('nm_id,vendor_code,cost_price')
    .eq('store_id', storeId)

  if (error) throw error
  return (data ?? []) as Array<Pick<Product, 'nm_id' | 'vendor_code' | 'cost_price'>>
}

export const fetchWbWeeklyReports = async ({
  accountId,
  storeId,
  dateFrom,
  dateTo,
}: SyncParams): Promise<WbFinanceWeeklyReport[]> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data, error } = await db
    .from('wb_finance_weekly_reports')
    .select('*')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .lte('period_from', dateTo)
    .gte('period_to', dateFrom)
    .order('report_date', { ascending: false, nullsFirst: false })
    .order('report_id', { ascending: false })

  if (error) throw error
  return (data ?? []) as WbFinanceWeeklyReport[]
}

export const fetchWbWeeklyReportRows = async ({
  accountId,
  storeId,
  reportId,
}: {
  accountId: string
  storeId: string
  reportId: number
}): Promise<WbFinanceWeeklyReportRow[]> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data, error } = await db
    .from('wb_finance_weekly_report_rows')
    .select('*')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .eq('report_id', reportId)
    .order('row_number', { ascending: true })

  if (error) throw error
  return (data ?? []) as WbFinanceWeeklyReportRow[]
}
