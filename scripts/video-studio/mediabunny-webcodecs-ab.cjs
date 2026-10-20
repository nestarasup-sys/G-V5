'use strict'
const { app,BrowserWindow }=require('electron')
const { execFileSync }=require('node:child_process')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const { pathToFileURL }=require('node:url')

const ffmpeg=process.env.GACHA_FFMPEG_PATH
function run(exe,args){return execFileSync(exe,args,{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:16*1024*1024})}

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(async()=>{
  if(!ffmpeg||!path.isAbsolute(ffmpeg))throw new Error('GACHA_FFMPEG_PATH obrigatório.')
  const gpuInfo=await app.getGPUInfo('basic').catch(()=>null)
  const gpuFeatures=app.getGPUFeatureStatus()
  const gpuText=JSON.stringify({gpuInfo,gpuFeatures}).toLowerCase()
  const noEligibleAcceleration=gpuFeatures.gpu_compositing==='disabled_software'
    || /swiftshader|microsoft basic render|software/.test(gpuText)
  if(noEligibleAcceleration){
    console.log(JSON.stringify({ok:true,supported:false,reason:'Hosted runner has no eligible accelerated media/GPU path',gpuFeatures,gpuInfo},null,2))
    app.exit(0);return
  }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-mediabunny-ab-'))
  const media=path.join(root,'source.mp4')
  run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=60:duration=5','-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+faststart',media])
  const bytes=fs.readFileSync(media).toString('base64')
  const entry=require.resolve('mediabunny')
  const moduleUrl=pathToFileURL(entry).href
  const html=path.join(root,'bench.html')
  fs.writeFileSync(html,`<!doctype html><html><body><script type="module">
import {Input,ALL_FORMATS,BlobSource,VideoSampleSink} from ${JSON.stringify(moduleUrl)};
const raw=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0));
const blob=new Blob([raw],{type:'video/mp4'});
const timestamps=[0.10,4.20,1.30,3.70,0.65,2.85,4.70,1.85,3.15,0.25,4.45,2.25,0.95,3.95,1.55,2.55,4.90,0.45,3.45,2.05];
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d',{willReadFrequently:true});
const bounded=(promise,label,ms=8000)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),ms))]);
async function htmlVideo(){
  const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=URL.createObjectURL(blob);
  await bounded(new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('HTMLVideo metadata failed'));}),'HTMLVideo metadata');
  let checksum=0;const started=performance.now();
  for(const time of timestamps){
    await bounded(new Promise((resolve,reject)=>{const done=()=>{video.removeEventListener('seeked',done);resolve()};video.addEventListener('seeked',done,{once:true});video.onerror=()=>reject(new Error('HTMLVideo seek failed'));video.currentTime=time;}),'HTMLVideo seek '+time);
    ctx.drawImage(video,0,0,640,360);const p=ctx.getImageData(0,0,1,1).data;checksum=(checksum+p[0]+p[1]*3+p[2]*7)>>>0;
  }
  const elapsedMs=performance.now()-started;URL.revokeObjectURL(video.src);return{elapsedMs,checksum};
}
async function bunny(){
  if(typeof VideoDecoder==='undefined')return{supported:false,reason:'WebCodecs VideoDecoder unavailable'};
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
  const track=await input.getPrimaryVideoTrack();if(!track)return{supported:false,reason:'no video track'};
  if(!await track.canDecode())return{supported:false,reason:'track cannot decode'};
  const sink=new VideoSampleSink(track);let checksum=0;const started=performance.now();
  for(const time of timestamps){
    const sample=await bounded(sink.getSample(time),'Mediabunny sample '+time);if(!sample)throw new Error('Mediabunny sample missing at '+time);
    sample.draw(ctx,0,0,640,360);const p=ctx.getImageData(0,0,1,1).data;checksum=(checksum+p[0]+p[1]*3+p[2]*7)>>>0;sample.close();
  }
  return{supported:true,elapsedMs:performance.now()-started,checksum,duration:await input.computeDuration()};
}
function median(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
window.__resultPromise=(async()=>{
  const nativeSamples=[],mediabunnySamples=[];
  try{
    for(let round=0;round<2;round++){
      if(round%2===0){nativeSamples.push(await htmlVideo());mediabunnySamples.push(await bunny());}
      else{mediabunnySamples.push(await bunny());nativeSamples.push(await htmlVideo());}
    }
  }catch(error){
    return{ok:true,supported:false,reason:error instanceof Error?error.message:String(error),timestamps:timestamps.length,nativeSamples,mediabunnySamples};
  }
  const supported=mediabunnySamples.every(x=>x.supported);
  const nativeMedianMs=median(nativeSamples.map(x=>x.elapsedMs));
  const mediabunnyMedianMs=supported?median(mediabunnySamples.map(x=>x.elapsedMs)):null;
  return{ok:true,supported,timestamps:timestamps.length,rounds:2,nativeSamples,mediabunnySamples,nativeMedianMs,mediabunnyMedianMs,speedup:supported?nativeMedianMs/mediabunnyMedianMs:null};
})();
</script></body></html>`)
  const win=new BrowserWindow({show:false,width:640,height:360,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
  try{
    await win.loadFile(html)
    const result=await Promise.race([
      win.webContents.executeJavaScript('(async()=>{while(!window.__resultPromise)await new Promise(r=>setTimeout(r,10));return await window.__resultPromise})()',true),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Mediabunny/WebCodecs A/B excedeu 90 segundos.')),90000)),
    ])
    if(!result?.ok)throw new Error('Mediabunny A/B did not return result.')
    console.log(JSON.stringify({...result,machine:{platform:process.platform,release:os.release(),cpu:os.cpus()[0]?.model??'unknown',logicalCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem()},gpuInfo},null,2))
  }finally{
    if(!win.isDestroyed())win.destroy()
    fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})
    app.exit(0)
  }
}).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;app.exit(1)})
