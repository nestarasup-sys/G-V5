'use strict'

const { app, BrowserWindow, ipcMain, protocol }=require('electron')
const { execFileSync }=require('node:child_process')
const { createHash }=require('node:crypto')
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
const width=1920,height=1080,durationSeconds=Number(process.env.GACHA_BENCH_SECONDS||5),totalFrames=durationSeconds*60,chunkFrames=60
const profile=process.env.GACHA_BENCH_PROFILE||'mixed-realistic'
const runLayerCacheAb=process.env.GACHA_BENCH_LAYER_CACHE_AB==='1'
const runReadbackAb=process.env.GACHA_BENCH_READBACK_AB==='1'
const machine={platform:process.platform,release:os.release(),cpuModel:os.cpus()[0]?.model??'unknown',logicalCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBytesAtStart:os.freemem()}
const jobId='726e2b84-aa60-4cf5-95b0-8d2557d9447f'
const studioId='f2ff96c8-ce44-45fc-9251-34e89ad4c45f'
const assetId='a64b7ec2-7597-48ac-b87c-c5d487830982'
const {createCharacterMediaFixture}=require('./character-media-oracle-fixture.cjs')

function loadTs(relativePath){
 const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
 const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
 const mod={exports:{}};new Function('require','module','exports',compiled)(require,mod,mod.exports);return mod.exports
}
const raw=loadTs('electron/videoRawFrameWriter.ts')
function run(exe,args,encoding='utf8'){return execFileSync(exe,args,{encoding,timeout:300000,windowsHide:true,maxBuffer:32*1024*1024})}
function serve(request,file){
 const info=fs.statSync(file),range=request.headers.get('range')
 const headers=new Headers({'accept-ranges':'bytes','content-type':'video/mp4','cache-control':'no-store'})
 if(request.method==='HEAD'){headers.set('content-length',String(info.size));return new Response(null,{status:200,headers})}
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416});const s=m[1]?Number(m[1]):Math.max(0,info.size-Number(m[2]));const e=m[2]&&m[1]?Math.min(info.size-1,Number(m[2])):info.size-1;headers.set('content-range',`bytes ${s}-${e}/${info.size}`);headers.set('content-length',String(e-s+1));return new Response(Readable.toWeb(createReadStream(file,{start:s,end:e})),{status:206,headers})}
 headers.set('content-length',String(info.size));return new Response(Readable.toWeb(createReadStream(file)),{status:200,headers})
}

if(![5,30,90].includes(durationSeconds))throw new Error('GACHA_BENCH_SECONDS deve ser 5, 30 ou 90.')
const profileOptions={
 'static-heavy':{actors:10,transitions:false,texts:2,videos:0},
 'transition-heavy':{actors:2,transitions:true,texts:2,videos:0},
 'imported-video-heavy':{actors:1,transitions:false,texts:2,videos:4},
 'text-heavy':{actors:1,transitions:false,texts:40,videos:0},
 'mixed-realistic':{actors:2,transitions:true,texts:6,videos:1},
}
if(!Object.hasOwn(profileOptions,profile))throw new Error(`GACHA_BENCH_PROFILE inválido: ${profile}`)

