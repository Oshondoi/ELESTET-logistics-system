import assert from 'node:assert/strict';
export async function assertEmailRequestTime(page, call) {
  const redirect = new URL(call.url).searchParams.get('redirect_to') || call.body.redirect_to;
  assert.match(redirect, /^https:\/\/elestet\.net\/auth-email\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const stamp = redirect.split('/').at(-1);
  const label = `${stamp.slice(8,10)}.${stamp.slice(5,7)}.${stamp.slice(0,4)}, ${stamp.slice(11,19)} UTC`;
  assert.ok((await page.getByTestId('email-code-request-hint').innerText()).includes(label));
  return redirect;
}
