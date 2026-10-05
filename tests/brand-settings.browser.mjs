import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage();let settings=null, uploads=0, inquiries=[];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="blue"/></svg>';
  await page.route('**/*.supabase.co/**',async route=>{
    const req=route.request(), path=new URL(req.url()).pathname;
    if(path.includes('/storage/')&&req.method()==='POST'){if(path.includes('brand-originals'))uploads++;return route.fulfill({json:{Key:'stored'}});}
    if(path.includes('/storage/')&&req.method()==='GET')return route.fulfill({contentType:'image/svg+xml',body:svg});
    if(path.endsWith('/can_manage_company_brand'))return route.fulfill({json:true});
    if(path.endsWith('/company_brand_assets')){
      if(req.method()==='POST'){settings=req.postDataJSON();return route.fulfill({json:settings});}
      return route.fulfill({json:settings});
    }
    if(path.endsWith('/implementation_inquiries')){inquiries.push(req.postDataJSON());return route.fulfill({json:{}});}
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:5173/tests/fixtures/brand-settings.html');
  await page.getByLabel('Название бренда').fill('Компания клиента');
  await page.locator('input[type=file]').setInputFiles({name:'logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await page.getByAltText('Квадратный: предпросмотр').waitFor();
  await page.getByLabel('Квадратный: Масштаб',{exact:true}).fill('2');
  await page.getByLabel('Прямоугольный: Пропорции',{exact:true}).fill('4');
  await page.getByRole('button',{name:'Сохранить оформление'}).click();
  await page.getByText('Оригинал и настройки сохранены.',{exact:false}).waitFor();
  assert.equal(uploads,1);assert.equal(settings.square_crop.zoom,2);assert.equal(settings.rectangle_crop.aspect,4);
  const original=settings.original_path;
  await page.reload();
  await page.getByAltText('Квадратный: предпросмотр').waitFor();
  assert.equal(await page.getByLabel('Квадратный: Масштаб',{exact:true}).inputValue(),'2');
  await page.getByLabel('Квадратный: Масштаб',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Сохранить оформление'}).click();
  await page.getByText('Оригинал и настройки сохранены.',{exact:false}).waitFor();
  assert.equal(uploads,1);assert.equal(settings.original_path,original);assert.equal(settings.square_crop.zoom,3);
  await page.locator('input[type=file]').setInputFiles({name:'evil.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')});
  await page.getByText('Этот SVG содержит неподдерживаемые элементы.',{exact:false}).waitFor();
  assert.equal(uploads,1);
  await page.goto('http://localhost:5173/tests/fixtures/brand-settings.html?inquiry');
  await page.getByLabel('Описание задачи').fill('Нужно настроить склад и обучить сотрудников.');
  await page.getByRole('button',{name:'Отправить описание'}).click();
  await page.getByText('Обращение отправлено команде ELESTET.').waitFor();
  assert.equal(inquiries.length,1);assert.match(inquiries[0].description,/обучить/);assert.deepEqual(errors,[]);
  console.log('brand_settings_ok: immutable source, independent crops, reload, no repeated upload, SVG rejection, inquiry');
}finally{await browser.close();}
