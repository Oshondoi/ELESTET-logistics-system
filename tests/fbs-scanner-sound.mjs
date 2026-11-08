import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../src/lib/scannerSound.ts',import.meta.url),'utf8');
const body=source.replace('export async function playScannerSound', 'async function signal').replaceAll('export function ', 'function ').replace('export type ', 'type ');
assert.ok(body.length>100);
const js=stripTypeScriptTypes(body);
for(const success of [true,false]) {
 const calls=[];
 class AudioContext {
  state='suspended';currentTime=10;destination={};
  sampleRate=48000;
  createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)}}
  createBufferSource(){return {connect(){},disconnect(){calls.push('disconnect')},start(){calls.push('buffer');this.onended()}}}
  async resume(){calls.push('resume');this.state='running'}
  async close(){calls.push('close')}
  createGain(){return {gain:{setValueAtTime:(...args)=>calls.push(['set',...args]),linearRampToValueAtTime:(...args)=>calls.push(['ramp',...args])},connect(){},disconnect(){}}}
  createOscillator(){return {set type(v){calls.push(['type',v])},frequency:{set value(v){calls.push(['frequency',v])},setValueAtTime:(...v)=>calls.push(['pitch',...v]),exponentialRampToValueAtTime:(...v)=>calls.push(['slide',...v])},connect(){},disconnect(){calls.push('disconnect')},start(t){calls.push(['start',t])},stop(t){calls.push(['stop',t]);this.onended()}}}
 }
 const ctx=vm.createContext({window:{AudioContext}});
 vm.runInContext(js,ctx);
 assert.equal(await ctx.signal(success),true);
 assert.equal(calls[0],'resume');
 if(success){
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='type'&&c[1]==='triangle'));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='ramp'&&c[1]===0.9));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='frequency'&&c[1]===(success?1200:440)));
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='stop'&&Math.abs(c[1]-(success?10.1:10.21))<1e-8));
 }else{
 assert.ok(calls.includes('buffer'));
 const samples=ctx.synthesizeErrorSound(48000);
 assert.equal(samples.length,19200);
 assert.ok(samples.every(Number.isFinite));
 assert.ok(Math.max(...samples.map(Math.abs))<=.950001);
 assert.equal(samples[0],0);
 }
 assert.equal(calls.includes('close'),false,'Do not truncate output buffers');
 assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='slide').length,0);
 assert.equal(calls.at(-1),'disconnect');
}
const unavailable=vm.createContext({window:{}});vm.runInContext(js,unavailable);assert.equal(await unavailable.signal(true),false);
// Compare with the previously accepted tone at common device sample rates.
const baseline=vm.createContext({window:{}});
vm.runInContext(js.replace('scale * Math.tanh(drive * samples[i] / peak)', '.9 * samples[i] / peak'),baseline);
for(const rate of [44100,48000,96000]){
 for(const [variant,duration] of [['knock',.08],['plop',.16]]){
  const samples=unavailable.synthesizePercussiveSound(rate,variant);
  assert.equal(samples.length,Math.ceil(rate*duration));
  assert.ok(samples.every(v=>Number.isFinite(v)&&Math.abs(v)<=.900001));
  assert.ok(samples.some(v=>Math.abs(v)>.5));
  assert.equal(samples[0],0);
  assert.ok(Math.abs(samples.at(-1))<.001);
 }
 const ding=unavailable.synthesizeDingSound(rate);
 assert.equal(ding.length,Math.ceil(rate*.32));
 assert.ok(ding.every(v=>Number.isFinite(v)&&Math.abs(v)<=.900001));
 assert.equal(ding[0],0);
 assert.ok(Math.abs(ding.at(-1))<.001);
 const before=baseline.synthesizeErrorSound(rate),after=unavailable.synthesizeErrorSound(rate);
 const rms=x=>Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length);
 assert.equal(before.length,after.length);
 assert.ok(rms(after)>rms(before)*1.15,'Average level must increase');
 assert.ok(after.every(v=>Number.isFinite(v)&&Math.abs(v)<=.950001));
 assert.ok(after.every((v,i)=>Math.sign(v)===Math.sign(before[i])),'Preserve zero crossings');
 console.log(`error_sound_${rate}: RMS +${(20*Math.log10(rms(after)/rms(before))).toFixed(2)} dB; peak <= 0.95`);
}
console.log('scanner_sound_ok: gain, duration, distinct tones, resume, cleanup, unavailable audio');
