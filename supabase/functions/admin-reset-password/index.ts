/**
 * admin-reset-password — сброс пароля пользователя администратором.
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

function err(message: string, status = 200) {
  return new Response(JSON.stringify({ error: message }), {
    status,
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

  // 2. Читаем тело запроса
  let body: { userId?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return err('Неверный формат запроса')
  }

  const { userId, newPassword } = body
  if (!userId || typeof userId !== 'string') return err('userId обязателен')
  if (!newPassword || typeof newPassword !== 'string') return err('newPassword обязателен')
  if (newPassword.length < 6) return err('Пароль должен быть не менее 6 символов')

  // 3. Меняем пароль через service role
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
    password: newPassword,
  })

  if (updateErr) return err(updateErr.message)

  return ok({ success: true })
})
