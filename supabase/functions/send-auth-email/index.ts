import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { authLetters, type AuthEmailPayload } from '../_shared/auth-letters.ts'
import { sendNumberedLetter } from '../_shared/numbered-email.ts'

// JWT verification is disabled for Auth hooks. The Standard Webhooks signature is mandatory instead.
export async function handleAuthEmail(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !apiKey || !url || !key) return new Response('Email service unavailable', { status: 503 })
  const raw = await req.text()
  if (raw.length > 100_000) return new Response('Payload too large', { status: 413 })
  let payload: AuthEmailPayload
  try {
    payload = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(raw, Object.fromEntries(req.headers)) as AuthEmailPayload
  } catch {
    return new Response('Invalid signature', { status: 401 })
  }
  try {
    const letters = await authLetters(payload, req.headers.get('webhook-id')!)
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    for (const letter of letters) {
      let replyTo: string | undefined
      if (letter.reservation) {
        const route = await client.rpc('resolve_auth_mail_route', {p_email:letter.to,p_number:letter.reservation.number,p_time:letter.reservation.requested_at})
        if (route.error || !route.data?.allowed) throw new Error('Brand mail unavailable')
        replyTo=route.data.reply_to??undefined
      }
      await sendNumberedLetter(letter, { rpc: async (name, args) => await client.rpc(name, args), apiKey, fetch, replyTo })
    }
    return Response.json({})
  } catch {
    // Never expose an OTP, address, provider response or service key in logs or HTTP errors.
    return Response.json({ error: { http_code: 503, message: 'Не удалось отправить код. Попробуйте позже.' } }, { status: 503 })
  }
}
if (import.meta.main) Deno.serve(handleAuthEmail)
