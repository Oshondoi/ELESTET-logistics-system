import assert from 'node:assert/strict';
export async function assertEmailRequestTime(page, call) {
  const redirect = new URL(call.url).searchParams.get('redirect_to') || call.body.redirect_to;
  assert.match(redirect, /^https:\/\/elestet\.net\/auth-email\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\/[1-9][0-9]*$/);
  const label = `Откройте письмо №${redirect.split('/').at(-1)} от ELESTET`;
  assert.ok((await page.getByTestId('email-code-request-hint').innerText()).includes(label));
  return redirect;
}
