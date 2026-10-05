import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const timezoneId of ['Asia/Bishkek','America/New_York','Asia/Tokyo']){
  const page=await browser.newPage({timezoneId});let serverNow='2026-10-15T17:59:00Z',lastArgs;
  await page.route('**/*.supabase.co/**',async route=>{
   const name=new URL(route.request().url()).pathname.split('/').at(-1);let result;
   if(name==='get_company_checkout_state')result={server_now:serverNow,balance_som:0,cycle:{changes:1,original_paid_at:'2026-10-14T18:00:00Z'},orders:[]};
   else{lastArgs=route.request().postDataJSON();result={available:false,due_som:3000,wallet_som:0,external_som:3000,starts_at:'2026-10-15T18:00:00Z',ends_at:'2026-10-31T18:00:00Z'}}
   await route.fulfill({json:result});
  });
  const open=async()=>{await page.goto('http://localhost:5173/tests/fixtures/calendar-checkout.html');await page.getByText(/Баланс компании/).waitFor()};
  await open();assert.equal(await page.getByRole('checkbox',{name:/Начать завтра/}).count(),0);
  serverNow='2026-10-15T18:00:00Z';await open();await page.getByRole('checkbox',{name:/Начать завтра/}).check();
  await page.getByRole('button',{name:'Рассчитать на сервере'}).click();assert.equal(lastArgs.p_tomorrow,true);
  await page.getByText(/Период: 16.10.2026, 00:00 — 01.11.2026, 00:00/).waitFor();
  await page.getByText(/Окно смены заканчивается 17.10.2026, 00:00/).waitFor();
  await page.getByLabel('Действие оплаты').selectOption('renew');assert.equal(await page.getByRole('checkbox',{name:/Начать завтра/}).count(),0);
  await page.getByLabel('Действие оплаты').selectOption('brand');await page.getByRole('checkbox',{name:/Начать завтра/}).waitFor();
  serverNow='2026-10-31T17:59:58Z';await open();await page.getByRole('checkbox',{name:/Начать завтра/}).check();
  await page.getByRole('checkbox',{name:/Начать завтра/}).waitFor({state:'detached',timeout:5000});
  await page.getByRole('button',{name:'Рассчитать на сервере'}).click();assert.equal(lastArgs.p_tomorrow,false);
  await page.close();
 }
 console.log('billing_timezone_ui_ok: Bishkek midnight, 15/16 and month boundaries, tomorrow hidden/reset, 48h, three device zones');
}finally{await browser.close()}
