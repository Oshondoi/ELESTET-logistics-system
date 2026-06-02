import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // ── Проверяем авторизацию пользователя ──────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Парсим тело запроса ──────────────────────────────────
    const body = await req.json()
    const { account_id, plan, months, amount_som, discount_pct } = body

    if (!account_id || !plan || !months || !amount_som) {
      return new Response(JSON.stringify({ error: 'Отсутствуют обязательные поля' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['seller', 'operational'].includes(plan)) {
      return new Response(JSON.stringify({ error: 'Неверный тариф' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (months < 1 || months > 12) {
      return new Response(JSON.stringify({ error: 'Период от 1 до 12 месяцев' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey)

    // ── Проверяем что пользователь — owner аккаунта ──────────
    const { data: membership } = await serviceClient
      .from('account_members')
      .select('role')
      .eq('account_id', account_id)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Только владелец компании может инициировать оплату' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Создаём заказ в БД ───────────────────────────────────
    const { data: orderId, error: orderError } = await serviceClient.rpc('create_payment_order', {
      p_account_id:   account_id,
      p_user_id:      user.id,
      p_plan:         plan,
      p_months:       months,
      p_amount_som:   amount_som,
      p_discount_pct: discount_pct ?? 0,
    })

    if (orderError) throw new Error(orderError.message)

    // ── TODO: Вызов MBusiness API ────────────────────────────
    // После получения credentials от MBusiness заменить этот блок:
    //
    // const mbRes = await fetch('MBUSINESS_CREATE_PAYMENT_URL', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${Deno.env.get('MBUSINESS_SECRET_KEY')}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     merchant_id:  Deno.env.get('MBUSINESS_MERCHANT_ID'),
    //     order_id:     orderId,
    //     amount:       amount_som,
    //     currency:     'KGS',
    //     description:  `ELESTET ${plan === 'seller' ? 'Селлер' : 'Операционный'} — ${months} мес.`,
    //     return_url:   `https://elestet.net/payment/result?order_id=${orderId}`,
    //     webhook_url:  `${supabaseUrl}/functions/v1/payment-webhook`,
    //   }),
    // })
    // const mbData = await mbRes.json()
    // const paymentUrl = mbData.payment_url   // TODO: уточнить поле у MBusiness
    //
    // Сохраняем URL в заказ:
    // await serviceClient
    //   .from('payment_orders')
    //   .update({ payment_url: paymentUrl, provider_order_id: mbData.payment_id })
    //   .eq('id', orderId)

    // ЗАГЛУШКА до получения credentials MBusiness:
    const paymentUrl = `https://elestet.net/payment/result?order_id=${orderId}`

    return new Response(JSON.stringify({ order_id: orderId, payment_url: paymentUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-payment error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Внутренняя ошибка' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
