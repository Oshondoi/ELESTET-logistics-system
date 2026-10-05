import assert from 'node:assert/strict'
import { authLetters } from '../supabase/functions/_shared/auth-letters.ts'
import { renderLetter, reservationFromRedirect, sendNumberedLetter } from '../supabase/functions/_shared/numbered-email.ts'

const payload = { user: { id: 'user1', email: 'TEST@example.com' }, email_data: { email_action_type: 'signup', token: '012345', token_hash: 'hash1', redirect_to: 'https://elestet.net/auth-email/2026-10-05T12:00:00Z/3' } }
const [letter] = await authLetters(payload, 'event1')
assert.equal(letter.to, 'test@example.com')
assert.equal(letter.reservation?.number, '3')
assert.equal((await authLetters(payload, 'event1'))[0].eventKey, letter.eventKey)
assert.notEqual((await authLetters(payload, 'event2'))[0].eventKey, letter.eventKey, 'explicit resend even if Auth reuses OTP')
assert.equal(reservationFromRedirect('https://evil.test/auth-email/2026-10-05T12:00:00Z/3'), undefined)
const rendered = renderLetter(letter, '3', '2026-10-05T12:00:00Z')
assert.equal(rendered.subject, 'ELESTET — письмо №3')
assert.ok(!rendered.subject.includes('012345'))
assert.ok(rendered.html.includes('font-size:36px') && rendered.html.includes('font-size:22px'))
assert.ok(rendered.html.includes('012345'))
assert.ok(renderLetter({ ...letter, heading: '<script>bad</script>' }, '3', '2026-10-05T12:00:00Z').html.includes('&lt;script&gt;'))
await assert.rejects(authLetters({ ...payload, email_data: { ...payload.email_data, token: 'bad' } }, 'e1'))
await assert.rejects(authLetters(payload, ''))
const secure = await authLetters({ ...payload, user: { ...payload.user, new_email: 'new@example.com' }, email_data: { ...payload.email_data, email_action_type: 'email_change', token_new: '654321', token_hash_new: 'oldHash' } }, 'change1')
assert.deepEqual(secure.map(l => [l.to, l.code]), [['test@example.com','012345'],['new@example.com','654321']])
assert.notEqual(secure[0].eventKey, secure[1].eventKey)
const single = await authLetters({ ...payload, user: { ...payload.user, new_email: 'new@example.com' }, email_data: { ...payload.email_data, email_action_type: 'email_change' } }, 'change2')
assert.equal(single.length, 1)
assert.equal(single[0].to, 'new@example.com')
const [notification] = await authLetters({ ...payload, email_data: { email_action_type: 'password_changed_notification' } }, 'notification1')
assert.equal(notification.code, undefined)
let sends = 0
let complete = false
let sent = false
const requests: string[] = []
const rpc = async (name: string) => {
  if (name === 'complete_email_dispatch') { complete = true; sent = true; return { data: null, error: null } }
  return { data: { number: '3', requested_at: '2026-10-05T12:00:00Z', sent }, error: null }
}
const provider = (async (_url: unknown, init: RequestInit) => {
  sends++
  assert.equal((init.headers as Record<string,string>)['Idempotency-Key'], `letter/${letter.eventKey}`)
  requests.push(init.body as string)
  return Response.json({ id: 'provider-id' })
}) as typeof fetch
await sendNumberedLetter(letter, { rpc, apiKey: 'test-only', fetch: provider })
assert.ok(complete)
await sendNumberedLetter(letter, { rpc, apiKey: 'test-only', fetch: provider })
assert.equal(sends, 1, 'completed delivery must not resend')
sent = false
await sendNumberedLetter(letter, { rpc, apiKey: 'test-only', fetch: provider })
assert.equal(requests[0], requests[1], 'retry payload is deterministic for provider idempotency')
complete = false; sent = false
await assert.rejects(sendNumberedLetter(letter, { rpc, apiKey: 'test-only', fetch: (async () => new Response('failed', { status: 429 })) as typeof fetch }))
assert.equal(complete, false)
console.log('numbered-email: passed')
