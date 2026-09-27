import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Не авторизован' }, 401)
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Не авторизован' }, 401)

    const body = await request.json() as { accountId?: string; provider?: 'openai' | 'claude'; systemContent?: string; userContent?: unknown }
    if (!body.accountId || !body.provider) return json({ error: 'Не указана компания или провайдер' }, 400)
    const service = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: allowed } = await userClient.rpc('account_user_has_permission', { p_account_id: body.accountId, p_permission: 'reviews_ai' })
    if (!allowed) return json({ error: 'Недостаточно прав' }, 403)
    const { data: rows, error: settingsError } = await service.rpc('get_server_account_ai_settings', { p_account_id: body.accountId })
    if (settingsError) throw settingsError
    const settings = Array.isArray(rows) ? rows[0] : rows
    if (!settings) return json({ error: 'Настройки ИИ не найдены' }, 400)

    if (body.provider === 'claude') {
      if (!settings.claude_key) return json({ error: 'Claude API-ключ не настроен' }, 400)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': settings.claude_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: settings.claude_model, max_tokens: 400, system: body.systemContent ?? '', messages: [{ role: 'user', content: body.userContent ?? '' }] }),
      })
      const payload = await response.json().catch(() => ({})) as { content?: Array<{ type: string; text: string }>; error?: { message?: string } }
      if (!response.ok) return json({ error: response.status === 429 ? 'Превышен лимит Claude. Попробуйте позже.' : payload.error?.message || `Claude API error ${response.status}` }, response.status)
      return json({ text: payload.content?.find((item) => item.type === 'text')?.text?.trim() ?? '' })
    }

    if (!settings.openai_key) return json({ error: 'OpenAI API-ключ не настроен' }, 400)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openai_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: body.systemContent ?? '' }, body.userContent], max_tokens: 400, temperature: 0.7 }),
    })
    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (!response.ok) return json({ error: response.status === 429 ? 'Превышен лимит OpenAI. Попробуйте позже.' : payload.error?.message || `OpenAI API error ${response.status}` }, response.status)
    return json({ text: payload.choices?.[0]?.message?.content?.trim() ?? '' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
