// All backend calls mocked. No real deletion, emails or account creation.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:850}}),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const id='11111111-1111-4111-8111-111111111111';
  let blocked=false,fail=false,confirmMode='stale',removed=false;
  const makePreview=()=>({invite_id:id,fingerprint:'current',can_delete:!blocked,already_deleted:false,
   groups:[{table:'service_requests',label:'Заявки',count:1,items:[{id:'request-id',number:'12',name:'Тестовая заявка',status:'submitted'}]}],
   effects:[{table:'wms_movements',label:'История перемещений',count:1,message:'Связь будет снята',items:[{id:'movement-id'}]}],
   blockers:blocked?[{table:'wms_cell_items',label:'Товары в складских ячейках',count:1,message:'Сначала освободите ячейку штатным способом',items:[{id:'cell-item'}]}]:[],
   preserved:['Аккаунт, подтверждённая почта и пароль','Компания, её сотрудники, роли, настройки и подписка'],notice:'Удаление необратимо.'});
  await page.route('**/*.supabase.co/**',async route=>{
   const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();calls.push({name,body});
   if(name==='admin_list_service_request_invites')return route.fulfill({json:removed?[]:[{id,token:id,state:'active',expires_at:'2099-01-01',executor_name:'Исполнитель',request_count:1,batch_count:1}]});
   if(name==='admin_preview_invite_deletion') {
    if(fail)return route.fulfill({status:500,json:{message:'internal SQL error'}});
    return route.fulfill({json:makePreview()});
   }
   if(name==='admin_confirm_invite_deletion'){
    await new Promise(r=>setTimeout(r,150));
    assert.equal(body.p_fingerprint,'current');
    if(confirmMode==='network')return route.abort('failed');
    if(confirmMode==='stale')return route.fulfill({json:{ok:false,code:'PREVIEW_CHANGED',message:'Данные изменились. Проверьте обновлённый состав.',preview:makePreview()}});
    removed=true;return route.fulfill({json:{ok:true}});
   }
   throw Error('Unexpected RPC '+name);
  });
  await page.goto('http://localhost:5173/tests/fixtures/invite-delete.html');
  await page.getByRole('button',{name:'Удалить данные ссылки',exact:true}).click();
  const dialog=page.getByRole('dialog'),remove=page.getByRole('button',{name:'Удалить перечисленные данные'}),check=dialog.getByRole('checkbox');
  await dialog.getByText('Будет удалено',{exact:true}).waitFor();
  const rect=await dialog.boundingBox();assert.ok(rect.width<=width&&rect.x>=0,'Dialog fits viewport');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'No horizontal dialog overflow');
  assert.equal(calls.filter(c=>c.name==='admin_confirm_invite_deletion').length,0);
  assert.equal(await remove.isDisabled(),true);
  await dialog.getByText('Заявки: 1',{exact:true}).click();await dialog.getByText('ID: request-id',{exact:true}).waitFor();
  await check.check();await remove.click();
  await dialog.getByRole('alert').filter({hasText:'Данные изменились'}).waitFor();
  assert.equal(await check.isChecked(),false);assert.equal(await remove.isDisabled(),true);
  blocked=true;await dialog.getByRole('button',{name:'Обновить состав'}).click();
  await dialog.getByText('Почему нельзя удалить',{exact:true}).waitFor();assert.equal(await remove.isDisabled(),true);
  fail=true;await dialog.getByRole('button',{name:'Обновить состав'}).click();
  await dialog.getByRole('alert').filter({hasText:'Не удалось проверить состав'}).waitFor();assert.equal(await remove.isDisabled(),true);
  assert.equal(await dialog.getByText('internal SQL error').count(),0);
  fail=false;blocked=false;confirmMode='network';await dialog.getByRole('button',{name:'Обновить состав'}).click();
  await check.check();await remove.click();await dialog.getByRole('alert').filter({hasText:'операция могла завершиться'}).waitFor();
  assert.equal(await remove.isDisabled(),true);
  confirmMode='ok';await dialog.getByRole('button',{name:'Обновить состав'}).click();await check.check();await remove.click();
  await dialog.waitFor({state:'detached'});
  assert.equal(calls.some(c=>c.name==='admin_delete_service_request_invite_data'),false);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('invite_delete_ui_ok: desktop/mobile inventory, explicit consent, blockers, stale snapshot, failure, retry');
} finally {await browser.close()}
