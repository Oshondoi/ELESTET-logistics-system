// Whole App regression: mock all backend calls; never create live users/data.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({isMobile:!!process.env.MOBILE_WIDTH,hasTouch:!!process.env.MOBILE_WIDTH,viewport:{width:Number(process.env.MOBILE_WIDTH)||1280,height:900}});
  page.setDefaultTimeout(15000);
  const calls=[], errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  const id='11111111-1111-4111-8111-111111111111';
  const token='44444444-4444-4444-8444-444444444444';
  const executor='33333333-3333-4333-8333-333333333333';
  const user={id,aud:'authenticated',email:'invite@example.invalid',app_metadata:{provider:'email'},user_metadata:{full_name:'Tester',registration_source:'request_invite'}};
  const access=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');
  let submitted=false;
  await page.route('**/*.supabase.co/**',async route=>{
    const path=new URL(route.request().url()).pathname, body=route.request().postDataJSON();
    calls.push({path,body});
    let result=[];
    if(path.endsWith('/get_service_request_invite')) result={is_available:true,state:'active',invite_id:id,token,executor_account_id:executor,executor_short_id:3,executor_name:'Executor',expires_at:'2099-01-01T00:00:00Z'};
    else if(path.endsWith('/reserve_email_delivery_number')||path.endsWith('/reserve_invite_email_number')) result={number:'1',sender_name:'Server sender fixture',requested_at:'2026-10-06T00:00:00Z'};
    else if(path.endsWith('/otp')) result={};
    else if(path.endsWith('/verify')) result={access_token:access,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user};
    else if(path.endsWith('/user')) result=user;
    else if(path.endsWith('/reserve_service_request_invite')) result={ok:true};
    else if(path.endsWith('/open_my_request_reserve')) result={};
    else if(path.endsWith('/search_executor_accounts')) result=[{id:'55555555-5555-4555-8555-555555555555',short_id:5,name:'Other executor'}];
    else if(path.endsWith('/submit_service_request_invite_reserve')) {submitted=true;result={account_id:id};}
    else if(path.endsWith('/get_my_accounts')) {
      await new Promise(resolve=>setTimeout(resolve,250));
      result=submitted?[{id,name:'Applicant',short_id:155,my_role:'owner'}]:[];
    }
    if(process.env.RECOVERY_FLOW&&path.endsWith('/get_service_request_invite'))result={...result,reserved_email:user.email};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://localhost:5173/request-invite/'+token);
  if(!process.env.RECOVERY_FLOW)await page.getByPlaceholder('Имя',{exact:true}).fill('Tester');
  if(!process.env.RECOVERY_FLOW)await page.getByPlaceholder('Почта',{exact:true}).fill(user.email);
  if(process.env.RECOVERY_FLOW){
    await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();
    await page.getByRole('button',{name:'Отправить код',exact:true}).click();
    await page.getByPlaceholder('Шестизначный код').fill('123456');
    await page.getByRole('button',{name:'Подтвердить код',exact:true}).click();
    await page.getByLabel('Новый пароль',{exact:true}).fill('Testpass123');
    await page.getByLabel('Повторите пароль',{exact:true}).fill('Testpass123');
    await page.getByRole('button',{name:'Сохранить пароль',exact:true}).click();
    await page.getByText('Пароль обновлён.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Войти в систему',exact:true}).click();
    assert.ok(page.url().includes('/request-invite/'+token));
    assert.equal(calls.filter(c=>c.path.endsWith('/otp')||c.path.endsWith('/token')).length,0);
  }else{
  await page.getByRole('button',{name:'Получить код на почту',exact:true}).click();
  await page.getByPlaceholder('Шестизначный код').waitFor().catch(async error => { console.error(await page.locator('body').innerText(),calls); throw error; });
  await page.getByPlaceholder('Шестизначный код').fill('123456');
  await page.getByText('Откройте письмо №1 от Server sender fixture',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Проверить код',exact:true}).click();
  await page.getByPlaceholder('Новый пароль аккаунта').fill('Testpass123');
  await page.getByPlaceholder('Повторите пароль').fill('Testpass123');
  await page.getByRole('button',{name:'Сохранить пароль и продолжить',exact:true}).click();
  }
  await page.getByRole('heading',{name:'Новая заявка',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Компания',{exact:true}).count(),0,'no editable company in invite form');
  const executorPicker=page.getByRole('button',{name:'Исполнитель',exact:true});
  assert.ok((await executorPicker.innerText()).includes('C-3'));
  await executorPicker.click();
  await page.getByText('Работали вместе',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Поиск исполнителя'}).fill('C-5');
  await page.getByRole('button',{name:'C-5 · Other executor',exact:true}).click();
  assert.ok((await executorPicker.innerText()).includes('C-5'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'request form horizontal overflow');
  await page.getByRole('button',{name:'Подтвердить заявку',exact:true}).waitFor({state:'visible'});
  const scroll=page.getByTestId('request-invite-scroll');
  assert.equal(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight),true,'long form must have scroll range');
  await scroll.evaluate(el=>el.scrollTop=0);
  await page.mouse.move(20,200);
  await page.mouse.wheel(0,600);
  await page.waitForFunction(()=>document.querySelector('[data-testid="request-invite-scroll"]').scrollTop>0);
  await page.getByRole('button',{name:'Подтвердить заявку',exact:true}).scrollIntoViewIfNeeded();
  const bottom=await page.getByRole('button',{name:'Подтвердить заявку',exact:true}).boundingBox();
  assert.ok(bottom.y>=0&&bottom.y+bottom.height<=900,'submit reachable inside viewport');
  assert.equal(calls.filter(c=>c.path.endsWith('/create_account_with_owner')).length,0);
  if(!process.env.RECOVERY_FLOW)assert.equal(await page.evaluate(()=>localStorage.getItem('elestet-pending-request-invite')),token);
  await page.getByPlaceholder('Название магазина').fill('Test store');
  await page.getByRole('button',{name:'Подтвердить заявку',exact:true}).click();
  await page.waitForURL('**/client-request');
  assert.equal(calls.filter(c=>c.path.endsWith('/submit_service_request_invite_reserve')).length,1);
  assert.equal(calls.find(c=>c.path.endsWith('/submit_service_request_invite_reserve')).body.p_executor_account_id,'55555555-5555-4555-8555-555555555555');
  assert.equal(calls.filter(c=>c.path.endsWith('/create_account_with_owner')).length,0);
  assert.equal(await page.getByText('Активируйте бесплатный период на 10 дней',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('invite_app_auth_ok: real App, OTP, password, reserve, first submit; no premature company/trial');
} finally {await browser.close();}
