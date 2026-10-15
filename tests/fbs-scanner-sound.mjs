import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../src/components/fbs/FbsKizScannerModal.tsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function signal('),source.indexOf('export function FbsKizScannerModal'));
assert.ok(body.length>100);
const js=stripTypeScriptTypes(body);
for(const success of [true,false]) {
 const calls=[];
 class AudioContext {
  state='suspended';currentTime=10;destination={};
  async resume(){calls.push('resume');this.state='running'}
  async close(){calls.push('close')}
  createGain(){return {gain:{setValueAtTime:(...args)=>calls.push(['set',...args]),linearRampToValueAtTime:(...args)=>calls.push(['ramp',...args])},connect(){},disconnect(){}}}
  createOscillator(){return {set type(v){calls.push(['type',v])},frequency:{set value(v){calls.push(['frequency',v])}},connect(){},disconnect(){},start(t){calls.push(['start',t])},stop(t){calls.push(['stop',t]);this.onended()}}}
 }
 const ctx=vm.createContext({window:{AudioContext}});
 vm.runInContext(js,ctx);
 await ctx.signal(success);
 assert.equal(calls[0],'resume');
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='type'&&c[1]==='triangle'));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='ramp'&&c[1]===0.9));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='frequency'&&c[1]===(success?1200:440)));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='stop'&&c[1]===(success?10.25:10.45)));
 assert.equal(calls.at(-1),'close');
}
const unavailable=vm.createContext({window:{}});vm.runInContext(js,unavailable);await unavailable.signal(true);
console.log('scanner_sound_ok: gain, duration, distinct tones, resume, cleanup, unavailable audio');
