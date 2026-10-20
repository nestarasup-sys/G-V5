'use strict'

const { app, BrowserWindow, ipcMain, nativeImage, protocol } = require('electron')
const { execFileSync, spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const ts = require('typescript')

protocol.registerSchemesAsPrivileged([{ scheme:'gacha-video', privileges:{ secure:true, standard:true, stream:true, supportFetchAPI:true, corsEnabled:true } }])

const ffmpeg=process.env.GACHA_FFMPEG_PATH
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html')
const preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const width=1920,height=1080
const jobId='31d7e0d9-6fd8-4cd0-b07a-272615882451'
const studioId='94152e4f-6a3e-4f18-b38f-ec9eead01573'
const assetId='58aa83fd-f989-4a5a-a1c8-d76bb148c671'
const characterId='synthetic-character'
const actorId='synthetic-actor'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-character-oracle-'))
app.setPath('userData',path.join(root,'profile'))
// Each sample closes its surface before the next one opens. Keep the harness
// alive until its assertions decide the exit code.
app.on('window-all-closed',()=>{})

function cleanSandboxAfterExit(){
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});return}catch{}
  const cleanupScript="const fs=require('node:fs');const path=process.argv[1];let attempts=0;const timer=setInterval(()=>{try{fs.rmSync(path,{recursive:true,force:true,maxRetries:4,retryDelay:100});clearInterval(timer);process.exit(0)}catch{attempts++;if(attempts>=80){clearInterval(timer);process.exit(0)}}},250)"
  try{spawn(process.execPath,['-e',cleanupScript,root],{detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}).unref()}catch{}
}

const tsModules=new Map()
const repoRoot=path.resolve(__dirname,'../..')
function loadTs(relativePath){
  const file=path.resolve(repoRoot,relativePath)
  const cached=tsModules.get(file)
  if(cached)return cached.exports
  const source=fs.readFileSync(file,'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  tsModules.set(file,mod)
  const localRequire=(id)=>{
    if(!id.startsWith('./'))return require(id)
    const target=path.resolve(path.dirname(file),`${id}.ts`)
    if(!target.startsWith(`${repoRoot}${path.sep}`))throw new Error(`Módulo do oracle fora do repositório: ${id}`)
    return loadTs(path.relative(repoRoot,target))
  }
  new Function('require','module','exports',compiled)(localRequire,mod,mod.exports)
  return mod.exports
}
const visualOracle=loadTs('src/shared/videoVisualOracle.ts')
const frameHelpers=loadTs('src/shared/videoFrame.ts')
const sceneIr=loadTs('src/shared/videoSceneIR.ts')

function run(exe,args){return execFileSync(exe,args,{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:32*1024*1024})}
function sha256(buffer){return createHash('sha256').update(buffer).digest('hex')}
const { createCharacterMediaFixture: fixtureBootstrap } = require('./character-media-oracle-fixture.cjs')

function serveFile(request,file){
  const info=fs.statSync(file)
  const range=request.headers.get('range')
  const headers=new Headers({'accept-ranges':'bytes','content-type':'video/mp4','cache-control':'no-store'})
  if(request.method==='HEAD'){headers.set('content-length',String(info.size));return new Response(null,{status:200,headers})}
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range)
    if(!match)return new Response(null,{status:416})
    const start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]))
    const end=match[2]&&match[1]?Math.min(info.size-1,Number(match[2])):info.size-1
    headers.set('content-range',`bytes ${start}-${end}/${info.size}`);headers.set('content-length',String(end-start+1))
    return new Response(Readable.toWeb(createReadStream(file,{start,end})),{status:206,headers})
  }
  headers.set('content-length',String(info.size))
  return new Response(Readable.toWeb(createReadStream(file)),{status:200,headers})
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-device-scale-factor','1')

