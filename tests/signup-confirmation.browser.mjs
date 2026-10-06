// Uses the real useAuth hook; every network call is mocked, no live users created.
import assert from 'node:assert/strict';
import { assertEmailRequestTime } from './email-code-request-assertions.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({isMobile:!!process.env.MOBILE_WIDTH,hasTouch:!!process.env.MOBILE_WIDTH,viewport:{width:Number(process.env.MOBILE_WIDTH)||1280,height:900}});
  page.setDefaultTimeout(8000);
  await page.clock.install();
  const calls = [], errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',email:'signup@example.invalid',identities:[{id:'email'}],app_metadata:{provider:'email'},user_metadata:{full_name:'Tester'}};
  const access=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');
  await page.route('**/*.supabase.co/**',async route=>{
    const path=new URL(route.request().url()).pathname, body=route.request().postDataJSON();
    calls.push({path,body,url:route.request().url()});
    let result={}, status=200;
    if(path.endsWith('/reserve_email_delivery_number')) result={number:String(calls.filter(c=>c.path.endsWith('/reserve_email_delivery_number')).length),requested_at:'2026-10-05T12:00:00Z'};
    if(path.endsWith('/signup')) result=user;
    if(path.endsWith('/token')) {status=400;result={code:'email_not_confirmed',error_code:'email_not_confirmed',msg:'Email not confirmed'};}
    if(path.endsWith('/verify')) {
      if(body.token==='123456') result={access_token:access,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user};
      else {status=403;result={code:'otp_expired',msg:'Expired or invalid'};}
    }
    if(path.endsWith('/user')) result=user;
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=auth');
  await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await page.getByLabel('Имя',{exact:true}).fill('Tester');
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel(/^Пароль/).fill('Testpass123');
  await page.getByLabel('Подтвердите пароль',{exact:true}).fill('Testpass123');
  await page.getByRole('button',{name:'Зарегистрироваться',exact:true}).click();
  await page.getByPlaceholder('Шестизначный код').waitFor();
  assert.equal(calls.find(c=>c.path.endsWith('/signup')).body.password,'testpass123');
  const initialRequest = await assertEmailRequestTime(page, calls.find(c=>c.path.endsWith('/signup')));
  assert.equal(await page.getByRole('status').count(),0,'No app session before verification');
  assert.equal(await page.getByRole('button',{name:/Отправить повторно через/}).isDisabled(),true);
  await page.getByPlaceholder('Шестизначный код').fill('999999');
  await page.getByRole('button',{name:'Подтвердить почту',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('status').count(),0);
  await page.clock.fastForward(61_000);
  await page.getByRole('button',{name:'Отправить код повторно',exact:true}).click();
  await page.getByRole('button',{name:/Отправить повторно через/}).waitFor();
  assert.equal(calls.find(c=>c.path.endsWith('/resend')).body.type,'signup');
  assert.notEqual(await assertEmailRequestTime(page, calls.find(c=>c.path.endsWith('/resend'))), initialRequest);
  // Recover the unfinished signup after closing/reloading the registration page.
  await page.reload();
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel(/^Пароль/).fill('Testpass123');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await page.getByPlaceholder('Шестизначный код').waitFor();
  await page.getByPlaceholder('Шестизначный код').fill('123456');
  await page.getByRole('button',{name:'Подтвердить почту',exact:true}).click();
  await page.getByRole('status').waitFor();
  assert.equal(await page.getByRole('status').innerText(),'Auth session established');
  assert.equal(calls.filter(c=>c.path.endsWith('/signup')).length,1);
  assert.ok(calls.filter(c=>c.path.endsWith('/verify')).every(c=>c.body.type==='signup'));
  assert.deepEqual(errors,[]);
  console.log('signup_confirmation_browser_ok: real signup hook, pending form, wrong code, resend cooldown, reload resume, verified session');
} finally {await browser.close();}
