// Mocked registry only; no real user data or writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*.supabase.co/**',route=>{
  assert.ok(route.request().url().endsWith('/admin_list_service_request_invites_v2'));
  return route.fulfill({json:['bound_pending','expired','bound'].map((state,i)=>({id:String(i),token:String(i),state,executor_name:'Executor',applicant_name:'Applicant',applicant_short_id:20+i,email_confirmed:true,reserved_email:'confirmed@example.invalid',auth_created_at:'2026-10-01T00:00:00Z',company_created_at:'2026-10-02T00:00:00Z',expires_at:i===2?'infinity':'2026-10-10T00:00:00Z',ended_at:i===1?'2026-10-10T00:00:00Z':null,end_reason:i===1?'Срок действия ссылки истёк':null,is_available:i!==1,request_count:0,batch_count:0}))});
 });
 await page.goto('http://localhost:5173/tests/fixtures/invite-delete.html');
 await page.getByRole('cell').filter({hasText:'Привязана · до первой заявки'}).waitFor();
 assert.equal(await page.getByRole('cell').filter({hasText:/^Бессрочно/}).count(),1);
 assert.equal(await page.getByRole('cell').filter({hasText:'Подтверждена'}).count(),3);
 assert.equal(await page.getByRole('button',{name:'Ссылка недоступна'}).isDisabled(),true);
 await page.getByRole('cell').filter({hasText:'Срок действия ссылки истёк'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('invite_registry_ui_ok: finite/permanent states, confirmed account, terminal reason, unavailable copy');
} finally {await browser.close()}
