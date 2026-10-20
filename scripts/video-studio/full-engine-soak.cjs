'use strict'

const { app,BrowserWindow,ipcMain,protocol }=require('electron')
const { execFileSync }=require('node:child_process')
const { createReadStream }=require('node:fs')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript')
const { Readable }=require('node:stream')
const { performance }=require('node:perf_hooks')

protocol.registerSchemesAsPrivileged([{scheme:'gacha-video',privileges:{secure:true,standard:true,stream:true,supportFetchAPI:true,corsEnabled:true}}])

const seconds=Number(process.env.GACHA_FULL_ENGINE_SOAK_SECONDS||process.argv[2]||90)
const fps=60,totalFrames=seconds*fps,chunkFrames=600,width=1920,height=1080
const ffmpeg=process.env.GACHA_FFMPEG_PATH,ffprobe=process.env.GACHA_FFPROBE_PATH
const encoder=process.env.GACHA_H264_ENCODER||'h264_mf'
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html')
const preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const jobId='71536b91-ac59-44ee-806e-3d90894345ee',studioId='fb1dafc4-ec9c-4eb2-bc13-3bb3637df7f4',assetId='631d0a35-4f0c-47ad-af79-e19da583571c'

function loadTs(relativePath){const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8');const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});const mod={exports:{}};new Function('require','module','exports',compiled)(require,mod,mod.exports);return mod.exports}
const raw=loadTs('electron/videoRawFrameWriter.ts')
function run(exe,args,encoding='utf8'){return execFileSync(exe,args,{encoding,timeout:35*60*1000,windowsHide:true,maxBuffer:32*1024*1024})}
function serve(request,file){const info=fs.statSync(file),range=request.headers.get('range'),headers=new Headers({'accept-ranges':'bytes','content-type':'video/mp4','cache-control':'no-store'});if(request.method==='HEAD'){headers.set('content-length',String(info.size));return new Response(null,{status:200,headers})}if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416});const s=m[1]?Number(m[1]):Math.max(0,info.size-Number(m[2])),e=m[2]&&m[1]?Math.min(info.size-1,Number(m[2])):info.size-1;headers.set('content-range',`bytes ${s}-${e}/${info.size}`);headers.set('content-length',String(e-s+1));return new Response(Readable.toWeb(createReadStream(file,{start:s,end:e})),{status:206,headers})}headers.set('content-length',String(info.size));return new Response(Readable.toWeb(createReadStream(file)),{status:200,headers})}

const charPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3F6WAAAAAElFTkSuQmCC'
const actor={id:'soak-actor',kind:'character',characterId:'soak-character',text:'Actor',x:-22,y:4,width:18,height:42,rotation:0,zIndex:4}
const state={element:actor,imageDataUrl:charPng}
const narrator={id:'soak-narrator',kind:'narrator',text:`FULL ENGINE SOAK ${seconds}s`,x:0,y:-34,width:40,height:10,rotation:0,zIndex:5}
const videoFrames=Math.min(300,totalFrames)
const timeline={schemaVersion:1,frameRate:60,durationFrames:totalFrames,playheadFrame:0,playing:false,animateCharacterTransitions:false,characterBases:{[actor.id]:state},characterKeys:[],textClips:[{id:'text',elementId:narrator.id,kind:'narrator',startFrame:0,endFrame:totalFrames}],videoAssets:[{id:assetId,name:'intro.mp4',mimeType:'video/mp4',extension:'mp4',size:1,durationFrames:videoFrames}],videoClips:[{id:'intro',assetId,startFrame:0,endFrame:videoFrames,sourceStartFrame:0,sourceEndFrame:videoFrames,transform:{x:23,y:14,width:38,height:34,rotation:2}}],saveMarkers:[]}
const studio={schemaVersion:1,id:studioId,title:'Full engine soak',color:'#333',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',backgroundColor:'#192e48',backgroundAssetId:null,backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,assets:[],elements:[actor,narrator],videoTimeline:timeline}
const bootstrap={jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:totalFrames},characters:{schemaVersion:1,characters:[]},characterAssets:{schemaVersion:1,entries:[]},renderVariant:'static-characters'}

