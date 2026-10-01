// Exercise the real App/router, not the isolated invitation component.
// All Supabase calls are mocked; no emails or live data changes.
import assert from 'node:assert/strict';
import { assertEmailRequestTime } from './email-code-request-assertions.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.TEST_BASE_URL || 'http://localhost:5173';
const token = '44444444-4444-4444-8444-444444444444';
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let available = true;
let otpRequests = 0;
let lastOtpRequest;
await context.route('**/*.supabase.co/**', async route => {
  const path = new URL(route.request().url()).pathname;
  let result = [];
  if (path.endsWith('/otp')) { otpRequests += 1; result = {}; lastOtpRequest = { url: route.request().url(), body: route.request().postDataJSON() }; }
  if (path.endsWith('/get_service_request_invite')) result = available
    ? { is_available: true, state: 'available', token, executor_account_id: token, executor_short_id: 3, executor_name: 'Executor', expires_at: '2099-01-01T00:00:00Z' }
    : { is_available: false, state: 'expired', unavailable_reason: 'Срок действия ссылки истёк' };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
});
try {
  for (const suffix of ['', '/', '?source=test']) {
    await page.goto(`${base}/request-invite/${token}${suffix}`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Имя', { exact: true }).waitFor();
    await page.getByPlaceholder('Почта', { exact: true }).waitFor();
    assert.ok(new URL(page.url()).pathname.startsWith(`/request-invite/${token}`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Получить код на почту', exact: true }).waitFor();
    assert.ok(new URL(page.url()).pathname.startsWith(`/request-invite/${token}`));
    // A previously selected protected page must not take over the invite URL.
    await page.evaluate(() => localStorage.setItem('elestet-active-page', 'fulfillment'));
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const name = page.getByPlaceholder('Имя', { exact: true });
    const email = page.getByPlaceholder('Почта', { exact: true });
    await name.waitFor();
    const before = await name.boundingBox();
    await email.press('Enter');
    await page.getByText('Укажите имя и почту', { exact: true }).waitFor();
    const after = await name.boundingBox();
    assert.equal(after.y, before.y, 'Error must not move inputs');
    const previousRequests = otpRequests;
    await name.fill('Tester');
    await email.fill('fixture@example.invalid');
    await email.press('Enter');
    await page.getByPlaceholder('Шестизначный код').waitFor();
    assert.equal(otpRequests, previousRequests + 1, 'Enter sends exactly one OTP request');
    await assertEmailRequestTime(page, lastOtpRequest);
  }
  available = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Срок действия ссылки истёк', { exact: true }).waitFor();
  assert.ok(new URL(page.url()).pathname.startsWith(`/request-invite/${token}`));
  for (const path of ['/', '/fulfillment', '/stores', '/admin', '/my-requests', '/client-request']) {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Имя', { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('public_invite_routing_ok: real App, invite/reload/expired and protected routes');
} finally {
  await browser.close();
}