app.whenReady().then(async()=>{
  if(!ffmpeg||!path.isAbsolute(ffmpeg))throw new Error('GACHA_FFMPEG_PATH obrigatório.')
  const videoPath=path.join(root,'oracle-video.mp4')
  run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=480x270:rate=60:duration=5','-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+faststart',videoPath])
  const bootstrap=await fixtureBootstrap()
  bootstrap.snapshot.timeline.videoAssets[0].size=fs.statSync(videoPath).size
  protocol.handle('gacha-video',(request)=>{
    const url=new URL(request.url)
    if(url.hostname==='export-job'&&url.pathname===`/${jobId}/${assetId}`)return serveFile(request,videoPath)
    if(url.hostname==='studio'&&url.pathname===`/${studioId}/${assetId}`)return serveFile(request,videoPath)
    return new Response('not found',{status:404})
  })

  const allowed=new Set()
  let pending=null
  let activeVariant='animated'
  let timer=setTimeout(()=>finish(new Error('Oracle character/media excedeu 120 segundos.')),120000)
  let finished=false
  function cleanup(){clearTimeout(timer);try{ipcMain.removeHandler('video-studio:export-surface:prepare')}catch{};try{ipcMain.removeHandler('video-studio:preview-media:prepare')}catch{};ipcMain.removeAllListeners('video-studio:export-surface:ready');ipcMain.removeAllListeners('video-studio:export-surface:frame-ready');for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy();cleanSandboxAfterExit()}
  function finish(error){if(finished)return;finished=true;cleanup();if(error){console.error(error.stack||error.message);process.exitCode=1;app.exit(1)}else app.exit(0)}

  ipcMain.handle('video-studio:export-surface:prepare',(event,id)=>{
    if(id!==jobId||!allowed.has(event.sender.id))throw new Error('Sender/job inesperado no oracle.')
    return {...bootstrap,renderVariant:activeVariant}
  })
  ipcMain.handle('video-studio:preview-media:prepare',(event,id,asset)=>{
    if(!allowed.has(event.sender.id)||id!==studioId||asset?.id!==assetId)throw new Error('Asset inesperado no preview oracle.')
    return {sourceSha256:'synthetic-fixture',proxyUrl:`gacha-video://studio/${studioId}/${assetId}`,waveformUrl:null}
  })
  ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{
    if(!pending||event.sender.id!==pending.win.webContents.id)return
    if(ready.error){pending.reject(new Error(ready.error));pending=null;return}
    event.sender.send('video-studio:export-surface:render',{requestId:pending.requestId,frame:pending.frame})
  })
  ipcMain.on('video-studio:export-surface:frame-ready',async(event,ready)=>{
    if(!pending||event.sender.id!==pending.win.webContents.id||ready.requestId!==pending.requestId||ready.frame!==pending.frame)return
    const p=pending;pending=null
    if(ready.error){p.reject(new Error(ready.error));return}
    try{
      if(p.mode==='dom'){
        p.win.setContentSize(width,height,false)
        const image=await p.win.webContents.capturePage({x:0,y:0,width,height})
        const size=image.getSize()
        if(size.width!==width||size.height!==height)throw new Error(`Captura DOM é ${size.width}x${size.height}; esperado ${width}x${height}.`)
        p.resolve(Buffer.from(image.toBitmap()))
      }else{
        if(!(ready.pixels instanceof Uint8Array))throw new Error('Canvas não devolveu RGBA.')
        // NativeImage/capturePage is BGRA; convert Canvas RGBA to BGRA inline.
        const out=Buffer.allocUnsafe(ready.pixels.length)
        for(let i=0;i<ready.pixels.length;i+=4){out[i]=ready.pixels[i+2];out[i+1]=ready.pixels[i+1];out[i+2]=ready.pixels[i];out[i+3]=ready.pixels[i+3]}
        p.resolve(out)
      }
    }catch(error){p.reject(error)}
  })

  async function captureSequence(mode,variant,frames){
    activeVariant=variant
    const win=new BrowserWindow({show:false,frame:false,resizable:false,width,height,useContentSize:true,backgroundColor:'#000',
      webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:mode==='canvas'}})
    allowed.add(win.webContents.id)
    let requestCount=0
    const request=(frame,sendImmediately)=>{
      if(pending)throw new Error('Oracle já possui captura pendente.')
      const requestId=`${mode}-${variant}-${frame}-${++requestCount}-${Date.now()}`
      const pixels=new Promise((resolve,reject)=>{pending={resolve,reject,win,mode,frame,variant,requestId}})
      if(sendImmediately)win.webContents.send('video-studio:export-surface:render',{requestId,frame})
      return pixels
    }
    try{
      const samples=[]
      const first=request(frames[0],false)
      await win.loadFile(rendererFile,{hash:`${mode==='canvas'?'/video-export-surface':'/video-preview-oracle'}?jobId=${jobId}`})
      const save=async(frame,pixels)=>{
        if(process.env.GACHA_VIDEO_ORACLE_SAVE_EVIDENCE!=='1')return
        const evidenceDir=path.resolve(__dirname,'../../out/video-oracle-evidence')
        fs.mkdirSync(evidenceDir,{recursive:true})
        fs.writeFileSync(path.join(evidenceDir,`${variant}-${mode}-${frame}.png`),nativeImage.createFromBitmap(pixels,{width,height,scaleFactor:1}).toPNG())
      }
      const firstPixels=await first
      await save(frames[0],firstPixels)
      samples.push({frame:frames[0],pixels:firstPixels})
      for(const frame of frames.slice(1)){
        const pixels=await request(frame,true)
        await save(frame,pixels)
        samples.push({frame,pixels})
      }
      return samples
    }finally{
      if(pending?.win===win)pending=null
      allowed.delete(win.webContents.id)
      if(!win.isDestroyed())win.destroy()
    }
  }

  let blinkFrame=-1
  for(let frame=91;frame<300;frame++)if(frameHelpers.automaticBlinkFrameFor(frame,actorId,60)){blinkFrame=frame;break}
  if(blinkFrame<0)throw new Error('Fixture não encontrou frame determinístico de blink.')
  const cases=[
    {name:'pose-initial',frame:5},
    {name:'transition-mid',frame:22},
    {name:'pose-final',frame:30},
    {name:'mouth-idle',frame:10},
    {name:'mouth-talk',frame:65},
    {name:'blink',frame:blinkFrame},
    {name:'imported-video',frame:140},
  ]
  const regions={
    background:{x:10,y:10,width:400,height:300},
    backgroundArt:{x:1380,y:75,width:260,height:185},
    character:{x:480,y:260,width:280,height:530},
    narrator:{x:550,y:55,width:600,height:160},
    speech:{x:570,y:835,width:580,height:170},
    thought:{x:1370,y:720,width:480,height:180},
    video:{x:1250,y:330,width:180,height:150},
    extension:{x:1475,y:420,width:200,height:110},
  }
  const limits={
    background:{meanAbsoluteError:0,changedPixelRatio:0,p95AbsoluteError:0},
    backgroundArt:{meanAbsoluteError:.02,changedPixelRatio:.01,p95AbsoluteError:0,maxChannelError:4},
    character:{meanAbsoluteError:.55,changedPixelRatio:.085,p95AbsoluteError:2},
    narrator:{meanAbsoluteError:2.1,changedPixelRatio:.055,p95AbsoluteError:1},
    speech:{meanAbsoluteError:1.6,changedPixelRatio:.055,p95AbsoluteError:1},
    thought:{meanAbsoluteError:2.0,changedPixelRatio:.055,p95AbsoluteError:1},
    // The production HTML video decoder and FFmpeg frame decoder can differ by
    // one channel value during YUV-to-RGB conversion; structural metrics remain tight.
    video:{meanAbsoluteError:1,changedPixelRatio:.25,p95AbsoluteError:1},
    extension:{meanAbsoluteError:1.5,changedPixelRatio:.18,p95AbsoluteError:5},
  }
  const results={}
  const caseFrames=[...cases.map(({frame})=>frame),cases[0].frame]
  const initialSnapshot=JSON.stringify(bootstrap.snapshot)
  for(const variant of ['animated','static-characters']){
    const program=sceneIr.compileVideoScene(bootstrap.snapshot,variant)
    const evaluate=(frame)=>sceneIr.evaluateVideoSceneFrame(program,frame)
    const findActor=(scene)=>scene.characters.find((character)=>character.elementId===actorId)
    const mid=findActor(evaluate(22)), boundary=findActor(evaluate(30)), idle=findActor(evaluate(10)), talk=findActor(evaluate(65)), blink=findActor(evaluate(blinkFrame))
    if(variant==='animated'){
      if(!mid?.transition||mid.authoredState?.element.poseSlot!==1||mid.transition.from.element.faceAppearance?.expressionIndex!==0||mid.transition.to.element.faceAppearance?.expressionIndex!==1)throw new Error('animated não interpola pose/expressão mantendo a key authored de origem.')
      if(mid.stageTransform?.x!==-14)throw new Error('animated não aplica o stage transform no intervalo de transição.')
      if(boundary?.transition||boundary.authoredState?.element.poseSlot!==2||boundary.authoredState?.element.faceAppearance?.expressionIndex!==1)throw new Error('animated não aplica pose e expressão authored no limite da key.')
      if(idle?.automaticMouth?.mode!=='idle')throw new Error('animated não identificou estado de boca idle no balão thought.')
      if(talk?.automaticMouth?.mode!=='talk')throw new Error('animated não identificou fala e ciclo de boca.')
      if(!blink?.automaticBlink)throw new Error('fixture não exercita o blink determinístico sem boca automática ativa.')
    }else{
      if(mid?.transition||mid?.authoredState?.element.poseSlot!==1||mid.authoredState?.element.faceAppearance?.expressionIndex!==0)throw new Error('static-characters alterou pose/expressão antes da key authored.')
      if(boundary?.transition||boundary?.authoredState?.element.poseSlot!==2||boundary.authoredState?.element.faceAppearance?.expressionIndex!==1)throw new Error('static-characters não troca pose/expressão instantaneamente na key authored.')
      if(idle?.automaticMouth||talk?.automaticMouth||blink?.automaticMouth||blink?.automaticBlink)throw new Error('static-characters habilitou automatismo de boca ou blink.')
    }
    const videoScene=evaluate(140)
    if(videoScene.videos.length!==1||videoScene.videos[0].sourceTick!==140)throw new Error(`${variant} não mantém o vídeo importado no tick absoluto esperado.`)
    if(!videoScene.background.assetDataUrl||!videoScene.layers.some((layer)=>layer.element?.kind==='narrator')||!videoScene.layers.some((layer)=>layer.element?.kind==='thought'))throw new Error(`${variant} perdeu fundo ou texto na avaliação de cena.`)
    if(JSON.stringify(bootstrap.snapshot)!==initialSnapshot)throw new Error(`${variant} mutou o snapshot original.`)
    const domSamples=await captureSequence('dom',variant,caseFrames)
    const canvasSamples=await captureSequence('canvas',variant,caseFrames)
    const videoRegion=regions.video
    // The comparison ROI above samples an interior video patch. Repeatability
    // must mask the entire transformed clip footprint (30% x 28%, rotated 4°),
    // otherwise changed video pixels outside the small diagnostic ROI are
    // incorrectly attributed to the rest of the DOM.
    const videoRepeatRegion={x:1100,y:230,width:700,height:420}
    const withoutRegion=(buffer,region)=>{
      const copy=Buffer.from(buffer)
      const left=Math.max(0,Math.floor(region.x)), top=Math.max(0,Math.floor(region.y))
      const right=Math.min(width,Math.ceil(region.x+region.width)), bottom=Math.min(height,Math.ceil(region.y+region.height))
      for(let y=top;y<bottom;y++)copy.fill(0,(y*width+left)*4,(y*width+right)*4)
      return copy
    }
    // Chromium's native video decoder can produce tiny YUV->RGB differences
    // after a reverse seek even when it presents the same timestamp. The
    // authored/DOM composition outside the video must remain byte-identical,
    // while the video ROI is checked with the same calibrated structural
    // tolerance used by the DOM-vs-Canvas oracle. The export Canvas path uses
    // its timestamp-keyed bitmap cache and must remain fully byte-identical.
    const domRepeat=Buffer.compare(withoutRegion(domSamples[0].pixels,videoRepeatRegion),withoutRegion(domSamples.at(-1).pixels,videoRepeatRegion))===0
    const canvasRepeat=Buffer.compare(canvasSamples[0].pixels,canvasSamples.at(-1).pixels)===0
    const domVideoRepeat=visualOracle.comparePixelBuffers(domSamples[0].pixels,domSamples.at(-1).pixels,width,height,videoRegion,1)
    const videoRepeatLimit=limits.video
    const domVideoRepeatOk=domVideoRepeat.meanAbsoluteError<=videoRepeatLimit.meanAbsoluteError&&domVideoRepeat.changedPixelRatio<=videoRepeatLimit.changedPixelRatio&&domVideoRepeat.p95AbsoluteError<=videoRepeatLimit.p95AbsoluteError
    if(!domRepeat||!canvasRepeat||!domVideoRepeatOk)throw new Error(`${variant}: A-B-A divergente: ${JSON.stringify({domOutsideVideoExact:domRepeat,canvasExact:canvasRepeat,domVideoRepeat,videoRepeatLimit})}`)
    results[variant]={}
    for(let index=0;index<cases.length;index++){
      const entry=cases[index]
      const sampleScene=evaluate(entry.frame)
      const ordered=sampleScene.layers.map((layer)=>layer.type==='video'?`video:${layer.zOrder}`:`${layer.element.kind}:${layer.zOrder}`)
      const layerKinds=new Set(sampleScene.layers.filter((layer)=>layer.type==='element').map((layer)=>layer.element.kind))
      if(!layerKinds.has('narrator')||layerKinds.has('speech')!==(entry.frame>=50&&entry.frame<90)||layerKinds.has('thought')!==(entry.frame<150))throw new Error(`${variant}/${entry.name}: clipes de texto mudaram de disponibilidade entre os modos.`)
      if(!ordered.includes('image:9')||!ordered.includes('video:1'))throw new Error(`${variant}/${entry.name}: camadas de vídeo ou extensão V546 ausentes.`)
      if(ordered.indexOf('video:1')>ordered.indexOf('image:9'))throw new Error(`${variant}/${entry.name}: o z-order da extensão ficou abaixo do vídeo.`)
      const dom=domSamples[index].pixels
      const canvas=canvasSamples[index].pixels
      const full=visualOracle.comparePixelBuffers(dom,canvas,width,height)
      const rois=Object.fromEntries(Object.entries(regions).map(([name,region])=>[name,visualOracle.comparePixelBuffers(dom,canvas,width,height,region,name==='video'?1:0)]))
      for(const [name,metrics] of Object.entries(rois)){
        const limit=limits[name]
        if(metrics.meanAbsoluteError>limit.meanAbsoluteError||metrics.changedPixelRatio>limit.changedPixelRatio||metrics.p95AbsoluteError>limit.p95AbsoluteError||(limit.maxChannelError!==undefined&&metrics.maxChannelError>limit.maxChannelError)){
          throw new Error(`${variant}/${entry.name}: ROI ${name} divergiu acima do limite calibrado: ${JSON.stringify({metrics,limit})}`)
        }
      }
      const extensionPixel=(buffer)=>Array.from(buffer.subarray((475*width+1574)*4,(475*width+1574)*4+4))
      const expectedExtensionPixel=[212,59,255,255]
      if(JSON.stringify(extensionPixel(dom))!==JSON.stringify(expectedExtensionPixel)||JSON.stringify(extensionPixel(canvas))!==JSON.stringify(expectedExtensionPixel))throw new Error(`${variant}/${entry.name}: a extensão não ficou acima do vídeo com pixels V546 esperados.`)
      results[variant][entry.name]={frame:entry.frame,full,rois}
    }
    results[variant].repeatability={
      sequence:caseFrames,
      domOutsideVideoExact:domRepeat,
      domVideoRepeat,
      canvasExact:canvasRepeat,
      domSha256:sha256(domSamples[0].pixels),
      domSha256After:sha256(domSamples.at(-1).pixels),
      canvasSha256:sha256(canvasSamples[0].pixels),
      canvasSha256After:sha256(canvasSamples.at(-1).pixels),
    }
  }
  if(JSON.stringify(bootstrap.snapshot)!==initialSnapshot)throw new Error('Oracle mutou o projeto fonte.')
  console.log(JSON.stringify({ok:true,blinkFrame,variants:['animated','static-characters'],regions:Object.keys(regions),limits,results},null,2))
  finish()
}).catch((error)=>{console.error(error.stack||error.message);process.exitCode=1;cleanSandboxAfterExit();app.exit(1)})