function configureProfile(bootstrap,sourcePath){
 const options=profileOptions[profile],{studio,timeline}=bootstrap.snapshot
 const baseActor=studio.elements.find(element=>element.kind==='character')
 const baseState=timeline.characterBases[baseActor.id]
 const firstKey=timeline.characterKeys[0]
 const alternateState=firstKey.state
 if(profile==='static-heavy'){timeline.characterKeys=[];timeline.animateCharacterTransitions=false}
 else if(options.transitions){timeline.animateCharacterTransitions=true;timeline.characterKeys=[firstKey]
  for(let frame=60;frame<totalFrames;frame+=30){const alternate=timeline.characterKeys.length%2===1
   timeline.characterKeys.push({id:`bench-pose-${frame}`,elementId:baseActor.id,frame,poseSlot:alternate?1:2,expressionCollectionId:null,expressionPresetId:null,faceMode:'idle',state:alternate?baseState:alternateState})
  }
 }else timeline.characterKeys=[]
 for(let index=studio.elements.filter(element=>element.kind==='character').length;index<options.actors;index++){
  const element={...baseActor,id:`bench-actor-${index}`,x:baseActor.x+(index%5)*13-26,y:baseActor.y+Math.floor(index/5)*10,zIndex:baseActor.zIndex+index}
  studio.elements.push(element);timeline.characterBases[element.id]={...baseState,element}
 }
 const narrator=studio.elements.find(element=>element.kind==='narrator')
 const narratorClip=timeline.textClips.find(clip=>clip.kind==='narrator')
 for(let index=studio.elements.filter(element=>element.kind==='narrator').length;index<options.texts;index++){
  const element={...narrator,id:`bench-text-${index}`,text:`Synthetic title ${index+1} — ação, você`,x:(index%8)*20-70,y:-42+Math.floor(index/8)*8,zIndex:narrator.zIndex+index}
  studio.elements.push(element);timeline.textClips.push({id:`bench-text-clip-${index}`,elementId:element.id,kind:'narrator',startFrame:0,endFrame:totalFrames})
 }
 narratorClip.endFrame=totalFrames
 const originalVideo=timeline.videoClips[0],originalAsset=timeline.videoAssets[0]
 timeline.videoClips=options.videos?Array.from({length:options.videos},(_,index)=>({...originalVideo,id:`bench-video-clip-${index}`,assetId:index===0?assetId:`bench-video-${index}`,transform:{...originalVideo.transform,x:originalVideo.transform.x+(index%2)*30,y:originalVideo.transform.y+Math.floor(index/2)*25}})):[]
 timeline.videoAssets=options.videos?Array.from({length:options.videos},(_,index)=>({...originalAsset,id:index===0?assetId:`bench-video-${index}`,name:`synthetic-video-${index}.mp4`,size:fs.statSync(sourcePath).size,durationFrames:totalFrames})):[]
 return{sourceByAssetId:new Map(timeline.videoAssets.map(asset=>[asset.id,sourcePath])),counts:{characters:options.actors,textClips:timeline.textClips.length,videoClips:timeline.videoClips.length,transitions:timeline.characterKeys.length}}
}

function appWorkingSetBytes(){
 const total=app.getAppMetrics().reduce((sum,metric)=>sum+Number(metric.memory?.workingSetSize||0),0)
 return total>0?total*1024:process.memoryUsage().rss
}
function createMemorySampler(){
 const initialBytes=appWorkingSetBytes();let peakBytes=initialBytes
 const timer=setInterval(()=>{peakBytes=Math.max(peakBytes,appWorkingSetBytes())},100);timer.unref?.()
 return{initialBytes,stop(){clearInterval(timer);peakBytes=Math.max(peakBytes,appWorkingSetBytes());return peakBytes}}
}
function sha256File(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex')}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-device-scale-factor','1')
// The benchmark deliberately destroys each worker window between serial and
// Turbo runs. Keep the Electron host alive until both measurements complete.
app.on('window-all-closed',()=>{})

