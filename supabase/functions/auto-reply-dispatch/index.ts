/**
 * auto-reply-dispatch — диспетчер запуска авто-ответов.
 *
 * Вызывается pg_cron каждые 30 минут.
 * Находит все аккаунты с is_enabled=true и для каждого
 * вызывает auto-reply независимо (fire-and-forget).
 * Каждый аккаунт живёт в своём таймауте — никто никого не блокирует.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const db = getDb()

    // Находим все активные аккаунты
    const { data: allSettings, error } = await db
      .from('automation_settings')
      .select('account_id')
      .eq('is_enabled', true)

    if (error) throw new Error(`DB error: ${error.message}`)

    const accountIds = (allSettings ?? []).map((s: { account_id: string }) => s.account_id)

    if (accountIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, dispatched: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Вызываем auto-reply для каждого аккаунта параллельно (fire-and-forget)
    // Не ждём ответа — каждый живёт в своём таймауте
    for (const accountId of accountIds) {
      fetch(`${SUPABASE_URL}/functions/v1/auto-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ account_id: accountId }),
      }).catch(() => { /* fire-and-forget */ })
    }

    return new Response(
      JSON.stringify({ ok: true, dispatched: accountIds.length, account_ids: accountIds }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