app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-background-timer-throttling');app.commandLine.appendSwitch('force-device-scale-factor','1')
app.whenReady().then(async()=>{
 if(![90,900].includes(seconds))throw new Error('Full-engine soak aceita apenas 90 ou 900 segundos.')
 if(!ffmpeg||!ffprobe)throw new Error('FFmpeg/FFprobe obrigatórios.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),`gv5-full-engine-soak-${seconds}-`)),source=path.join(root,'intro.mp4')
 run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc2=size=480x270:rate=60:duration=${videoFrames/60}`,'-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p',source])
 bootstrap.snapshot.timeline.videoAssets[0].size=fs.statSync(source).size
 protocol.handle('gacha-video',(request)=>{const u=new URL(request.url);return u.hostname==='export-job'&&u.pathname===`/${jobId}/${assetId}`?serve(request,source):new Response('not found',{status:404})})
 let readyResolve,readyReject,pending=new Map()
 ipcMain.handle('video-studio:export-surface:prepare',(_event,id)=>{if(id!==jobId)throw new Error('job inválido');return bootstrap})
 ipcMain.on('video-studio:export-surface:ready',(_event,ready)=>ready.error?readyReject(new Error(ready.error)):readyResolve())
 ipcMain.on('video-studio:export-surface:frame-ready',(_event,ready)=>{const p=pending.get(ready.requestId);if(!p)return;pending.delete(ready.requestId);if(ready.error)p.reject(new Error(ready.error));else p.resolve(Buffer.from(ready.pixels.buffer,ready.pixels.byteOffset,ready.pixels.byteLength))})
 let win
 try{
   const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
   win=new BrowserWindow({show:false,frame:false,width,height,useContentSize:true,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}})
   await win.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}`});await ready
   async function render(frame){const id=`r-${frame}-${Math.random()}`;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});win.webContents.send('video-studio:export-surface:render',{requestId:id,frame})})}
   const chunks=[],started=performance.now();let cachedStatic=null,renderedFrames=0,reusedFrames=0,peakRss=process.memoryUsage().rss
   const count=Math.ceil(totalFrames/chunkFrames)
   for(let index=0;index<count;index++){
     const start=index*chunkFrames,end=Math.min(totalFrames,start+chunkFrames),frames=end-start,out=path.join(root,`chunk-${String(index).padStart(4,'0')}.mp4`)
     const writer=new raw.VideoRawFrameWriter({executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(out,frames,'rgba',encoder),outputPath:out,frameBytes:width*height*4,frameCount:frames})
     await writer.ready()
     const getPixels=async(frame)=>{
       if(frame>videoFrames&&cachedStatic){reusedFrames++;return cachedStatic}
       const pixels=await render(frame);renderedFrames++;if(frame===videoFrames)cachedStatic=pixels
       return pixels
     }
     let pendingPixels=getPixels(start)
     for(let frame=start;frame<end;frame++){
       const pixels=await pendingPixels
       if(frame+1<end)pendingPixels=getPixels(frame+1)
       await writer.writeFrame(pixels,{copy:false})
     }
     await writer.finish();chunks.push(out);peakRss=Math.max(peakRss,process.memoryUsage().rss)
     console.log(JSON.stringify({stage:'chunk',index:index+1,count,framesDone:end,renderedFrames,reusedFrames,elapsedMs:performance.now()-started,peakRss}))
   }
   const list=path.join(root,'concat.txt');fs.writeFileSync(list,chunks.map(file=>`file '${file.replace(/\\/g,'/')}'`).join('\n')+'\n')
   const final=path.join(root,'final.mp4');run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-an','-movflags','+faststart',final])
   const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration','-of','json',final]))
   const stream=probe.streams?.[0];if(!stream||stream.codec_name!=='h264'||Number(stream.nb_read_frames)!==totalFrames)throw new Error('Full-engine soak perdeu frames.')
   run(ffmpeg,['-v','error','-i',final,'-f','null','-'])
   const elapsedMs=performance.now()-started
   console.log(JSON.stringify({ok:true,seconds,totalFrames,encoder,renderedFrames,reusedFrames,chunks:chunks.length,elapsedMs,realtimeFactor:seconds/(elapsedMs/1000),throughputFps:totalFrames/(elapsedMs/1000),peakRss,finalBytes:fs.statSync(final).size,stream},null,2))
 }finally{
   if(win&&!win.isDestroyed())win.destroy()
   try{fs.rmSync(root,{recursive:true,force:true,maxRetries:12,retryDelay:150})}catch(error){console.warn('Temp cleanup warning:',error.message)}
   app.exit(0)
 }
}).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;app.exit(1)})
