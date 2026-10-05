import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let denied=false,slow=false;
 const row={id:'r1',short_id:7,title:'Одежда',status:'accepted',applicant_company_short_id:1,executor_company_short_id:8,executor_company_name:'Первый исполнитель',created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T01:00:00Z'};
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();
  if(name==='get_client_request_tracking'){
   if(slow)await new Promise(r=>setTimeout(r,600));
   if(denied)return route.fulfill({status:403,json:{message:'Нет доступа к заявкам компании'}});
   return route.fulfill({json:{...row,synced_at:row.updated_at,work_started_at:null,history_allowed:false,documents_allowed:true,history:[],batches:[{id:'p1',short_id:5,owner_short_id:1,name:'Партия одежды',store_name:'Магазин',status:'active',stages:[{id:'s1',order_index:1,company_short_id:8,company_name:row.executor_company_name,step:'otk',status:'active',activated_at:row.created_at,completed_at:null,confirmed_at:row.updated_at,items:[{barcode:'123',name:'Кофта',declared:4,received:3,defect:null,otk:null,marked:null,packed:null}]}],documents:[{id:'d1',kind:'acceptance_act',revision:1,status:'issued',issued_at:row.updated_at,accepted_quantity:3}]}]}});
  }
  let rows=body.p_account==='b'?[]:[row,{...row,id:'r2',short_id:8,title:'Обувь',executor_company_short_id:9,executor_company_name:'Второй исполнитель'}];
  if(body.p_search)rows=rows.filter(r=>r.title.includes(body.p_search)||`R-${r.short_id}`===body.p_search);
  await route.fulfill({json:{rows,total:rows.length,synced_at:row.updated_at}});
 });
 await page.goto('http://localhost:5173/tests/fixtures/client-tracking.html');
 await page.getByRole('button',{name:/R-7/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/R-8/}).count(),1);
 await page.getByLabel('Поиск заявок').fill('R-7');await page.waitForFunction(()=>!document.body.textContent.includes('Второй исполнитель'));
 await page.getByRole('button',{name:/R-7/}).click();await page.getByText('Кофта',{exact:true}).waitFor();
 await page.getByText('Нет права просмотра истории заявок.',{exact:true}).waitFor();
 await page.locator('summary').click();await page.getByText('Принято: 3 шт.',{exact:true}).waitFor();
 assert.equal(await page.getByText(/PRIVATE WAREHOUSE/).count(),0);
 await page.getByText(/Последний подтверждённый результат: 06.10.2026, 07:00/).waitFor();
 // Permission revocation must clear details, not leave stale protected data.
 denied=true;await page.getByRole('button',{name:'Обновить',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByText('Кофта',{exact:true}).count(),0);
 denied=false;await page.getByRole('button',{name:'К списку заявок'}).click();await page.getByRole('button',{name:/R-7/}).waitFor();
 slow=true;await page.getByRole('button',{name:/R-7/}).click();await page.getByRole('button',{name:'К списку заявок'}).click();
 await page.waitForTimeout(800);assert.equal(await page.getByText('Кофта',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Сменить компанию'}).click();await page.getByText('Заявок пока нет',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/R-7/}).count(),0);
 await context.setOffline(true);await page.getByText(/Нет соединения/).waitFor();await context.setOffline(false);
 await page.getByRole('button',{name:'Сменить компанию'}).click();await page.getByRole('button',{name:/R-7/}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 assert.deepEqual(errors,[]);console.log('client_tracking_ui_ok: search, multiple executors, detail, documents, permissions, stale responses, account switch, offline, mobile');
}finally{await browser.close()}
