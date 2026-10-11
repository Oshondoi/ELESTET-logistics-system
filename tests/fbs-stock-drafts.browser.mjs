import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();let catalogReads=0;
 await page.route('**/*.supabase.co/**',async route=>{
  const catalog=route.request().url().includes('get_fbs_stock_catalog_for_warehouse');
  if(catalog)catalogReads++;
  await route.fulfill({json:catalog?[{product_id:'p',nm_id:1,chrt_id:123,barcode:'test',tech_size:'48',product_name:'Test product',physical_quantity:10,available_quantity:10,reserved_quantity:11,awaiting_quantity:0,unassigned_quantity:0}]:[]});
 });
 // Do not authenticate, send stock updates, or contact real WB during this test.
 await page.route('**/src/services/fbsApi.ts*',r=>r.fulfill({contentType:'application/javascript',body:"export async function invokeFbs(store,body){if(body.action!=='get_stocks')throw Error('Unexpected write');return {stocks:[{chrtId:123,amount:9}]}}"}));
 await page.goto('http://127.0.0.1:5173/tests/fixtures/fbs-stock-drafts.html');
 const amount=page.locator('input[aria-label]');
 await amount.waitFor();
 const apply=()=>page.getByRole('button',{name:'Подставить из ELESTET',exact:true}).click();
 const save=page.getByRole('button',{name:/^Сохранить в WB/});
 await apply();assert.equal(await amount.inputValue(),'10');
 const reads=catalogReads;
 for(let i=0;i<5;i++)await page.locator('#background').click();
 assert.equal(await amount.inputValue(),'10');assert.equal(await save.isEnabled(),true);
 assert.equal(catalogReads,reads,'background render must not reload stock');
 await amount.fill('17');await page.locator('#background').click();
 assert.equal(await amount.inputValue(),'17','manual edit also survives');
 for(const selector of ['#wb','#source','#store']){
  await page.locator(selector).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label]')?.value==='9');
  assert.equal(await save.isDisabled(),true,'scope change clears drafts');
  assert.equal(await page.locator('select').inputValue(),'all');
  await apply();assert.equal(await amount.inputValue(),'10');
 }
 await page.getByRole('button',{name:'Обновить из WB',exact:true}).click();
 await page.locator('select').selectOption('all');
 await page.waitForFunction(()=>document.querySelector('input[aria-label]')?.value==='9');
 assert.equal(await save.isDisabled(),true,'explicit refresh still resets drafts');
 console.log('fbs_stock_drafts_passed: background updates preserve applied/manual edits; real scope changes and explicit refresh reset');
}finally{await browser.close()}
