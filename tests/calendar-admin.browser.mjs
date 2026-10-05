import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(),calls=[];
 const account='11111111-1111-4111-8111-111111111111';let first=true;
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();calls.push({name,body});
  if(name==='admin_adjust_calendar_balance'&&first){first=false;return route.fulfill({status:500,json:{message:'Повторите запрос'}})}
  let result=null;
  if(name==='admin_calendar_billing')result={config:{checkout_enabled:false,provider_enabled:false,timezone:null},orders:[],companies:Array.from({length:50},(_,i)=>({id:i?`company-${i}`:account,short_id:i+1,name:'Test',balance_som:100}))};
  if(name==='admin_calendar_billing_detail')result={entries:[],audit:[]};
  await route.fulfill({json:result});
 });
 await page.goto('http://localhost:5173/tests/fixtures/calendar-admin.html');
 await page.getByLabel('Компания для баланса').selectOption(account);
 await page.getByLabel('Сумма корректировки').fill('100');
 await page.getByLabel('Причина корректировки').fill('Сверка тестового платежа');
 page.on('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Сохранить корректировку',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Повторите запрос'}).waitFor();
 await page.getByRole('button',{name:'Сохранить корректировку',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Сумма корректировки"]').value==='');
 const adjustments=calls.filter(c=>c.name==='admin_adjust_calendar_balance');
 assert.equal(adjustments.length,2);assert.equal(adjustments[0].body.p_id,adjustments[1].body.p_id);
 await page.getByLabel('Поиск компании или заказа').fill('C-8');
 await page.getByRole('button',{name:'Найти / обновить'}).click();
 await page.waitForTimeout(100);
 await page.getByRole('button',{name:'Далее',exact:true}).click();
 await page.waitForTimeout(100);
 assert(calls.some(c=>c.name==='admin_calendar_billing'&&c.body.p_search==='C-8'&&c.body.p_offset===50));
 assert(!calls.some(c=>c.name==='settle_company_checkout'));
 console.log('calendar_admin_ui_ok: idempotent retry, filtered pagination, no implicit settlement');
}finally{await browser.close()}
