import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:Number(process.env.MOBILE_WIDTH)||1280,height:900}});
 let completed=false,finishCalls=0; const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('elestet_fbs_scanner_profile_v1',JSON.stringify({deviceName:'Test device'})));
 const session=()=>({id:'session',status:completed?'completed':'partial',device_id:'test',device_name:'Test device',device_named:true,device_identity_required:true,box_scan_enabled:false,barcode_scan_enabled:false,scanner_test_status:'untested',started_at:new Date().toISOString()});
 await page.route('**/src/lib/authSession.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export async function ensureAuthenticatedSession(){return {}}'}));
 await page.route('**/src/services/fbsApi.ts*',r=>r.fulfill({contentType:'application/javascript',body:"export async function invokeFbs(store,body){if(body.action!=='get_scan_catalog')throw Error('Unexpected WB write');return {catalog:[],missing:0}}"}));
 await page.route('**/*.supabase.co/**',async route=>{
  const url=new URL(route.request().url());let result=[];
  if(/start_fbs_marking_session|configure_fbs_marking_device|apply_fbs_marking_preferences/.test(url.pathname))result=session();
  else if(url.pathname.endsWith('/fbs_marking_sessions'))result=url.searchParams.has('id')&&url.searchParams.get('id').startsWith('eq.')?session():[];
  else if(url.pathname.endsWith('/fbs_marking_pairs'))result=[{id:'pair',order_id:'1',wb_qr:'qr',sgtin:'test',status:'sent',product_snapshot:{},created_at:new Date().toISOString()}];
  else if(url.pathname.endsWith('/complete_resolved_fbs_marking_session')){finishCalls++;completed=true;result={sent:1};}
  else if(url.pathname.endsWith('/get_fbs_marking_session_receipt'))result={format:'elestet-marking-receipt-v1',events:[]};
  else if(url.pathname.endsWith('/fbs_marking_box_info'))result=null;
  await route.fulfill({json:result});
 });
 await page.goto('http://127.0.0.1:5173/tests/fixtures/fbs-marking-finish.html');
 await page.getByRole('button',{name:'Завершить сессию',exact:true}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('elestet:scan-success',{detail:{kind:'fbs',primary:'0911',details:['partA 5903062']}})));
 const overlay=page.getByRole('status');
 await overlay.waitFor();
 const box=await overlay.boundingBox(),viewport=page.viewportSize();
 assert.equal(box.x,0);assert.equal(box.width,viewport.width);
 assert.ok(Math.abs(box.height-viewport.height*0.45)<1);
 assert.ok(Math.abs(box.y+box.height-viewport.height)<1);
 assert.equal(await overlay.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
 await page.getByRole('button',{name:'Завершить сессию',exact:true}).click();
 await page.getByText('Сессия завершена без повторной отправки в WB. Отправленные КИЗ и история сохранены.',{exact:true}).waitFor({timeout:5000}).catch(async e=>{console.log(await page.locator('body').innerText(),errors,finishCalls);throw e});
 assert.equal(finishCalls,1);
 assert.equal(await page.getByRole('button',{name:'Завершить сессию',exact:true}).count(),0);
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Скачать историю',exact:true}).click();
 const download=await downloadPromise;
 assert.match(download.suggestedFilename(),/ELESTET-scanning-history-session.json/);
 assert.deepEqual(errors,[]);
 console.log('fbs_finish_without_wb_resend_and_receipt_ok');
} finally {await browser.close();}
