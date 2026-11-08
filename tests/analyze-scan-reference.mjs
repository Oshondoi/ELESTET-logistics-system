// Read-only analysis of a local reference; no audio is uploaded or copied to the site.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bytes=await readFile(process.argv[2]);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 console.log(JSON.stringify(await page.evaluate(async data=>{
  const context=new AudioContext();
  const buffer=await context.decodeAudioData(Uint8Array.from(data).buffer);
  const x=buffer.getChannelData(0), rate=buffer.sampleRate;
  const frames=[];
  for(let t=0;t<buffer.duration;t+=.04){
   const start=Math.floor(t*rate), n=Math.min(2048,x.length-start);
   let sum=0;for(let j=0;j<n;j++)sum+=x[start+j]**2;
   const bins=[];
   for(let k=2;k<190;k++){
    let re=0,im=0;
    for(let j=0;j<n;j++){
     const v=x[start+j]*(.5-.5*Math.cos(2*Math.PI*j/(n-1)));
     re+=v*Math.cos(2*Math.PI*k*j/n);im-=v*Math.sin(2*Math.PI*k*j/n);
    }
    bins.push({hz:Math.round(k*rate/n),amp:Math.hypot(re,im)/n});
   }
   const peaks=bins.filter((b,i)=>i>0&&i<bins.length-1&&b.amp>bins[i-1].amp&&b.amp>bins[i+1].amp).sort((a,b)=>b.amp-a.amp).slice(0,5);
   frames.push({t:+t.toFixed(2),rms:+Math.sqrt(sum/n).toFixed(4),peaks:peaks.map(p=>[p.hz,+p.amp.toFixed(4)])});
  }
  await context.close();return {duration:buffer.duration,rate,channels:buffer.numberOfChannels,frames};
 },Array.from(bytes)),null,2));
}finally{await browser.close()}
