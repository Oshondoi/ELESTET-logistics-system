// All services mocked: no DNS, email or real domain writes.
import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[],calls=[];let rows=[],stale=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),p=route.request().postDataJSON();calls.push(name);
  if(name==='admin_list_company_domains')return route.fulfill({json:{domains:rows,companies:[{id:'company',name:'Client',short_id:8}]}});
  if(name==='admin_save_company_domain'){
   if(stale)return route.fulfill({status:400,json:{message:'Запись изменена другим администратором. Обновите список и откройте её заново.'}});
   assert.equal(p.p_account_id,'company');assert.equal(p.p_hostname,'wms.client.kg');
   rows=[{id:'domain',account_id:p.p_account_id,hostname:p.p_hostname,source:p.p_source,registration_expires_on:p.p_expires_on,registrar:p.p_registrar,site_state:p.p_site_state,mail_state:p.p_mail_state,notes:p.p_notes,version:1,company_name:'Client',company_short_id:8}];return route.fulfill({json:rows[0]});
  }
  if(name==='admin_company_domain_history')return route.fulfill({json:[{id:1,created_at:'2026-10-06T00:00:00Z',actor_id:'admin',previous:null,next:rows[0]}]});
  throw Error('Unexpected request '+name);
 });
 await page.goto('http://localhost:5173/tests/fixtures/company-domains.html');
 await page.getByText('Домены пока не добавлены.').waitFor();
 await page.getByRole('button',{name:'Добавить домен'}).click();
 await page.getByLabel('Компания',{exact:true}).selectOption('company');
 await page.getByPlaceholder('wms.client.kg').fill('wms.client.kg');
 await page.getByLabel('Сайт',{exact:true}).selectOption('awaiting_dns');
 await page.getByRole('button',{name:'Сохранить карточку'}).click();
 await page.getByRole('heading',{name:'wms.client.kg',exact:true}).waitFor();
 await page.getByRole('button',{name:'История изменений'}).click();
 await page.getByRole('heading',{name:'История — последние 100 изменений'}).waitFor();
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 assert.equal(await page.getByPlaceholder('wms.client.kg').isDisabled(),true);
 stale=true;await page.getByRole('button',{name:'Сохранить карточку'}).click();
 await page.getByRole('status').filter({hasText:'Запись изменена другим администратором'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Редактирование домена'}).count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);assert.equal(calls.filter(x=>x==='admin_save_company_domain').length,2);
 await page.close();
}console.log('company_domains_ui_ok: desktop/mobile, create, immutable identity, audit, stale edit, no external provisioning');}finally{await browser.close()}
