import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { handleAuthEmail } from '../supabase/functions/send-auth-email/index.ts'

function assert(value: unknown, message: string) { if (!value) throw new Error(message) }
Deno.test('Auth hook verifies signature and timestamp before any database/provider call', async () => {
  const secret = btoa('test-only-signing-secret-32-bytes!')
  Deno.env.set('SEND_EMAIL_HOOK_SECRET', `v1,whsec_${secret}`)
  Deno.env.set('RESEND_API_KEY', 'test-only')
  Deno.env.set('SUPABASE_URL', 'https://database.invalid')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only')
  const original = globalThis.fetch
  let providerCalls = 0, databaseCalls = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url === 'https://api.resend.com/emails') {
      providerCalls++
      const body = JSON.parse(init!.body as string)
      assert(body.subject === 'ELESTET — письмо №1', 'subject')
      assert(body.text.includes('123456'), 'OTP')
      return Response.json({ id: 'test-id' })
    }
    if (url.includes('database.invalid/rest/v1/rpc/')) {
      databaseCalls++
      return Response.json(url.endsWith('prepare_email_dispatch') ? { number: '1', requested_at: '2026-10-05T12:00:00Z', sent: false } : null)
    }
    throw new Error('Unexpected network request')
  }
  try {
    const payload = JSON.stringify({ user: { id: 'user1', email: 'test@example.invalid' }, email_data: { email_action_type: 'signup', token: '123456', token_hash: 'hash1' } })
    const req = (body: string, date = new Date()) => new Request('https://hook.invalid', { method: 'POST', body, headers: {
      'webhook-id': 'event-1', 'webhook-timestamp': String(Math.floor(date.getTime()/1000)),
      'webhook-signature': new Webhook(secret).sign('event-1', date, payload),
    } })
    assert((await handleAuthEmail(new Request('https://hook.invalid',{method:'POST',body:payload}))).status===401,'unsigned accepted')
    assert((await handleAuthEmail(req(payload+' '))).status===401,'tampered body accepted')
    assert((await handleAuthEmail(req(payload,new Date(Date.now()-3600_000)))).status===401,'expired signature accepted')
    assert(providerCalls===0 && databaseCalls===0,'untrusted request reached sender')
    const result=await handleAuthEmail(req(payload))
    assert(result.status===200,`signed request failed: ${await result.text()}`)
    assert(providerCalls===1 && databaseCalls===2,'signed dispatch path missing')
  } finally { globalThis.fetch = original }
})
