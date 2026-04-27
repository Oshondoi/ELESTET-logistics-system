/**
 * auto-reply — серверная автоматизация ответов на отзывы WB
 *
 * Запускается через pg_cron каждые 30 минут (или вручную через HTTP).
 * Для каждого account с is_enabled=true:
 *   1. Синхронизирует отзывы с WB (для каждого выбранного магазина)
 *   2. Фильтрует подходящие по критериям
 *   3. Генерирует ответы через ИИ
 *   4. Отправляет ответы на WB (с паузой delay_seconds между каждым)
 *   5. Пишет лог в automation_logs
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WB_FB_BASE = 'https://feedbacks-api.wildberries.ru'
const PRE_POST_DELAY_MS = 15_000  // 15 сек до и после каждой отправки

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Supabase service-role client (bypasses RLS) ───────────────────
function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// ── WB: получить отзывы ───────────────────────────────────────────
async function fetchWbFeedbacks(apiKey: string, isAnswered: boolean) {
  const resp = await fetch(
    `${WB_FB_BASE}/api/v1/feedbacks?isAnswered=${isAnswered}&take=100&skip=0`,
    { headers: { Authorization: apiKey } },
  )
  if (!resp.ok) {
    if (resp.status === 429) throw new Error(`WB 429: rate limit`)
    if (resp.status === 401 || resp.status === 403) throw new Error(`WB ${resp.status}: invalid API key`)
    throw new Error(`WB API ${resp.status}`)
  }
  type Resp = { data?: { feedbacks?: unknown[]; countUnanswered?: number } }
  const json = (await resp.json()) as Resp
  return {
    feedbacks: (json?.data?.feedbacks ?? []) as Record<string, unknown>[],
    countUnanswered: json?.data?.countUnanswered ?? 0,
  }
}

// ── WB: отправить ответ ───────────────────────────────────────────
async function sendWbReply(apiKey: string, feedbackId: string, text: string): Promise<void> {
  const endpoints = [
    `${WB_FB_BASE}/api/v1/feedbacks/answer`,
    `${WB_FB_BASE}/api/v1/feedbacks`,
  ]
  for (const url of endpoints) {
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: feedbackId, text }),
    })
    if (resp.ok) return
    if (resp.status === 405) continue
    const detail = await resp.text().catch(() => '')
    throw new Error(`WB send error ${resp.status}: ${detail}`)
  }
  throw new Error('WB: all send endpoints failed')
}

// ── ИИ: построить промпт ──────────────────────────────────────────
interface AiSettings {
  provider: string
  openai_key: string
  claude_key: string
  model: string
  claude_model: string
  tone: string
  system_prompt: string | null
}

interface Feedback {
  id: string
  text?: string | null
  productValuation: number
  userName?: string | null
  productDetails?: { productName?: string } | null
}

function buildPrompt(settings: AiSettings, feedback: Feedback, extraSystem: string[], extraStore: string[]): { system: string; user: string } {
  const toneMap: Record<string, string> = {
    polite: 'вежливым и профессиональным',
    neutral: 'нейтральным и деловым',
    friendly: 'дружелюбным и тёплым',
    professional: 'строго профессиональным и формальным',
  }

  const baseSystem = settings.system_prompt?.trim() ||
    `Ты — специалист по работе с клиентами интернет-магазина на маркетплейсе Wildberries.\nПиши ответы на отзывы покупателей на русском языке.\nБудь ${toneMap[settings.tone] ?? 'вежливым и профессиональным'}.\nОтвет должен быть кратким (2–4 предложения), конкретным, без шаблонных фраз.\nНе используй смайлы и восклицательные знаки. Обращайся на «Вы».`

  const allSystem = [baseSystem, ...extraSystem].filter(Boolean).join('\n\n')
  const allStore = extraStore.filter(Boolean).join('\n\n')
  const system = allStore ? `${allSystem}\n\n${allStore}` : allSystem

  const parts = [`Оценка: ${feedback.productValuation}/5`]
  if (feedback.productDetails?.productName) parts.push(`Товар: ${feedback.productDetails.productName}`)
  if (feedback.userName) parts.push(`Покупатель: ${feedback.userName}`)
  parts.push('')
  parts.push(`Текст отзыва: ${feedback.text?.trim() || 'Без текста (только оценка)'}`)
  parts.push('')
  parts.push('Напиши ответ продавца:')

  return { system, user: parts.join('\n') }
}

// ── ИИ: вызов OpenAI ─────────────────────────────────────────────
async function callOpenAi(settings: AiSettings, feedback: Feedback, extraSystem: string[], extraStore: string[]): Promise<string> {
  const { system, user } = buildPrompt(settings, feedback, extraSystem, extraStore)
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.openai_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 400,
      temperature: 0.7,
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`OpenAI ${resp.status}: ${err.error?.message ?? ''}`)
  }
  type OAI = { choices: { message: { content: string } }[] }
  const json = await resp.json() as OAI
  return json.choices[0]?.message?.content?.trim() ?? ''
}

// ── ИИ: вызов Claude ─────────────────────────────────────────────
async function callClaude(settings: AiSettings, feedback: Feedback, extraSystem: string[], extraStore: string[]): Promise<string> {
  const { system, user } = buildPrompt(settings, feedback, extraSystem, extraStore)
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.claude_key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.claude_model || 'claude-3-haiku-20240307',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Claude ${resp.status}: ${err.error?.message ?? ''}`)
  }
  type Claude = { content: { type: string; text: string }[] }
  const json = await resp.json() as Claude
  return json.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
}

// ── Генерация ответа ──────────────────────────────────────────────
async function generateReply(
  settings: AiSettings,
  feedback: Feedback,
  extraSystem: string[],
  extraStore: string[],
): Promise<string> {
  if (settings.provider === 'claude') {
    if (!settings.claude_key) throw new Error('Claude API key not set')
    return callClaude(settings, feedback, extraSystem, extraStore)
  }
  if (!settings.openai_key) throw new Error('OpenAI API key not set')
  return callOpenAi(settings, feedback, extraSystem, extraStore)
}

// ── Основная логика для одного account ───────────────────────────
interface AutoSettings {
  account_id: string
  source: string
  daily_limit: number
  target_ratings: number[]
  require_text: boolean
  delay_seconds: number
  store_ids: string[]
  daily_sent_count: number
  daily_reset_date: string | null
}

async function runForAccount(settings: AutoSettings, log: string[]): Promise<number> {
  const db = getDb()
  let sent = 0
  const today = new Date().toISOString().slice(0, 10)

  // Сброс дневного счётчика если новый день
  let dailySent = settings.daily_sent_count
  if (!settings.daily_reset_date || settings.daily_reset_date < today) {
    dailySent = 0
    await db.from('automation_settings').update({ daily_sent_count: 0, daily_reset_date: today }).eq('account_id', settings.account_id)
  }

  // Проверяем лимит
  const remaining = settings.daily_limit === 0 ? Infinity : settings.daily_limit - dailySent
  if (remaining <= 0) {
    log.push('Дневной лимит исчерпан.')
    return 0
  }

  // Загружаем AI настройки
  const { data: aiData } = await db.from('account_ai_settings').select('*').eq('account_id', settings.account_id).single()
  if (!aiData) {
    log.push('ИИ не настроен для этого аккаунта.')
    return 0
  }
  const aiSettings = aiData as AiSettings

  // Загружаем системные промпты
  const { data: sysPrompts } = await db.from('ai_prompts').select('content').eq('account_id', settings.account_id).eq('type', 'system').order('sort_order')
  const extraSystem = (sysPrompts ?? []).map((p: { content: string }) => p.content).filter(Boolean)

  // Загружаем магазины
  const { data: storesData } = await db.from('stores').select('id, api_key, ai_prompt').in('id', settings.store_ids)
  const stores = (storesData ?? []) as { id: string; api_key: string | null; api_prompt?: string | null }[]

  log.push(`Магазинов: ${stores.length}. Оставшийся лимит: ${remaining === Infinity ? '∞' : remaining}`)

  // Для каждого магазина
  for (const store of stores) {
    if (!store.api_key) {
      log.push(`[${store.id}] нет API-ключа — пропуск`)
      continue
    }

    // Загружаем store prompts
    const { data: storePromptsData } = await db.from('ai_prompts').select('content').eq('account_id', settings.account_id).eq('type', 'store').eq('store_id', store.id).order('sort_order')
    const extraStore = [
      (store as { id: string; api_key: string | null; ai_prompt?: string | null }).ai_prompt,
      ...((storePromptsData ?? []).map((p: { content: string }) => p.content)),
    ].filter(Boolean) as string[]

    // Синхронизируем отзывы с WB
    try {
      log.push(`[${store.id}] синхронизация...`)
      const { feedbacks: unanswered } = await fetchWbFeedbacks(store.api_key, false)
      const { feedbacks: answered } = await fetchWbFeedbacks(store.api_key, true)

      // Upsert в wb_feedbacks
      const allFeedbacks = [
        ...unanswered.map((fb) => ({ ...fb, _isAnswered: false })),
        ...answered.map((fb) => ({ ...fb, _isAnswered: true })),
      ]
      if (allFeedbacks.length > 0) {
        await db.from('wb_feedbacks').upsert(
          allFeedbacks.map((fb) => ({
            id: fb['id'],
            store_id: store.id,
            account_id: settings.account_id,
            data: fb as Record<string, unknown>,
            is_answered: fb['_isAnswered'],
            created_date: fb['createdDate'] ?? null,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: 'id' },
        )
      }
      log.push(`[${store.id}] синхронизировано ${unanswered.length} без ответа, ${answered.length} отвечено`)
    } catch (e) {
      log.push(`[${store.id}] ошибка синхронизации: ${(e as Error).message}`)
      continue
    }

    // Загружаем необработанные отзывы из DB
    const { data: rows } = await db
      .from('wb_feedbacks')
      .select('id, data, ai_reply_status')
      .eq('store_id', store.id)
      .eq('is_answered', false)
      .in('ai_reply_status', ['none', 'generated'])

    const candidates = ((rows ?? []) as { id: string; data: Record<string, unknown>; ai_reply_status: string }[])
      .filter((row) => {
        const d = row.data
        const rating = d['productValuation'] as number
        if (!settings.target_ratings.includes(rating)) return false
        if (settings.require_text && !((d['text'] as string | undefined)?.trim())) return false
        return true
      })
      .slice(0, remaining === Infinity ? undefined : Math.max(0, (remaining as number) - sent))

    log.push(`[${store.id}] кандидатов: ${candidates.length}`)

    for (const row of candidates) {
      if (sent >= (remaining === Infinity ? Infinity : (remaining as number))) break

      const feedback = row.data as unknown as Feedback
      feedback.id = row.id

      try {
        // Пауза ДО (минимум PRE_POST_DELAY_MS)
        await sleep(Math.max(PRE_POST_DELAY_MS, settings.delay_seconds * 1000 / 2))

        // Генерация ответа
        let replyText = ''
        if (settings.source === 'ai' || settings.source === 'ai_with_fallback') {
          try {
            replyText = await generateReply(aiSettings, feedback, extraSystem, extraStore)
          } catch (e) {
            if (settings.source === 'ai_with_fallback') {
              // Fallback на шаблоны
              const { data: templates } = await db.from('review_templates').select('*').eq('account_id', settings.account_id)
              const tpl = (templates ?? []).find(() => true) // берём первый подходящий
              if (tpl) {
                replyText = (tpl as { content: string }).content
              } else {
                log.push(`[${row.id}] ИИ ошибка + нет шаблонов: ${(e as Error).message}`)
                continue
              }
            } else {
              log.push(`[${row.id}] ИИ ошибка: ${(e as Error).message}`)
              continue
            }
          }
        } else {
          // source === 'templates'
          const { data: templates } = await db.from('review_templates').select('*').eq('account_id', settings.account_id)
          const tpl = (templates ?? []).find(() => true)
          if (!tpl) {
            log.push(`[${row.id}] нет шаблонов`)
            continue
          }
          replyText = (tpl as { content: string }).content
        }

        if (!replyText.trim()) {
          log.push(`[${row.id}] пустой ответ — пропуск`)
          continue
        }

        // Пауза ПОСЛЕ (оставшаяся часть delay)
        await sleep(Math.max(PRE_POST_DELAY_MS, settings.delay_seconds * 1000 / 2))

        // Отправляем на WB
        await sendWbReply(store.api_key, row.id, replyText)

        // Обновляем запись в DB
        await db.from('wb_feedbacks').update({
          is_answered: true,
          ai_reply: replyText,
          ai_reply_status: 'sent',
          reply_sent_at: new Date().toISOString(),
        }).eq('id', row.id)

        sent++
        log.push(`[${row.id}] ✓ отправлено (${sent}/${remaining === Infinity ? '∞' : remaining})`)

        // Обновляем счётчик в DB
        await db.from('automation_settings').update({
          daily_sent_count: dailySent + sent,
        }).eq('account_id', settings.account_id)

      } catch (e) {
        log.push(`[${row.id}] ошибка: ${(e as Error).message}`)
      }
    }
  }

  return sent
}

// ── HTTP handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const log: string[] = []
  const startedAt = new Date().toISOString()
  log.push(`Запуск: ${startedAt}`)

  try {
    const db = getDb()

    // Загружаем все активные настройки автоматизации
    const { data: allSettings, error } = await db
      .from('automation_settings')
      .select('*')
      .eq('is_enabled', true)

    if (error) throw new Error(`DB read error: ${error.message}`)
    if (!allSettings || allSettings.length === 0) {
      log.push('Нет активных автоматизаций.')
      return new Response(JSON.stringify({ ok: true, log }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    log.push(`Активных аккаунтов: ${allSettings.length}`)

    const results: { account_id: string; sent: number; error?: string }[] = []

    for (const settings of allSettings as AutoSettings[]) {
      const accountLog: string[] = []
      let sent = 0
      let accountError: string | undefined

      try {
        if (!settings.store_ids || settings.store_ids.length === 0) {
          accountLog.push('Нет выбранных магазинов.')
        } else {
          sent = await runForAccount(settings, accountLog)
        }
      } catch (e) {
        accountError = (e as Error).message
        accountLog.push(`ОШИБКА: ${accountError}`)
      }

      // Пишем лог
      await db.from('automation_logs').insert({
        account_id: settings.account_id,
        run_at: startedAt,
        sent_count: sent,
        log: accountLog,
        error: accountError ?? null,
      })

      // Обновляем last_run_at и last_log
      await db.from('automation_settings').update({
        last_run_at: startedAt,
        last_log: accountLog.slice(-20), // последние 20 строк
      }).eq('account_id', settings.account_id)

      results.push({ account_id: settings.account_id, sent, error: accountError })
      log.push(...accountLog.map((l) => `[${settings.account_id.slice(0, 8)}] ${l}`))
    }

    return new Response(JSON.stringify({ ok: true, results, log }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    log.push(`FATAL: ${(e as Error).message}`)
    return new Response(JSON.stringify({ ok: false, log, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