app.whenReady().then(async()=>{
 if(!ffmpeg||!ffprobe)throw new Error('FFmpeg/FFprobe obrigatórios.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-full-engine-bench-'))
 const source=path.join(root,'dynamic.mp4')
 run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc2=size=640x360:rate=60:duration=${totalFrames/60}`,'-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+faststart',source])
 const bootstrap=await createCharacterMediaFixture({jobId,studioId,assetId,durationFrames:totalFrames})
 const profileCounts=configureProfile(bootstrap,source)
 protocol.handle('gacha-video',(request)=>{const u=new URL(request.url),[requestedJob,id]=u.pathname.split('/').filter(Boolean),file=profileCounts.sourceByAssetId.get(id);return u.hostname==='export-job'&&requestedJob===jobId&&file?serve(request,file):new Response('not found',{status:404})})

 const allowed=new Set(),sessions=new Map()
 ipcMain.handle('video-studio:export-surface:prepare',(event,id)=>{if(id!==jobId||!allowed.has(event.sender.id))throw new Error('sender inválido');return bootstrap})
 ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{const session=sessions.get(event.sender.id);if(!session)return;if(ready.error)session.reject(new Error(ready.error));else{session.ready=true;session.resolveReady()}})
 ipcMain.on('video-studio:export-surface:frame-ready',(event,ready)=>{const s=sessions.get(event.sender.id);const p=s?.pending.get(ready.requestId);if(!p)return;s.pending.delete(ready.requestId);if(ready.error)p.reject(new Error(ready.error));else if(!(ready.pixels instanceof Uint8Array))p.reject(new Error('pixels ausentes'));else p.resolve({pixels:Buffer.from(ready.pixels.buffer,ready.pixels.byteOffset,ready.pixels.byteLength),timings:ready.timings||{composeMs:0,readbackMs:0},layerCache:ready.layerCache||null})})

 async function openSurface(layerCacheEnabled=true,readbackOptimized=true){
  const win=new BrowserWindow({show:false,width,height,useContentSize:true,backgroundColor:'#000',webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}})
  allowed.add(win.webContents.id)
  const diagnostics=[]
  win.webContents.on('did-fail-load',(_event,errorCode,errorDescription,url,isMainFrame)=>diagnostics.push({errorCode,errorDescription,url,isMainFrame}))
  win.webContents.on('render-process-gone',(_event,details)=>diagnostics.push({renderProcessGone:details}))
  let resolveReady,rejectReady;const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
  const session={win,pending:new Map(),ready:false,resolveReady,reject:rejectReady}
  sessions.set(win.webContents.id,session)
  const timeout=setTimeout(()=>rejectReady(new Error('timeout aguardando ready da surface')),30000)
  try{await Promise.all([win.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}&layerCache=${layerCacheEnabled?'1':'0'}&readbackCpu=${readbackOptimized?'1':'0'}`}),readyPromise])}catch(error){await new Promise(resolve=>setTimeout(resolve,100));throw new Error(`${error.message}; renderer=${JSON.stringify(diagnostics)}`)}finally{clearTimeout(timeout)}
  return{win,async frame(frame){const requestId=`${win.webContents.id}-${frame}-${Math.random()}`;return new Promise((resolve,reject)=>{session.pending.set(requestId,{resolve,reject});win.webContents.send('video-studio:export-surface:render',{requestId,frame})})},close(){allowed.delete(win.webContents.id);sessions.delete(win.webContents.id);win.destroy()}}
 }

 const parityFrames=new Set([0,Math.floor(totalFrames/2),totalFrames-1])
 const cachedParitySamples=new Map()
 function comparePixels(left,right){
  if(!left||!right||left.length!==right.length)throw new Error('Amostras de pixels inválidas para A/B do layer cache.')
  let absolute=0,changedPixels=0,maxChannelError=0
  const histogram=new Uint32Array(256)
  for(let pixel=0;pixel<left.length;pixel+=4){
    let pixelChanged=false
    for(let channel=0;channel<4;channel++){
      const delta=Math.abs(left[pixel+channel]-right[pixel+channel])
      absolute+=delta
      histogram[delta]++
      if(delta>2)pixelChanged=true
      if(delta>maxChannelError)maxChannelError=delta
    }
    if(pixelChanged)changedPixels++
  }
  const percentile=(fraction)=>{
    const target=Math.ceil(left.length*fraction);let seen=0
    for(let value=0;value<histogram.length;value++){seen+=histogram[value];if(seen>=target)return value}
    return 255
  }
  return{
    meanAbsoluteError:absolute/left.length,
    changedPixelRatio:changedPixels/(left.length/4),
    p99ChannelError:percentile(.99),
    p999ChannelError:percentile(.999),
    maxChannelError,
  }
 }
 async function benchmark(workerCount,layerCacheEnabled=true,readbackOptimized=true){
  const dir=path.join(root,`w${workerCount}-lc${layerCacheEnabled?1:0}-rb${readbackOptimized?1:0}`);fs.mkdirSync(dir,{recursive:true})
  const started=performance.now(),memory=createMemorySampler()
  const indexes=Array.from({length:Math.ceil(totalFrames/chunkFrames)},(_,i)=>i)
  const workerChunks=Array.from({length:workerCount},(_,workerIndex)=>indexes.filter(index=>index%workerCount===workerIndex))
  const activeWriters=new Set()
  let rendered=0,composeMs=0,readbackMs=0,frameAcquireMs=0,encoderReadyMs=0,frameWriteMs=0,writerFinishMs=0
  const rawFrameHash=createHash('sha256')
  let layerCacheHits=0,layerCacheMisses=0,layerCacheEvictions=0,layerCacheBytes=0,layerCacheMaxBytes=0
  const createWriter=async(index)=>{
   const start=index*chunkFrames,end=Math.min(totalFrames,start+chunkFrames),out=path.join(dir,`chunk-${index}.mp4`)
   const writer=new raw.VideoRawFrameWriter({executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(out,end-start,'rgba','h264_mf'),outputPath:out,frameBytes:width*height*4,frameCount:end-start})
   activeWriters.add(writer)
   const readyStarted=performance.now()
   await writer.ready()
   encoderReadyMs+=performance.now()-readyStarted
   return writer
  }
  const surfaces=[]
  try{
    const initialWriters=await Promise.all(workerChunks.map(chunks=>createWriter(chunks[0])))
    const surfaceStart=performance.now()
    for(let index=0;index<workerCount;index++)surfaces.push(await openSurface(layerCacheEnabled,readbackOptimized))
    const surfaceStartupMs=performance.now()-surfaceStart
    const renderEncodeStarted=performance.now()
    async function worker(surface,chunks,initialWriter){
      let writer=initialWriter
      let previousLayerStats={hits:0,misses:0,evictions:0}
      for(let chunkIndex=0;chunkIndex<chunks.length;chunkIndex++){
        const index=chunks[chunkIndex],start=index*chunkFrames,end=Math.min(totalFrames,start+chunkFrames)
        if(chunkIndex>0)writer=await createWriter(index)
        const requestFrame=(frame)=>{const requested=performance.now();return surface.frame(frame).then(result=>({result,acquireMs:performance.now()-requested}))}
        let pendingFrame=requestFrame(start)
        for(let frame=start;frame<end;frame++){
          const awaited=await pendingFrame,result=awaited.result;frameAcquireMs+=awaited.acquireMs
          composeMs+=result.timings.composeMs;readbackMs+=result.timings.readbackMs
          if(result.layerCache){layerCacheHits+=Math.max(0,result.layerCache.hits-previousLayerStats.hits);layerCacheMisses+=Math.max(0,result.layerCache.misses-previousLayerStats.misses);layerCacheEvictions+=Math.max(0,result.layerCache.evictions-previousLayerStats.evictions);layerCacheBytes=Math.max(layerCacheBytes,result.layerCache.bytes);layerCacheMaxBytes=Math.max(layerCacheMaxBytes,result.layerCache.maxBytes);previousLayerStats=result.layerCache}
          rawFrameHash.update(result.pixels)
          if(runLayerCacheAb&&workerCount===1&&parityFrames.has(frame)){
            if(layerCacheEnabled)cachedParitySamples.set(frame,Buffer.from(result.pixels))
          }
          if(frame+1<end)pendingFrame=requestFrame(frame+1)
          const writeStarted=performance.now();await writer.writeFrame(result.pixels,{copy:false});frameWriteMs+=performance.now()-writeStarted;rendered++
        }
        const finishStarted=performance.now()
        await writer.finish()
        writerFinishMs+=performance.now()-finishStarted
        activeWriters.delete(writer)
      }
    }
    await Promise.all(surfaces.map((surface,index)=>worker(surface,workerChunks[index],initialWriters[index])))
    const renderEncodeWallMs=performance.now()-renderEncodeStarted
    const list=path.join(dir,'concat.txt');fs.writeFileSync(list,indexes.map(i=>`file '${path.join(dir,`chunk-${i}.mp4`).replace(/\\/g,'/')}'`).join('\n')+'\n')
    const final=path.join(dir,'final.mp4'),assembleStarted=performance.now()
    run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-an',final])
    const assembleMs=performance.now()-assembleStarted
    const verifyStarted=performance.now()
    const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames','-of','json',final]))
    const stream=probe.streams?.[0]
    if(stream?.codec_name!=='h264'||Number(stream.width)!==width||Number(stream.height)!==height||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==totalFrames)throw new Error(`benchmark final inválido: ${JSON.stringify(stream)}`)
    run(ffmpeg,['-hide_banner','-loglevel','error','-xerror','-i',final,'-map','0:v:0','-f','null','-'])
    const verifyMs=performance.now()-verifyStarted
    const elapsedMs=performance.now()-started
    const peakBytes=memory.stop()
    if(rendered!==totalFrames)throw new Error(`benchmark enviou ${rendered}/${totalFrames} frames`)
    return{
     workerCount,layerCacheEnabled,readbackOptimized,durationSeconds,frames:totalFrames,elapsedMs,throughputFps:totalFrames/(elapsedMs/1000),realtimeFactor:durationSeconds/(elapsedMs/1000),
     surfaceStartupMs,renderEncodeWallMs,composeMs,readbackMs,frameAcquireMs,encoderReadyMs,frameWriteMs,writerFinishMs,assembleMs,verifyMs,
     readbackRatio:(composeMs+readbackMs)>0?readbackMs/(composeMs+readbackMs):0,
     layerCache:{hits:layerCacheHits,misses:layerCacheMisses,evictions:layerCacheEvictions,bytesPeak:layerCacheBytes,maxBytes:layerCacheMaxBytes,avoidedLayerDraws:layerCacheHits},
     ramInitialBytes:memory.initialBytes,ramPeakBytes:peakBytes,ramScope:'Electron process tree working set; external FFmpeg process memory is not included',
     rendered,rawFrameSha256:rawFrameHash.digest('hex'),chunkCount:indexes.length,codec:stream.codec_name,width:Number(stream.width),height:Number(stream.height),frameRate:stream.r_frame_rate,outputBytes:fs.statSync(final).size,outputSha256:sha256File(final),
    }
  }catch(error){
    await Promise.all([...activeWriters].map(writer=>writer.cancel().catch(()=>{})))
    memory.stop()
    throw error
  }finally{
    surfaces.forEach(surface=>surface.close())
  }
 }

 try{
  const serial=await benchmark(1,true,true)
  const turbo=await benchmark(2,true,true)
  const speedup=serial.elapsedMs/turbo.elapsedMs
  let cacheOffSamples=null
  if(runLayerCacheAb){
    // Capture an uncached render of the same deterministic sample frames after
    // the timed run. This quantifies the expected 8-bit alpha-compositing
    // rounding instead of requiring impossible byte identity.
    const originalFrames=Array.from(parityFrames)
    cacheOffSamples=[]
    const sampleSurface=await openSurface(false,true)
    try{
      for(const frame of originalFrames){
        const uncached=await sampleSurface.frame(frame)
        const cached=cachedParitySamples.get(frame)
        const metrics=comparePixels(cached,uncached.pixels)
        cacheOffSamples.push({frame,...metrics})
      }
    }finally{sampleSurface.close()}
  }
  const cacheOffSerial=runLayerCacheAb?await benchmark(1,false,true):null
  const layerCacheSpeedup=cacheOffSerial?cacheOffSerial.elapsedMs/serial.elapsedMs:null
  const readbackOffSerial=runReadbackAb?await benchmark(1,true,false):null
  const readbackSpeedup=readbackOffSerial?readbackOffSerial.elapsedMs/serial.elapsedMs:null
  const worstCacheParity=cacheOffSamples?{
    meanAbsoluteError:Math.max(...cacheOffSamples.map(x=>x.meanAbsoluteError)),
    changedPixelRatio:Math.max(...cacheOffSamples.map(x=>x.changedPixelRatio)),
    p99ChannelError:Math.max(...cacheOffSamples.map(x=>x.p99ChannelError)),
    p999ChannelError:Math.max(...cacheOffSamples.map(x=>x.p999ChannelError)),
    maxChannelError:Math.max(...cacheOffSamples.map(x=>x.maxChannelError)),
  }:null
  // A full-size transparent layer introduces one extra 8-bit alpha-composite,
  // so a handful of fringe pixels can have a high maximum error. Gate the
  // distribution (MAE/area/p99.9) and keep max only as a diagnostic.
  if(worstCacheParity&&(worstCacheParity.meanAbsoluteError>0.10||worstCacheParity.changedPixelRatio>0.005||worstCacheParity.p999ChannelError>8)){
    throw new Error(`Layer cache ON/OFF excedeu tolerância visual: ${JSON.stringify({worstCacheParity,cacheOffSamples})}`)
  }
  const report=JSON.stringify({ok:true,profile,durationSeconds,dimensions:`${width}x${height}`,frameRate:60,totalFrames,machine,fixture:profileCounts.counts,serial,turbo,speedup,cacheOffSerial,layerCacheSpeedup,readbackOffSerial,readbackSpeedup,cacheParitySamples:cacheOffSamples,worstCacheParity},null,2)
  await new Promise((resolve,reject)=>process.stdout.write(`${report}\n`,error=>error?reject(error):resolve()))
 }finally{
  for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy()
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:12,retryDelay:150})}catch(error){console.warn('Temp cleanup warning:',error.message)}
 }
 app.exit(0)
}).catch(error=>{
 const message=`${error.stack||error.message}\n`
 process.exitCode=1
 process.stderr.write(message,()=>app.exit(1))
})
