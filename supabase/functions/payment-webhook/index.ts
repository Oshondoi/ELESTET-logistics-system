import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Принимаем только POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const rawBody = await req.text()
    const body = JSON.parse(rawBody)

    // ── TODO: Проверка подписи MBusiness ────────────────────
    // После получения документации MBusiness — раскомментировать и заполнить:
    //
    // const signature = req.headers.get('X-MBusiness-Signature') // TODO: уточнить имя заголовка
    // const secret = Deno.env.get('MBUSINESS_WEBHOOK_SECRET')!
    // const expectedSig = await computeHmacSha256(rawBody, secret)
    // if (signature !== expectedSig) {
    //   console.error('Invalid webhook signature')
    //   return new Response('Unauthorized', { status: 401 })
    // }

    // ── TODO: Маппинг полей MBusiness ───────────────────────
    // После получения документации — заменить на реальные имена полей:
    //
    // const orderId       = body.order_id          // TODO: реальное поле MBusiness
    // const status        = body.status            // TODO: реальное поле
    // const SUCCESS_STATUS = 'SUCCESS'             // TODO: реальное значение успеха
    // const providerOrderId  = body.payment_id     // TODO: реальное поле
    // const transactionId    = body.transaction_id // TODO: реальное поле

    // ЗАГЛУШКА — поля которые мы сами контролируем в заглушке create-payment:
    const orderId         = body.order_id
    const status          = body.status
    const SUCCESS_STATUS  = 'paid'
    const providerOrderId = body.provider_order_id ?? null
    const transactionId   = body.transaction_id    ?? null

    if (!orderId) {
      console.error('Webhook: missing order_id', body)
      return new Response(JSON.stringify({ received: true, error: 'missing order_id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Не-успешный статус — получили, ничего не делаем (не активируем план)
    if (status !== SUCCESS_STATUS) {
      console.log(`Webhook: order ${orderId} status=${status}, skipping activation`)
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey)

    // ── Активируем план ──────────────────────────────────────
    const { error } = await serviceClient.rpc('activate_plan_by_payment', {
      p_order_id:                orderId,
      p_provider_order_id:       providerOrderId,
      p_provider_transaction_id: transactionId,
      p_webhook_payload:         body,
    })

    if (error) {
      console.error('activate_plan_by_payment error:', error)
      // Возвращаем 200 чтобы MBusiness не повторял запрос бесконечно.
      // Ошибки логируются — можно исправить вручную через AdminPage.
      return new Response(JSON.stringify({ received: true, error: error.message }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`Webhook: order ${orderId} activated successfully`)
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('payment-webhook unhandled error:', err)
    // Всегда 200 чтобы MBusiness не ретраил
    return new Response(JSON.stringify({ received: true, error: err instanceof Error ? err.message : 'error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
