// Run with PLAYWRIGHT_MODULE pointing to playwright/index.mjs. No live API writes:
// every Supabase request is intercepted with deterministic fixture responses.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
page.setDefaultTimeout(8000);
page.setDefaultNavigationTimeout(15000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const account='11111111-1111-4111-8111-111111111111';
const executor='33333333-3333-4333-8333-333333333333';
let rows=[]; let calls=[]; let saved={};
await page.route('**/*.supabase.co/**',async route=>{
  const url=new URL(route.request().url());
  const body=route.request().postDataJSON();
  calls.push({path:url.pathname,body});
  let result=[];
  if(url.pathname.endsWith('/service_requests')) result=rows;
  else if(url.pathname.endsWith('/list_recent_request_executors')||url.pathname.endsWith('/search_executor_accounts')) result=[{id:executor,short_id:3,name:'Executor'}];
  else if(url.pathname.endsWith('/create_service_request_from_form')) { rows=[{id:account,short_id:91,status:'draft',current_version:0,title:body.p_title,applicant_account_id:account,executor_account_id:executor,executor_company_name:'Executor',executor_company_short_id:3,applicant_name:'Tester',applicant_email:'fixture@example.invalid',stores:[],created_at:new Date().toISOString()}]; result=rows[0]; }
  else if(url.pathname.endsWith('/open_service_request_work_draft')) result=saved;
  else if(url.pathname.endsWith('/save_service_request_work_draft')) { saved=body.p_draft; result={ok:true}; }
  else if(url.pathname.endsWith('/reassign_rejected_service_request')) { rows=[{...rows[0],status:'submitted',executor_account_id:body.p_executor_account_id}]; result={ok:true}; }
  else if(url.pathname.endsWith('/get_service_request_invite')) result={is_available:true,state:'reserved',invite_id:account,token:'44444444-4444-4444-8444-444444444444',executor_account_id:executor,executor_short_id:3,executor_name:'Executor',reserved_email:'fixture@example.invalid',reserved_name:'Tester',expires_at:'2099-01-01T00:00:00Z'};
  else if(url.pathname.endsWith('/otp')) result={};
  else if(url.pathname.endsWith('/products')) result=[{id:account,name:'Test shirt',vendor_code:'ART-1',barcodes:['12345678'],sizes:[]}];
  else if(url.pathname.endsWith('/fulfillment_step_versions')) result=[{id:account,version:2,confirmed_at:'2026-09-30T01:00:00Z',snapshot:{items:[{id:account,name:'Confirmed shirt',barcode:'123',declared:7,received:6,defect:0}],logs:[],supplies:[]}}];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
});
try {
  await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html');
  await page.getByRole('button',{name:'+ Новая заявка',exact:true}).click();
  assert.equal(calls.filter(c=>c.path.endsWith('/create_service_request_from_form')).length,0,'Opening modal must not create R');
  assert.match(await page.getByLabel('Отправитель',{exact:true}).inputValue(),/C-1/);
  assert.equal(await page.getByLabel('Отправитель',{exact:true}).getAttribute('readonly'),'');
  await page.getByRole('button',{name:'C-3 · Executor',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить заявку',exact:true}).click();
  await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();
  assert.equal(calls.filter(c=>c.path.endsWith('/create_service_request_from_form')).length,1);
  await page.getByRole('button',{name:'Редактировать',exact:true}).click();
  await page.getByLabel('Название',{exact:true}).fill('Durable close');
  await page.getByRole('button',{name:'×',exact:true}).click();
  await page.getByRole('button',{name:'Редактировать',exact:true}).waitFor();
  assert.equal(saved.title,'Durable close','Closing must flush pending debounce');
  rows=[{...rows[0],status:'rejected',current_version:2,executor_account_id:'55555555-5555-4555-8555-555555555555'}];
  await page.reload();
  await page.getByRole('button',{name:'Другой исполнитель',exact:true}).click();
  await page.getByPlaceholder('Название компании или C-ID').fill('new');
  // Search result is a different executor from the rejected request fixture.
  await page.getByPlaceholder('Название компании или C-ID').fill('new executor');
  await page.getByRole('button',{name:'C-3 · Executor',exact:true}).click();
  await page.getByRole('button',{name:'Подтвердить и отправить',exact:true}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Исполнитель заявки R-91'));
  assert.equal(calls.filter(c=>c.path.endsWith('/reassign_rejected_service_request')).length,1);
  await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=intake');
  await page.getByPlaceholder('Поиск товара по названию или артикулу').fill('shirt');
  await page.getByRole('button',{name:'+ 12345678',exact:true}).click();
  await page.getByPlaceholder('Сканер / ТСД: штрихкод + Enter').fill('12345678');
  await page.getByPlaceholder('Сканер / ТСД: штрихкод + Enter').press('Enter');
  assert.match(await page.locator('textarea').inputValue(),/12345678; Test shirt; 2; ART-1/);
  await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=invite');
  await page.getByRole('button',{name:'Забыли пароль',exact:false}).click();
  await page.getByPlaceholder('Шестизначный код').waitFor();
  assert.equal(calls.filter(c=>c.path.endsWith('/recover')).length,0);
  assert.equal(calls.findLast(c=>c.path.endsWith('/otp')).body.create_user,false);
  await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=history');
  await page.getByText('Версия 2',{exact:false}).waitFor();
  assert.match(await page.locator('body').innerText(),/Confirmed shirt/);
  assert.deepEqual(errors,[]);
  console.log('request_workflow_browser_ok: modal lifecycle, save flush, reassignment, catalog/HID, recovery OTP, confirmed journal');
} catch (error) {
  console.error(JSON.stringify({errors,url:page.url(),body:await page.locator('body').innerText({timeout:1000}).catch(()=>'<body unavailable>')}));
  throw error;
} finally { await browser.close(); }
