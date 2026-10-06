import assert from'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({isMobile:!!process.env.MOBILE_WIDTH,hasTouch:!!process.env.MOBILE_WIDTH,viewport:{width:Number(process.env.MOBILE_WIDTH)||1280,height:900}});const calls=[];let orders=[],blocked=true;
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();calls.push({name,body});
  let result={};
  if(name==='get_company_checkout_state')result={balance_som:5000,cycle:null,orders};
  if(name==='quote_company_checkout')result={available:!blocked,reason:blocked?'Внешняя оплата ожидает подключения Finik':null,due_som:2000,credit_som:0,balance_som:5000,wallet_som:body.p_use_balance?2000:0,external_som:body.p_use_balance?0:2000};
  if(name==='create_company_checkout'){orders=[{id:body.p_order,target_plan:'seller',status:'pending',due_som:2000,wallet_som:2000,external_som:0,credit_som:0}];result=orders[0]}
  if(name==='settle_company_checkout'){orders[0].status='paid';result=orders[0]}
  await route.fulfill({json:result});
 });
 await page.goto('http://localhost:5173/tests/fixtures/calendar-checkout.html');
 await page.getByRole('button',{name:'Рассчитать на сервере'}).click();
 await page.getByText('Внешняя оплата ожидает подключения Finik',{exact:true}).waitFor();
 assert.equal(calls.find(c=>c.name==='quote_company_checkout').body.p_use_balance,false);
 assert.equal(await page.getByRole('button',{name:/Создать заказ/}).count(),0);
 blocked=false;
 await page.getByRole('checkbox',{name:/Использовать баланс/}).check();
 await page.getByRole('button',{name:'Рассчитать на сервере'}).click();
 await page.getByRole('button',{name:/Создать заказ/}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'checkout horizontal overflow');
 await page.getByRole('button',{name:'Подтвердить оплату / смену'}).click();
 await page.waitForFunction(()=>window.refreshed===true);
 assert.equal(calls.filter(c=>c.name==='create_company_checkout').length,1);
 assert.equal(calls.find(c=>c.name==='create_company_checkout').body.p_expected_quote.wallet_som,2000);
 assert.equal(calls.find(c=>c.name==='settle_company_checkout').body.p_amount,0);
 console.log('calendar_checkout_ui_ok: opt-in balance, unavailable provider, server quote, order confirmation');
}finally{await browser.close()}
