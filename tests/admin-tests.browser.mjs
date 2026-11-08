import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.tones=[];
  window.AudioContext=class {
   state='running';currentTime=0;destination={};
   sampleRate=48000;
   createBuffer(channels,length){return {length,getChannelData:()=>new Float32Array(length)}}
   createBufferSource(){return {connect(){},disconnect(){},start(){window.tones.push({synthesized:true,duration:this.buffer.length/48000});this.onended()}}}
   async close(){}
   createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}}}
   createOscillator(){return {frequency:{value:0,setValueAtTime(v){this.value=v},exponentialRampToValueAtTime(v){this.value=v}},connect(){},disconnect(){},start(){},stop(duration){window.tones.push({frequency:this.frequency.value,duration});this.onended()}}}
  };
 });
 await page.goto('http://127.0.0.1:5173/tests/fixtures/admin-tests.html');
 await page.getByRole('tab',{name:'Звуки скана'}).waitFor();
 const panel=page.getByRole('tabpanel');
 const desktopBounds=await panel.boundingBox();
 assert.ok(desktopBounds.width>page.viewportSize().width-50,'Tests must use the full available width');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow on mobile');
 await page.setViewportSize({width:1920,height:1080});
 const labels=await page.getByRole('button').allTextContents();
 assert.deepEqual(labels.slice(0,3).map(s=>s.trim()),['Домой','Тесты','Фин-отчет']);
 await page.getByRole('button',{name:'Удачный',exact:true}).click();
 await page.getByRole('button',{name:'Ошибка',exact:true}).click();
 const tones=await page.evaluate(()=>window.tones);
 assert.equal(tones[0].frequency,1200);
 assert.ok(Math.abs(tones[0].duration-.1)<1e-8);
 assert.deepEqual(tones[1],{synthesized:true,duration:.4});
 await page.getByRole('button',{name:'Динь',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.tones[2]),{synthesized:true,duration:.32});
 await page.getByRole('button',{name:'Пик',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.tones[3]),{frequency:2400,duration:.12});
 await page.getByRole('button',{name:'Тук',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.tones[4]),{synthesized:true,duration:.08});
 await page.getByRole('button',{name:'Плюк',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.tones[5]),{synthesized:true,duration:.16});
 await page.reload();
 await page.getByRole('tab').waitFor();
 await page.evaluate(()=>{window.AudioContext=undefined});
 await page.getByRole('button',{name:'Удачный',exact:true}).click();
 await page.getByRole('alert').waitFor();
 await page.goto('http://127.0.0.1:5173/tests/fixtures/admin-tests.html?client');
 await page.getByRole('tab').waitFor();
 assert.equal(await page.getByRole('button',{name:'Тесты',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('admin_tests_ok: navigation order, shared tones, audio failure, hidden nav');
} finally {await browser.close()}
