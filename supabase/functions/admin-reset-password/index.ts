/**
 * admin-reset-password — сброс пароля пользователя администратором.
 * Доступно только для sydykovsam@gmail.com.
 * Без внешних импортов: функция должна отвечать на CORS preflight даже при проблемах CDN.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ADMIN_EMAIL = 'sydykovsam@gmail.com'
const PASSWORD_PATTERN = /^(?=.*\d)[A-Za-z\d]{6,}$/
const PASSWORD_ERROR = 'Пароль: минимум 6 символов, только буквы и цифры, хотя бы 1 цифра.'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('Метод не поддерживается', 405)

  // 1. Проверяем токен вызывающего
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Не авторизован', 401)
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  })
  if (!userResponse.ok) return err('Сессия истекла. Войдите в систему снова.', 401)
  const user = await userResponse.json() as { email?: string }
  if (user.email?.toLowerCase() !== ADMIN_EMAIL) return err('Нет доступа', 403)

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
  if (!PASSWORD_PATTERN.test(newPassword)) return err(PASSWORD_ERROR)
  const normalizedPassword = newPassword.toLowerCase()

  // 3. Меняем пароль через service role
  const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: normalizedPassword }),
  })
  if (!updateResponse.ok) {
    console.error('admin password reset failed', updateResponse.status, await updateResponse.text())
    return err('Не удалось изменить пароль пользователя. Повторите попытку.', 502)
  }

  return ok({ success: true })
})
