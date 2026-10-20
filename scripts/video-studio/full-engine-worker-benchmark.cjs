'use strict'

const { app, BrowserWindow, ipcMain, protocol }=require('electron')
const { execFileSync }=require('node:child_process')
const { createReadStream }=require('node:fs')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const { Readable }=require('node:stream')
const { performance }=require('node:perf_hooks')
const ts=require('typescript')

protocol.registerSchemesAsPrivileged([{scheme:'gacha-video',privileges:{secure:true,standard:true,stream:true,supportFetchAPI:true,corsEnabled:true}}])
const ffmpeg=process.env.GACHA_FFMPEG_PATH
const ffprobe=process.env.GACHA_FFPROBE_PATH
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html')
const preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const width=1920,height=1080,totalFrames=240,chunkFrames=60
const jobId='726e2b84-aa60-4cf5-95b0-8d2557d9447f'
const studioId='f2ff96c8-ce44-45fc-9251-34e89ad4c45f'
const assetId='a64b7ec2-7597-48ac-b87c-c5d487830982'

function loadTs(relativePath){
 const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
 const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
 const mod={exports:{}};new Function('require','module','exports',compiled)(require,mod,mod.exports);return mod.exports
}
const raw=loadTs('electron/videoRawFrameWriter.ts')
const pixel=loadTs('electron/videoPixelFormat.ts')
function run(exe,args,encoding='utf8'){return execFileSync(exe,args,{encoding,timeout:300000,windowsHide:true,maxBuffer:32*1024*1024})}
function serve(request,file){
 const info=fs.statSync(file),range=request.headers.get('range')
 const headers=new Headers({'accept-ranges':'bytes','content-type':'video/mp4','cache-control':'no-store'})
 if(request.method==='HEAD'){headers.set('content-length',String(info.size));return new Response(null,{status:200,headers})}
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416});const s=m[1]?Number(m[1]):Math.max(0,info.size-Number(m[2]));const e=m[2]&&m[1]?Math.min(info.size-1,Number(m[2])):info.size-1;headers.set('content-range',`bytes ${s}-${e}/${info.size}`);headers.set('content-length',String(e-s+1));return new Response(Readable.toWeb(createReadStream(file,{start:s,end:e})),{status:206,headers})}
 headers.set('content-length',String(info.size));return new Response(Readable.toWeb(createReadStream(file)),{status:200,headers})
}

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz9zNwAAAABJRU5ErkJggg=='
const actor={id:'benchmark-actor',kind:'character',characterId:'bench-char',text:'Bench',x:-22,y:4,width:22,height:44,rotation:0,zIndex:4}
const state={element:actor,imageDataUrl:image}
const narrator={id:'bench-text',kind:'narrator',text:'FULL ENGINE BENCHMARK',x:0,y:-35,width:42,height:11,rotation:0,zIndex:5}
const timeline={schemaVersion:1,frameRate:60,durationFrames:totalFrames,playheadFrame:0,playing:false,animateCharacterTransitions:false,
 characterBases:{[actor.id]:state},characterKeys:[],textClips:[{id:'n',elementId:narrator.id,kind:'narrator',startFrame:0,endFrame:totalFrames}],
 videoAssets:[{id:assetId,name:'dynamic.mp4',mimeType:'video/mp4',extension:'mp4',size:1,durationFrames:totalFrames}],
 videoClips:[{id:'dynamic-clip',assetId,startFrame:0,endFrame:totalFrames,sourceStartFrame:0,sourceEndFrame:totalFrames,transform:{x:20,y:14,width:42,height:38,rotation:3}}],saveMarkers:[]}
const studio={schemaVersion:1,id:studioId,title:'Full engine benchmark',color:'#333',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
 backgroundColor:'#17283d',backgroundAssetId:null,backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,
 assets:[],elements:[actor,narrator],videoTimeline:timeline}
const bootstrap={jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:totalFrames},characters:{schemaVersion:1,characters:[]},characterAssets:{schemaVersion:1,entries:[]},renderVariant:'static-characters'}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-device-scale-factor','1')

