'use strict'
const { app,BrowserWindow }=require('electron')
const { execFileSync }=require('node:child_process')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const { pathToFileURL }=require('node:url')

const ffmpeg=process.env.GACHA_FFMPEG_PATH
function run(exe,args){return execFileSync(exe,args,{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:16*1024*1024})}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(async()=>{
  if(!ffmpeg||!path.isAbsolute(ffmpeg))throw new Error('GACHA_FFMPEG_PATH obrigatório.')
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
async function htmlVideo(){
  const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=URL.createObjectURL(blob);
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('HTMLVideo metadata failed'));});
  let checksum=0;const started=performance.now();
  for(const time of timestamps){
    await new Promise((resolve,reject)=>{const done=()=>{video.removeEventListener('seeked',done);resolve()};video.addEventListener('seeked',done,{once:true});video.onerror=()=>reject(new Error('HTMLVideo seek failed'));video.currentTime=time;});
    if(video.requestVideoFrameCallback)await new Promise(resolve=>video.requestVideoFrameCallback(()=>resolve()));
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
    const sample=await sink.getSample(time);if(!sample)throw new Error('Mediabunny sample missing at '+time);
    sample.draw(ctx,0,0,640,360);const p=ctx.getImageData(0,0,1,1).data;checksum=(checksum+p[0]+p[1]*3+p[2]*7)>>>0;sample.close();
  }
  return{supported:true,elapsedMs:performance.now()-started,checksum,duration:await input.computeDuration()};
}
window.__resultPromise=(async()=>{const native=await htmlVideo();const mediabunny=await bunny();return{ok:true,timestamps:timestamps.length,native,mediabunny,speedup:mediabunny.supported?native.elapsedMs/mediabunny.elapsedMs:null};})();
</script></body></html>`)
  const win=new BrowserWindow({show:false,width:640,height:360,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
  try{
    await win.loadFile(html)
    const result=await win.webContents.executeJavaScript('window.__resultPromise',true)
    if(!result?.ok)throw new Error('Mediabunny A/B did not return result.')
    console.log(JSON.stringify(result,null,2))
  }finally{
    if(!win.isDestroyed())win.destroy()
    fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})
    app.exit(0)
  }
}).catch(error=>{console.error(error.stack||error.message);app.exit(1)})
