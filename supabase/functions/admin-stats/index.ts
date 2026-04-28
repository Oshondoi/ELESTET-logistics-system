/**
 * admin-stats — статистика пользователей для владельца проекта.
 * Доступно только для sydykovsam@gmail.com.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ADMIN_EMAIL = 'sydykovsam@gmail.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // 1. Проверяем токен вызывающего
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Не авторизован')

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return err('Не авторизован')
  if (user.email !== ADMIN_EMAIL) return err('Нет доступа')

  // 2. Используем service role для чтения всех данных
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Все пользователи из auth.users
  const { data: authUsers, error: authErr } = await db.auth.admin.listUsers({ perPage: 500 })
  if (authErr) return err(`auth.users: ${authErr.message}`)

  // Все аккаунты (компании)
  const { data: accounts, error: accErr } = await db
    .from('accounts')
    .select('id, name, created_at')
  if (accErr) return err(`accounts: ${accErr.message}`)

  // Все участники аккаунтов (user_id → account_id)
  const { data: members, error: memErr } = await db
    .from('account_members')
    .select('user_id, account_id')
  if (memErr) return err(`account_members: ${memErr.message}`)

  // Все магазины
  const { data: stores, error: storeErr } = await db
    .from('stores')
    .select('id, account_id, name, marketplace')
  if (storeErr) return err(`stores: ${storeErr.message}`)

  // Профили (short_id для сортировки U1, U2...)
  const { data: profiles } = await db
    .from('profiles')
    .select('user_id, short_id')

  // Строим статистику по каждому пользователю
  const users = authUsers.users.map((u) => {
    const userAccountIds = (members ?? [])
      .filter((m) => m.user_id === u.id)
      .map((m) => m.account_id)
    const userAccounts = (accounts ?? []).filter((a) => userAccountIds.includes(a.id))
    const userStores = (stores ?? []).filter((s) => userAccountIds.includes(s.account_id))
    const short_id = (profiles ?? []).find((p) => p.user_id === u.id)?.short_id ?? null
    return {
      id: u.id,
      email: u.email ?? '—',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      companies: userAccounts.length,
      stores: userStores.length,
      company_names: userAccounts.map((a) => a.name),
      short_id,
    }
  })

  // Сортируем по short_id (U1, U2...), пользователи без профиля — в конце
  users.sort((a, b) => {
    if (a.short_id === null && b.short_id === null) return 0
    if (a.short_id === null) return 1
    if (b.short_id === null) return -1
    return a.short_id - b.short_id
  })

  return ok({
    total_users: users.length,
    total_companies: (accounts ?? []).length,
    total_stores: (stores ?? []).length,
    users,
  })
})
