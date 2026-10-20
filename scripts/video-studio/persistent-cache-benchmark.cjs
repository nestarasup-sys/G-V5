'use strict'
const { app,BrowserWindow,ipcMain }=require('electron')
const { execFileSync }=require('node:child_process')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript')
const { performance }=require('node:perf_hooks')
const ffmpeg=process.env.GACHA_FFMPEG_PATH,ffprobe=process.env.GACHA_FFPROBE_PATH
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html'),preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const width=1920,height=1080,totalFrames=120,jobId='bed60109-9725-438f-a102-a1def59997bd',studioId='55539eed-f760-4487-82d2-7839b3299634'
function loadTs(relativePath){
 const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
 const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
 const mod={exports:{}};new Function('require','module','exports',compiled)(require,mod,mod.exports);return mod.exports
}
const raw=loadTs('electron/videoRawFrameWriter.ts'),pixel=loadTs('electron/videoPixelFormat.ts'),persistent=loadTs('electron/videoPersistentFrameCache.ts')
function run(exe,args,encoding='utf8'){return execFileSync(exe,args,{encoding,timeout:240000,windowsHide:true,maxBuffer:32*1024*1024})}
const elements=[],textClips=[]
for(let i=0;i<20;i++){
 const id=`state-${i}`
 elements.push({id,kind:'narrator',text:`CACHE STATE ${String(i).padStart(2,'0')}`,x:(i%5-2)*12,y:(Math.floor(i/5)-1.5)*14,width:28,height:10,rotation:(i%3-1)*3,zIndex:2})
 textClips.push({id:`clip-${i}`,elementId:id,kind:'narrator',startFrame:i*6,endFrame:i*6+6})
}
const timeline={schemaVersion:1,frameRate:60,durationFrames:totalFrames,playheadFrame:0,playing:false,characterKeys:[],videoClips:[],videoAssets:[],saveMarkers:[],textClips}
const studio={schemaVersion:1,id:studioId,title:'Persistent cache benchmark',color:'#333',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
 backgroundColor:'#182b43',backgroundAssetId:null,backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,assets:[],elements,videoTimeline:timeline}
const bootstrap={jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:totalFrames},characters:{schemaVersion:1,characters:[]},characterAssets:{schemaVersion:1,entries:[]},renderVariant:'static-characters'}
app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-timer-throttling');app.commandLine.appendSwitch('force-device-scale-factor','1')
app.whenReady().then(async()=>{
 if(!ffmpeg||!ffprobe)throw new Error('FFmpeg/FFprobe obrigatórios.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-warm-cache-bench-')),cacheRoot=path.join(root,'cache')
 let win,pending=new Map(),readyResolve,readyReject
 ipcMain.handle('video-studio:export-surface:prepare',(_event,id)=>{if(id!==jobId)throw new Error('job inválido');return bootstrap})
 ipcMain.on('video-studio:export-surface:ready',(_event,ready)=>ready.error?readyReject(new Error(ready.error)):readyResolve())
 ipcMain.on('video-studio:export-surface:frame-ready',(_event,ready)=>{const p=pending.get(ready.requestId);if(!p)return;pending.delete(ready.requestId);if(ready.error)p.reject(new Error(ready.error));else p.resolve(pixel.rgbaToBgra(ready.pixels))})
 async function openSurface(){
   let ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
   win=new BrowserWindow({show:false,frame:false,width,height,useContentSize:true,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}})
   await win.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}`});await ready
 }
 async function surfaceFrame(frame){const id=`f-${frame}-${Math.random()}`;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});win.webContents.send('video-studio:export-surface:render',{requestId:id,frame})})}
 async function pass(label,warm){
   const cache=new persistent.VideoPersistentFrameCache(cacheRoot,256*1024*1024)
   await cache.repair()
   let surfaceRenders=0
   const output=path.join(root,`${label}.mp4`)
   const writer=new raw.VideoRawFrameWriter({executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(output,totalFrames,'bgra','h264_mf'),outputPath:output,frameBytes:width*height*4,frameCount:totalFrames})
   await writer.ready();const started=performance.now()
   for(let frame=0;frame<totalFrames;frame++){
     const state=Math.floor(frame/6),key=`cache-benchmark-state-${state}`
     let pixels=await cache.get(key,width*height*4)
     if(!pixels){pixels=await surfaceFrame(frame);surfaceRenders++;await cache.set(key,pixels)}
     await writer.writeFrame(pixels,{copy:false})
   }
   await writer.finish();const elapsedMs=performance.now()-started
   const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',output]))
   if(Number(probe.streams?.[0]?.nb_read_frames)!==totalFrames)throw new Error(label+' perdeu frames')
   return{label,warm,elapsedMs,surfaceRenders,throughputFps:totalFrames/(elapsedMs/1000),cache:await cache.stats(),bytes:fs.statSync(output).size}
 }
 try{
   await openSurface()
   const cold=await pass('cold',false)
   const warm=await pass('warm',true)
   const speedup=cold.elapsedMs/warm.elapsedMs
   if(warm.surfaceRenders!==0)throw new Error(`Warm ainda renderizou ${warm.surfaceRenders} estados.`)
   console.log(JSON.stringify({ok:true,cold,warm,speedup},null,2))
 }finally{
   if(win&&!win.isDestroyed())win.destroy();try{fs.rmSync(root,{recursive:true,force:true,maxRetries:12,retryDelay:150})}catch(error){console.warn('Temp cleanup warning:',error.message)};app.exit(0)
 }
}).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;app.exit(1)})
