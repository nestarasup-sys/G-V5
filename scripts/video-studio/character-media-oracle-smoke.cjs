'use strict'

const { app, BrowserWindow, ipcMain, nativeImage, protocol } = require('electron')
const { execFileSync } = require('node:child_process')
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
const now='2026-01-01T00:00:00.000Z'

function loadTs(relativePath){
  const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)(require,mod,mod.exports)
  return mod.exports
}
const visualOracle=loadTs('src/shared/videoVisualOracle.ts')
const frameHelpers=loadTs('src/shared/videoFrame.ts')

function run(exe,args){return execFileSync(exe,args,{encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:32*1024*1024})}
function svgPng(width,height,body){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  const image=nativeImage.createFromDataURL('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))
  const png=image.toPNG()
  if(!png.length)throw new Error('Não foi possível criar PNG sintético.')
  return 'data:image/png;base64,'+png.toString('base64')
}
function part(id,name,x,y,w,h,dataUrl,rotation=0){return{id,name,x,y,width:w,height:h,dataUrl,rotation}}
function faceAsset(id,kind,name,x,y,w,h,dataUrl,rightSidePositioned=false,pairId){
  return{schemaVersion:1,id,modelSlot:1,kind,name,width:w,height:h,defaultTransform:{x,y,scaleX:1,scaleY:1,rotation:0},rightSidePositioned,pairId,updatedAt:now,dataUrl}
}
function catalog(id,category,name,pieceUrl,pieceW,pieceH,transform){
  return{schemaVersion:1,id,modelSlot:1,category,name,
    sheet:{kind:category,name,width:pieceW,height:pieceH,tolerance:0,dataUrl:pieceUrl},
    pieces:[{id:id+'-piece',sheet:category,index:0,crop:{x:0,y:0,width:pieceW,height:pieceH},width:pieceW,height:pieceH,dataUrl:pieceUrl}],
    transforms:{mouth:transform},eyeLinked:true,browLinked:true,selectedNose:0,selectedExpression:0,updatedAt:now}
}
function summaryComponent(asset){const{defaultTransform,dataUrl,...summary}=asset;return summary}
function summaryCatalog(item){return{id:item.id,modelSlot:item.modelSlot,category:item.category,name:item.name,updatedAt:item.updatedAt,pieceCount:item.pieces.length}}

function fixtureBootstrap(){
  const head=svgPng(100,100,'<rect width="100" height="100" rx="30" fill="#f0bb8e"/><rect x="4" y="4" width="92" height="92" rx="27" fill="none" stroke="#5b3c2c" stroke-width="6"/>')
  const torso=svgPng(110,160,'<rect x="5" y="5" width="100" height="150" rx="25" fill="#7957c8"/><path d="M20 70h70" stroke="#eadfff" stroke-width="12"/>')
  const eyeLeft=faceAsset('eye-left-open','eye','Olho esquerdo aberto',30,38,24,14,svgPng(24,14,'<ellipse cx="12" cy="7" rx="11" ry="6" fill="white"/><circle cx="12" cy="7" r="4" fill="#14233c"/>'),true,'pair-left')
  const eyeRight=faceAsset('eye-right-open','eye','Olho direito aberto',70,38,24,14,svgPng(24,14,'<ellipse cx="12" cy="7" rx="11" ry="6" fill="white"/><circle cx="12" cy="7" r="4" fill="#14233c"/>'),true,'pair-right')
  const eyeLeftClosed=faceAsset('eye-left-closed','eye-closed','Olho esquerdo fechado',30,38,24,8,svgPng(24,8,'<path d="M1 4 Q12 8 23 4" fill="none" stroke="#36251f" stroke-width="3"/>'),true,'pair-left')
  const eyeRightClosed=faceAsset('eye-right-closed','eye-closed','Olho direito fechado',70,38,24,8,svgPng(24,8,'<path d="M1 4 Q12 8 23 4" fill="none" stroke="#36251f" stroke-width="3"/>'),true,'pair-right')
  const mouthClosedPng=svgPng(34,12,'<path d="M2 6 Q17 10 32 6" fill="none" stroke="#8a3150" stroke-width="4"/>')
  const mouthOpenPng=svgPng(36,22,'<ellipse cx="18" cy="11" rx="15" ry="9" fill="#6b1835"/><ellipse cx="18" cy="14" rx="8" ry="3" fill="#ef789b"/>')
  const mouthClosed=catalog('mouth-closed','mouth-closed','Boca fechada',mouthClosedPng,34,12,{x:50,y:72,scaleX:1,scaleY:1,rotation:0})
  const mouthOpen=catalog('mouth-open','mouth-open','Boca aberta',mouthOpenPng,36,22,{x:50,y:72,scaleX:1,scaleY:1,rotation:0})

  const model={schemaVersion:1,slot:1,name:'Modelo sintético',sourceName:'synthetic',sourceAssetName:'synthetic.png',sourceDataUrl:head,width:200,height:300,tolerance:0,
    parts:[part('torso','Torso',45,125,110,160,torso),part('head','Cabeça',50,15,100,100,head)],joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}
  const pose1={schemaVersion:1,slot:1,name:'Pose 1',sourceModelSlot:1,sourceModelName:model.name,sourceModelUpdatedAt:now,width:200,height:300,
    parts:model.parts.map(x=>({...x})),joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}
  const pose2={schemaVersion:1,slot:2,name:'Pose 2',sourceModelSlot:1,sourceModelName:model.name,sourceModelUpdatedAt:now,width:200,height:300,
    parts:[part('torso','Torso',35,125,110,160,torso,-8),part('head','Cabeça',72,20,100,100,head,12)],joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}

  const faceAppearance={modelSlot:1,components:{
    'eye-left':{assetId:eyeLeft.id},'eye-right':{assetId:eyeRight.id}
  },mouthClosedCatalogId:mouthClosed.id,mouthOpenCatalogId:mouthOpen.id,
    eyeState:0,eyebrows:false,noseIndex:0,expressionIndex:0,mouthOpen:false}
  const baseElement={id:actorId,kind:'character',characterId,poseSlot:1,faceAppearance,text:'Synthetic',x:-18,y:0,width:20,height:48,rotation:0,zIndex:5,characterCanvasWidth:20}
  const nextElement={...baseElement,poseSlot:2,x:-14,y:1}
  const authored1=svgPng(200,300,'<rect x="45" y="125" width="110" height="160" rx="25" fill="#7957c8"/><rect x="50" y="15" width="100" height="100" rx="30" fill="#f0bb8e"/><circle cx="82" cy="55" r="6" fill="#14233c"/><circle cx="118" cy="55" r="6" fill="#14233c"/><path d="M84 85 Q100 94 116 85" stroke="#8a3150" stroke-width="5" fill="none"/>')
  const authored2=svgPng(200,300,'<g transform="rotate(-8 90 205)"><rect x="35" y="125" width="110" height="160" rx="25" fill="#7957c8"/></g><g transform="rotate(12 122 70)"><rect x="72" y="20" width="100" height="100" rx="30" fill="#f0bb8e"/><circle cx="102" cy="58" r="6" fill="#14233c"/><circle cx="138" cy="58" r="6" fill="#14233c"/><path d="M104 88 Q120 97 136 88" stroke="#8a3150" stroke-width="5" fill="none"/></g>')
  const baseState={imageDataUrl:authored1,element:baseElement}
  const nextState={imageDataUrl:authored2,element:nextElement}
  const speech={id:'speech-oracle',kind:'speech',speakerCharacterId:actorId,speakerName:'Synthetic',speakerColor:'#7957c8',text:'Falando no oracle',x:-5,y:30,width:28,height:13,rotation:0,zIndex:6}
  const timeline={schemaVersion:1,frameRate:60,durationFrames:300,playheadFrame:0,playing:false,animateCharacterTransitions:true,
    characterBases:{[actorId]:baseState},characterKeys:[{id:'pose-change',elementId:actorId,frame:30,poseSlot:2,expressionCollectionId:null,expressionPresetId:null,faceMode:'idle',state:nextState}],
    textClips:[{id:'speech-clip',elementId:speech.id,kind:'speech',startFrame:50,endFrame:90}],
    videoAssets:[{id:assetId,name:'oracle-video.mp4',mimeType:'video/mp4',extension:'mp4',size:1,durationFrames:300}],
    videoClips:[{id:'oracle-video-clip',assetId,startFrame:0,endFrame:300,sourceStartFrame:0,sourceEndFrame:300,transform:{x:25,y:-20,width:30,height:28,rotation:4}}],
    saveMarkers:[]}
  const studio={schemaVersion:1,id:studioId,title:'Character Media Oracle',color:'#333',createdAt:now,updatedAt:now,
    backgroundColor:'#203247',backgroundAssetId:null,backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,
    assets:[],elements:[baseElement,speech],videoTimeline:timeline}
  const character={id:characterId,name:'Synthetic',hair:'',outfit:'',skin:'',createdAt:now,updatedAt:now,
    customization:{modelSlot:1,poseSlot:1,partOverrides:{},layerOrder:[],faceAppearance}}
  const entries=[
    {method:'loadFabricatorSlot',args:[1],value:model},
    {method:'loadFabricatorPose',args:[1,1],value:pose1},
    {method:'loadFabricatorPose',args:[1,2],value:pose2},
    {method:'loadFaceComponentAsset',args:[1,eyeLeft.id],value:eyeLeft},
    {method:'loadFaceComponentAsset',args:[1,eyeRight.id],value:eyeRight},
    {method:'loadFaceComponentAsset',args:[1,eyeLeftClosed.id],value:eyeLeftClosed},
    {method:'loadFaceComponentAsset',args:[1,eyeRightClosed.id],value:eyeRightClosed},
    {method:'listFaceComponentAssets',args:[1,'eye-closed'],value:[summaryComponent(eyeLeftClosed),summaryComponent(eyeRightClosed)]},
    {method:'listFaceCatalog',args:[1],value:[summaryCatalog(mouthClosed),summaryCatalog(mouthOpen)]},
    {method:'loadFaceCatalogItem',args:[1,mouthClosed.id],value:mouthClosed},
    {method:'loadFaceCatalogItem',args:[1,mouthOpen.id],value:mouthOpen},
    {method:'listFaceExpressionPresets',args:[1],value:[]},
  ]
  return{jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:300},characters:{schemaVersion:1,characters:[character]},characterAssets:{schemaVersion:1,entries},renderVariant:'animated'}
}

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
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-character-oracle-'))
  const videoPath=path.join(root,'oracle-video.mp4')
  run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=480x270:rate=60:duration=5','-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+faststart',videoPath])
  const bootstrap=fixtureBootstrap()
  bootstrap.snapshot.timeline.videoAssets[0].size=fs.statSync(videoPath).size
  protocol.handle('gacha-video',(request)=>{
    const url=new URL(request.url)
    if(url.hostname==='export-job'&&url.pathname===`/${jobId}/${assetId}`)return serveFile(request,videoPath)
    return new Response('not found',{status:404})
  })

  const allowed=new Set()
  let pending=null
  let timer=setTimeout(()=>finish(new Error('Oracle character/media excedeu 120 segundos.')),120000)
  let finished=false
  function cleanup(){clearTimeout(timer);try{ipcMain.removeHandler('video-studio:export-surface:prepare')}catch{};ipcMain.removeAllListeners('video-studio:export-surface:ready');ipcMain.removeAllListeners('video-studio:export-surface:frame-ready');for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.destroy();try{fs.rmSync(root,{recursive:true,force:true,maxRetries:12,retryDelay:150})}catch(error){console.warn('Temp cleanup warning:',error.message)}}
  function finish(error){if(finished)return;finished=true;cleanup();if(error){console.error(error.stack||error.message);app.exit(1)}else app.exit(0)}

  ipcMain.handle('video-studio:export-surface:prepare',(event,id)=>{
    if(id!==jobId||!allowed.has(event.sender.id))throw new Error('Sender/job inesperado no oracle animado.')
    return bootstrap
  })
  ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{
    if(!pending||event.sender.id!==pending.win.webContents.id)return
    if(ready.error){pending.reject(new Error(ready.error));pending=null;return}
    event.sender.send('video-studio:export-surface:render',{requestId:pending.requestId,frame:pending.frame})
  })
  ipcMain.on('video-studio:export-surface:frame-ready',async(event,ready)=>{
    if(!pending||event.sender.id!==pending.win.webContents.id||ready.requestId!==pending.requestId)return
    const p=pending;pending=null
    if(ready.error){p.reject(new Error(ready.error));return}
    try{
      if(p.mode==='dom'){
        const image=await p.win.webContents.capturePage({x:0,y:0,width,height})
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

  async function capture(mode,frame){
    const win=new BrowserWindow({show:false,frame:false,resizable:false,width,height,useContentSize:true,backgroundColor:'#000',
      webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:mode==='canvas'}})
    allowed.add(win.webContents.id)
    const pixels=new Promise((resolve,reject)=>{pending={resolve,reject,win,mode,frame,requestId:`${mode}-${frame}-${Date.now()}`}})
    await win.loadFile(rendererFile,{hash:`${mode==='canvas'?'/video-export-surface':'/video-preview-oracle'}?jobId=${jobId}`})
    const result=await pixels
    allowed.delete(win.webContents.id);win.destroy()
    return result
  }

  let blinkFrame=-1
  for(let frame=91;frame<300;frame++)if(frameHelpers.automaticBlinkFrameFor(frame,actorId,60)){blinkFrame=frame;break}
  if(blinkFrame<0)throw new Error('Fixture não encontrou frame determinístico de blink.')
  const cases=[
    {name:'authored',frame:5},
    {name:'transition',frame:22},
    {name:'mouth',frame:65},
    {name:'blink',frame:blinkFrame},
    {name:'video',frame:140},
  ]
  const results={}
  for(const entry of cases){
    const dom=await capture('dom',entry.frame)
    const canvas=await capture('canvas',entry.frame)
    const full=visualOracle.comparePixelBuffers(dom,canvas,width,height)
    const character=visualOracle.comparePixelBuffers(dom,canvas,width,height,{x:420,y:220,width:720,height:760})
    const video=visualOracle.comparePixelBuffers(dom,canvas,width,height,{x:1250,y:180,width:560,height:400})
    results[entry.name]={frame:entry.frame,full,character,video}
    if(character.meanAbsoluteError>20||character.changedPixelRatio>0.25)throw new Error(`${entry.name}: personagem divergiu: ${JSON.stringify(character)}`)
    if(video.meanAbsoluteError>12||video.changedPixelRatio>0.16)throw new Error(`${entry.name}: vídeo divergiu: ${JSON.stringify(video)}`)
  }
  console.log(JSON.stringify({ok:true,blinkFrame,results},null,2))
  finish()
}).catch((error)=>{console.error(error.stack||error.message);app.exit(1)})
