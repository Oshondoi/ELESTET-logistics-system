// Mocked APIs only. Exercises Enter, fixed geometry, loading and long errors on desktop/mobile.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const viewport of [{width:1280,height:900},{width:360,height:740}]) {
    const page = await browser.newPage({viewport});
    let verifications=0, sends=0;
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*.supabase.co/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      let data=[],status=200;
      if(path.endsWith('/get_service_request_invite')) data={is_available:true,state:'active',invite_id:'11111111-1111-4111-8111-111111111111',executor_account_id:'33333333-3333-4333-8333-333333333333',executor_short_id:3,executor_name:'Executor',expires_at:'2099-01-01T00:00:00Z'};
      else if(path.endsWith('/reserve_email_delivery_number')) {
        await new Promise(resolve=>setTimeout(resolve,300));
        data={number:'1234567890123456789',requested_at:'2026-10-05T12:00:00Z'};
      }
      else if(path.endsWith('/otp')) { sends++;data={}; }
      else if(path.endsWith('/verify')) { verifications++;status=400;data={error_code:'otp_expired',msg:'Неверный код. '.repeat(30)}; }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://localhost:5173/tests/fixtures/request-workflow.html?scenario=invite');
    const card=page.getByTestId('invite-auth-card');
    await card.waitFor();
    const initial=await card.boundingBox();
    await page.getByPlaceholder('Имя',{exact:true}).fill('Тест');
    await page.getByPlaceholder('Почта',{exact:true}).fill('fixture@example.invalid');
    await page.getByPlaceholder('Почта',{exact:true}).press('Enter');
    await page.getByRole('button',{name:'Отправка…',exact:true}).waitFor();
    assert.deepEqual(await card.boundingBox(),initial,'sending must not resize/reposition card');
    await page.getByPlaceholder('Шестизначный код').waitFor();
    assert.deepEqual(await card.boundingBox(),initial,'code state must not resize/reposition card');
    assert.equal(sends,1);
    const input=page.getByPlaceholder('Шестизначный код');
    const box=await input.boundingBox();
    await input.fill('123456');
    await input.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(verifications,1);
    assert.deepEqual(await input.boundingBox(),box,'error must not move input');
    assert.deepEqual(await card.boundingBox(),initial,'error must not change card');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('invite-auth-layout: desktop/mobile Enter and stable geometry passed');
} finally { await browser.close(); }