app.whenReady().then(async()=>{
 if(!ffmpeg||!ffprobe)throw new Error('FFmpeg/FFprobe obrigatórios.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-full-engine-bench-'))
 const source=path.join(root,'dynamic.mp4')
 run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc2=size=640x360:rate=60:duration=${totalFrames/60}`,'-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+faststart',source])
 bootstrap.snapshot.timeline.videoAssets[0].size=fs.statSync(source).size
 protocol.handle('gacha-video',(request)=>{const u=new URL(request.url);return u.hostname==='export-job'&&u.pathname===`/${jobId}/${assetId}`?serve(request,source):new Response('not found',{status:404})})

 const allowed=new Set(),sessions=new Map()
 ipcMain.handle('video-studio:export-surface:prepare',(event,id)=>{if(id!==jobId||!allowed.has(event.sender.id))throw new Error('sender inválido');return bootstrap})
 ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{const session=sessions.get(event.sender.id);if(!session)return;if(ready.error)session.reject(new Error(ready.error));else{session.ready=true;session.resolveReady()}})
 ipcMain.on('video-studio:export-surface:frame-ready',(event,ready)=>{const s=sessions.get(event.sender.id);const p=s?.pending.get(ready.requestId);if(!p)return;s.pending.delete(ready.requestId);if(ready.error)p.reject(new Error(ready.error));else if(!(ready.pixels instanceof Uint8Array))p.reject(new Error('pixels ausentes'));else p.resolve(pixel.rgbaToBgra(ready.pixels))})

 async function openSurface(){
  const win=new BrowserWindow({show:false,frame:false,width,height,useContentSize:true,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}})
  allowed.add(win.webContents.id)
  let resolveReady,rejectReady;const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
  const session={win,pending:new Map(),ready:false,resolveReady,reject:rejectReady}
  sessions.set(win.webContents.id,session)
  await win.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}`});await readyPromise
  return{win,async frame(frame){const requestId=`${win.webContents.id}-${frame}-${Math.random()}`;return new Promise((resolve,reject)=>{session.pending.set(requestId,{resolve,reject});win.webContents.send('video-studio:export-surface:render',{requestId,frame})})},close(){allowed.delete(win.webContents.id);sessions.delete(win.webContents.id);win.destroy()}}
 }

 async function benchmark(workerCount){
  const dir=path.join(root,`w${workerCount}`);fs.mkdirSync(dir,{recursive:true})
  const surfaces=await Promise.all(Array.from({length:workerCount},()=>openSurface()))
  const indexes=Array.from({length:Math.ceil(totalFrames/chunkFrames)},(_,i)=>i)
  const cursor={value:0};let rendered=0
  const started=performance.now()
  async function worker(surface){
    while(true){const at=cursor.value++;const index=indexes[at];if(index===undefined)return
      const start=index*chunkFrames,end=Math.min(totalFrames,start+chunkFrames),out=path.join(dir,`chunk-${index}.mp4`)
      const writer=new raw.VideoRawFrameWriter({executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(out,end-start,'bgra','h264_mf'),outputPath:out,frameBytes:width*height*4,frameCount:end-start})
      await writer.ready()
      for(let frame=start;frame<end;frame++){const pixels=await surface.frame(frame);await writer.writeFrame(pixels,{copy:false});rendered++}
      await writer.finish()
    }
  }
  await Promise.all(surfaces.map(worker));surfaces.forEach(s=>s.close())
  const elapsedMs=performance.now()-started
  const list=path.join(dir,'concat.txt');fs.writeFileSync(list,indexes.map(i=>`file '${path.join(dir,`chunk-${i}.mp4`).replace(/\\/g,'/')}'`).join('\n')+'\n')
  const final=path.join(dir,'final.mp4');run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-an',final])
  const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames','-of','json',final]))
  if(Number(probe.streams?.[0]?.nb_read_frames)!==totalFrames)throw new Error('benchmark final perdeu frames')
  return{workerCount,elapsedMs,throughputFps:totalFrames/(elapsedMs/1000),realtimeFactor:(totalFrames/60)/(elapsedMs/1000),rendered,bytes:fs.statSync(final).size}
 }

 try{
  const serial=await benchmark(1)
  const turbo=await benchmark(2)
  const speedup=serial.elapsedMs/turbo.elapsedMs
  console.log(JSON.stringify({ok:true,totalFrames,serial,turbo,speedup},null,2))
 }finally{
  for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy()
  fs.rmSync(root,{recursive:true,force:true,maxRetries:12,retryDelay:150})
  app.exit(0)
 }
}).catch(error=>{console.error(error.stack||error.message);app.exit(1)})
