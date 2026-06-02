import { supabase } from '../lib/supabase'

export interface CreatePaymentParams {
  account_id: string
  plan: 'seller' | 'operational'
  months: number
  amount_som: number
  discount_pct: number
}

export interface CreatePaymentResult {
  order_id: string
  payment_url: string
}

export interface PaymentOrderStatus {
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled'
  plan: string
  months: number
  amount_som: number
  paid_at: string | null
}

/** Создать платёжный заказ и получить ссылку на оплату */
export async function createPaymentOrder(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Необходима авторизация')

  const supabaseUrl = (supabase as any).supabaseUrl as string

  const response = await fetch(`${supabaseUrl}/functions/v1/create-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(params),
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Ошибка создания платежа')
  return data as CreatePaymentResult
}

/** Проверить статус платёжного заказа */
export async function getPaymentOrderStatus(orderId: string): Promise<PaymentOrderStatus | null> {
  if (!supabase) return null
  const { data, error } = await (supabase as any).rpc('get_payment_order_status', {
    p_order_id: orderId,
  })
  if (error || !data || (data as any[]).length === 0) return null
  return (data as any[])[0] as PaymentOrderStatus
}
