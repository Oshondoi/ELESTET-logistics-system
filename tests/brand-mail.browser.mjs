import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();let requested=0,verified=0,consent=0,state={allowed:true,email:null,verified_at:null,fallback_allowed:false,pending_email:null,challenge_id:null,letter_number:null};
 await page.route('**/*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();let result=null;
  if(name==='get_brand_mail_settings')result=state;
  if(name==='set_brand_mail_fallback'){consent++;state.fallback_allowed=body.p_allowed;}
  if(name==='brand-mail'&&body.action==='request'){requested++;state.pending_email=body.email;state.challenge_id='challenge';state.letter_number='7';result={challenge_id:'challenge',number:'7'};}
  if(name==='brand-mail'&&body.action==='verify'){verified++;if(body.code!=='123456')result={ok:false,message:'Неверный код'};else{state.email=state.pending_email;state.verified_at='now';state.pending_email=null;state.challenge_id=null;result={ok:true}}}
  await route.fulfill({json:result});
 });
 await page.goto('http://localhost:5173/tests/fixtures/brand-mail.html');
 await page.getByLabel('Почта компании',{exact:true}).fill('company@example.invalid');
 const box=await page.getByRole('region',{name:'Почта бренда'}).boundingBox();
 await page.getByLabel('Почта компании',{exact:true}).press('Enter');
 await page.getByText('Письмо №7',{exact:true}).waitFor();assert.equal(requested,1);
 const after=await page.getByRole('region',{name:'Почта бренда'}).boundingBox();assert.equal(box.height,after.height);
 await page.getByLabel('Код почты компании').fill('000000');await page.getByLabel('Код почты компании').press('Enter');
 await page.getByText('Неверный код',{exact:true}).waitFor();
 await page.getByLabel('Код почты компании').fill('123456');await page.getByLabel('Код почты компании').press('Enter');
 await page.getByText('Почта подтверждена',{exact:true}).waitFor();assert.equal(verified,2);
 await page.getByRole('checkbox').click();await page.getByText('Резервная отправка разрешена',{exact:true}).waitFor();assert.equal(consent,1);assert(await page.getByRole('checkbox').isChecked());
 console.log('brand_mail_ui_ok: Enter, stable height, numbered request, verify, explicit consent');
}finally{await browser.close()}
