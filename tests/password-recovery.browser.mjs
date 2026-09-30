// All Auth traffic mocked; no emails sent or real accounts changed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage();
  await page.clock.install();
  const calls = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const user = {id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',email:'known@example.invalid',app_metadata:{provider:'email'},user_metadata:{}};
  const access = ['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test'].join('.');
  await page.route('**/*.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    calls.push({path,body});
    let result = {}, status = 200;
    if(path.endsWith('/verify')) {
      if(body.token === '123456' && body.email === user.email) result={access_token:access,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user};
      else {status=403;result={code:'otp_expired',msg:'Token has expired or is invalid'};}
    }
    if(path.endsWith('/user')) result={user};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  async function open(email) {
    await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=auth');
    await page.getByRole('button',{name:'Забыли пароль?'}).click();
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByRole('button',{name:'Отправить код',exact:true}).click();
    await page.getByPlaceholder('Шестизначный код').waitFor();
    return page.getByText('Если аккаунт с этой почтой существует, мы отправили код.',{exact:false}).innerText();
  }
  const unknown = await open('unknown@example.invalid');
  assert.equal(await page.getByLabel('Новый пароль',{exact:true}).count(),0);
  await page.getByPlaceholder('Шестизначный код').fill('999999');
  await page.getByRole('button',{name:'Подтвердить код'}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Новый пароль',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Отправить повторно через/}).isDisabled(),true);
  await page.getByRole('button',{name:'Изменить почту'}).click();
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  assert.equal(await page.getByRole('button',{name:/Отправить код через/}).isDisabled(),true);
  await page.clock.fastForward(61_000);
  await page.getByRole('button',{name:'Отправить код',exact:true}).click();
  assert.equal(await page.getByText('Если аккаунт с этой почтой существует, мы отправили код.',{exact:false}).innerText(),unknown);
  await page.getByPlaceholder('Шестизначный код').fill('123456');
  await page.getByRole('button',{name:'Подтвердить код'}).click();
  await page.getByLabel('Новый пароль',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('auth-token') || k==='elestet-password-recovery')),false,'Recovery session must not be persisted');
  await page.getByLabel('Новый пароль',{exact:true}).fill('Newpass123');
  await page.getByLabel('Повторите пароль',{exact:true}).fill('Newpass123');
  await page.getByRole('button',{name:'Сохранить пароль'}).click();
  await page.getByRole('status').waitFor();
  assert.equal(calls.filter(c=>c.path.endsWith('/signup') || c.path.endsWith('/otp')).length,0);
  assert.ok(calls.filter(c=>c.path.endsWith('/verify')).every(c=>c.body.type==='recovery'));
  assert.equal(calls.filter(c=>c.path.endsWith('/user')).length,1);
  assert.equal(calls.filter(c=>c.path.endsWith('/logout')).length,1);
  assert.deepEqual(errors,[]);
  console.log('password_recovery_browser_ok: neutral response, no signup, cooldown, edit email, invalid/valid recovery OTP, isolated session, password save');
} finally { await browser.close(); }
