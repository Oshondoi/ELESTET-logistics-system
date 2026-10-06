// Mocked API only. No real employee, payment or company changes.
import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of[1280,390,320]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];
 let staff=[],projects=[],stale=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),p=route.request().postDataJSON();calls.push(name);
  if(name==='admin_implementation_overview')return route.fulfill({json:{staff,projects}});
  if(name==='admin_set_implementation_staff'){
   assert.equal(p.p_short_id,22);staff=[{user_id:'worker',short_id:22,full_name:'Специалист',active:p.p_active,eligible:p.p_eligible}];return route.fulfill({json:null});
  }
  if(name==='admin_assign_implementation'){
   assert.equal(p.p_user,'worker');if(stale)return route.fulfill({status:400,json:{message:'Данные изменились. Обновите список'}});
   projects[0].assignments=p.p_assign?[{user_id:'worker',short_id:22,full_name:'Специалист'}]:[];projects[0].version++;return route.fulfill({json:null});
  }
  if(name==='admin_transition_implementation'){
   projects[0].status=p.p_action==='start'?'active':'completed';projects[0].version++;return route.fulfill({json:null});
  }
  if(name==='admin_implementation_history')return route.fulfill({json:[{id:1,event:'started',actor_id:'boss',created_at:'2026-10-06T12:00:00Z',details:{}}]});
  throw Error('Unexpected RPC '+name);
 });
 await page.goto('http://localhost:5173/tests/fixtures/implementation-access.html');
 await page.getByText('Сотрудники пока не добавлены.').waitFor();
 assert.equal(await page.getByRole('button',{name:'Запустить внедрение'}).count(),0);
 await page.getByLabel('User ID сотрудника').fill('U-22');await page.getByRole('button',{name:'Добавить с допуском'}).click();
 await page.getByText('U-22 · Специалист · Допущен',{exact:true}).waitFor();
 projects=[{id:'p',company_name:'Компания',company_short_id:8,status:'paid',version:0,paid_som:90000,assignments:[]}];
 await page.getByRole('button',{name:'Обновить доступы'}).click();
 await page.getByLabel('Специалист C-8').selectOption('worker');
 stale=true;await page.getByRole('button',{name:'Назначить',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Данные изменились'}).waitFor();
 assert.equal(projects[0].assignments.length,0);
 stale=false;await page.getByRole('button',{name:'Назначить',exact:true}).click();await page.getByRole('button',{name:'Снять назначение'}).waitFor();
 await page.getByRole('button',{name:'Запустить внедрение'}).click();await page.getByRole('button',{name:'Завершить внедрение'}).waitFor();
 await page.getByRole('button',{name:'Завершить внедрение'}).click();await page.getByText('Завершено · 90 000 сом').waitFor();
 assert.equal(await page.getByRole('button',{name:'Назначить',exact:true}).count(),0);
 await page.getByRole('button',{name:'История внедрения'}).click();await page.getByText('Внедрение запущено',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Исключить из команды'}).click();await page.getByText('U-22 · Специалист · Отключён',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 assert.equal(calls.some(n=>n==='register_implementation_payment'),false);await page.close();
}console.log('implementation_ui_ok: 1280/390/320, staff, eligible list, stale assignment, launch/finish, history, no payment mutation');}finally{await browser.close()}
