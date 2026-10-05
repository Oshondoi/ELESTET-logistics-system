import assert from 'node:assert/strict';
import {pathToFileURL}from'node:url';
const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.clock.install();let expired=false;
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.includes('/storage/'))return route.fulfill({status:404});
  if(!path.endsWith('/resolve_company_brand'))return route.fulfill({json:[]});
  const id=req.postDataJSON().p_account_id;
  await route.fulfill({json:expired?null:{name:id==='a'?'Alpha':'Beta',title:id==='a'?'Alpha portal':'Beta portal',square_path:id+'/square.png',rectangle_path:id+'/rectangle.png',expires_at:new Date(Date.now()+3600000).toISOString()}});
 });
 await page.goto('http://localhost:5173/tests/fixtures/brand-runtime.html');
 await page.waitForFunction(()=>document.title==='Alpha portal');
 assert.match(await page.locator('link[rel=icon]').getAttribute('href'),/a\/square.png/);
 await page.getByRole('button',{name:'B',exact:true}).click();
 await page.waitForFunction(()=>document.title==='Beta portal');
 assert.equal(await page.getByTestId('brand').innerText(),'Beta');
 await page.getByText('Beta',{exact:true}).first().waitFor();
 expired=true;await page.clock.fastForward(61000);
 await page.waitForFunction(()=>document.title==='ELESTET Logistics');
 assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/favicon.svg');
 expired=false;await page.getByRole('button',{name:'A',exact:true}).click();
 await page.waitForFunction(()=>document.title==='Alpha portal');
 await page.getByRole('button',{name:'General',exact:true}).click();
 await page.waitForFunction(()=>document.title==='ELESTET Logistics');
 console.log('brand_runtime_ok: company isolation, titles/favicon, broken image fallback, revocation, general context reset');
}finally{await browser.close()}
