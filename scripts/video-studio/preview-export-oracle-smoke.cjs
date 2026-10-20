'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const jobId='f3c40c08-5be8-476f-8132-4dafca4f3d57'
const studioId='360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html')
const preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const width=1920,height=1080

function loadTs(relativePath){
  const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)(require,mod,mod.exports)
  return mod.exports
}
const oracle=loadTs('src/shared/videoVisualOracle.ts')
const pixelFormat=loadTs('electron/videoPixelFormat.ts')

const narrator={id:'narrator',kind:'narrator',text:'Narrador de paridade PT-BR',x:0,y:-20,width:50,height:15,rotation:0,zIndex:2}
const speech={id:'speech',kind:'speech',text:'Fala curta com acentuação: ação, você, coração.',speakerName:'Luna',speakerColor:'#8e63b8',x:-18,y:15,width:34,height:20,rotation:0,zIndex:3}
const thought={id:'thought',kind:'thought',text:'Pensamento em silêncio.',speakerName:'Nymi',speakerColor:'#3b8794',x:20,y:18,width:30,height:18,rotation:0,zIndex:4}
const extension={id:'extension',kind:'image',assetId:'@g-v5-fixture:extension-box',text:'Extensão V546',x:30,y:-25,width:18,height:14,rotation:0,zIndex:5}
const timeline={
  schemaVersion:1,frameRate:60,durationFrames:60,playheadFrame:0,playing:false,
  characterKeys:[],videoClips:[],videoAssets:[],saveMarkers:[],
  textClips:[
    {id:'narrator-clip',elementId:narrator.id,kind:'narrator',startFrame:0,endFrame:60},
    {id:'speech-clip',elementId:speech.id,kind:'speech',startFrame:0,endFrame:60},
    {id:'thought-clip',elementId:thought.id,kind:'thought',startFrame:0,endFrame:60},
  ],
}
const studio={
  schemaVersion:1,id:studioId,title:'Preview Export Oracle',color:'#333333',
  createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
  backgroundColor:'#29435f',backgroundAssetId:null,
  backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,
  assets:[{id:'@g-v5-fixture:extension-box',category:'object',name:'Extensão V546',mimeType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3F6WAAAAAElFTkSuQmCC'}],elements:[narrator,speech,thought,extension],videoTimeline:timeline,
}
const bootstrap={
  jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:60},
  characters:{schemaVersion:1,characters:[]},
  characterAssets:{schemaVersion:1,entries:[]},
  renderVariant:'static-characters',
}

let activeWindow=null
let currentMode=''
let pendingResolve=null
let timer
let settled=false
const intentionalClose=new WeakSet()

function fail(reason){
  if(settled)return
  settled=true
  clearTimeout(timer)
  try{ipcMain.removeHandler('video-studio:export-surface:prepare')}catch{}
  ipcMain.removeAllListeners('video-studio:export-surface:ready')
  ipcMain.removeAllListeners('video-studio:export-surface:frame-ready')
  if(activeWindow&&!activeWindow.isDestroyed())activeWindow.destroy()
  console.error(reason instanceof Error?reason.stack||reason.message:String(reason))
  app.exit(1)
}

function createWindow(offscreen){
  const win=new BrowserWindow({
    show:false,frame:false,resizable:false,width,height,useContentSize:true,backgroundColor:'#000000',
    webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen},
  })
  win.webContents.on('render-process-gone',(_event,details)=>{if(!intentionalClose.has(win))fail(new Error(`Oracle renderer encerrou: ${details.reason}`))})
  activeWindow=win
  return win
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-device-scale-factor','1')
app.whenReady().then(async()=>{
  timer=setTimeout(()=>fail(new Error('Oracle Preview↔Export excedeu 60 segundos.')),60000)
  const allowed=new Set()
  ipcMain.handle('video-studio:export-surface:prepare',(event,requestedJobId)=>{
    if(requestedJobId!==jobId||!allowed.has(event.sender.id))throw new Error('Sender/job inesperado no oracle.')
    return bootstrap
  })
  ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{
    if(ready.error){pendingResolve?.reject(new Error(ready.error));return}
    if(ready.jobId!==jobId||!allowed.has(event.sender.id))return
    event.sender.send('video-studio:export-surface:render',{requestId:`${currentMode}-frame-0`,frame:0})
  })
  ipcMain.on('video-studio:export-surface:frame-ready',async(event,ready)=>{
    if(!pendingResolve||event.sender.id!==pendingResolve.win.webContents.id||ready.requestId!==`${currentMode}-frame-0`)return
    const pending=pendingResolve;pendingResolve=null
    if(ready.error){pending.reject(new Error(ready.error));return}
    try{
      if(currentMode==='dom'){
        pending.win.setContentSize(width,height,false)
        const image=await pending.win.webContents.capturePage({x:0,y:0,width,height})
        const captured=image.getSize()
        if(captured.width!==width||captured.height!==height)throw new Error(`Captura DOM é ${captured.width}x${captured.height}; esperava 1920x1080.`)
        pending.resolve(Buffer.from(image.toBitmap()))
      }else{
        if(!(ready.pixels instanceof Uint8Array)||ready.pixels.byteLength!==width*height*4)throw new Error('Canvas export não devolveu pixels esperados.')
        pending.resolve(pixelFormat.rgbaToBgra(ready.pixels))
      }
    }catch(error){pending.reject(error)}
  })

  const dom=createWindow(false)
  allowed.add(dom.webContents.id)
  currentMode='dom'
  const domReady=new Promise((resolve,reject)=>{pendingResolve={resolve,reject,win:dom}})
  await dom.loadFile(rendererFile,{hash:`/video-preview-oracle?jobId=${jobId}`})
  const domPixels=await domReady
  allowed.delete(dom.webContents.id);intentionalClose.add(dom);dom.destroy()

  const canvas=createWindow(true)
  allowed.add(canvas.webContents.id)
  currentMode='canvas'
  const canvasReady=new Promise((resolve,reject)=>{pendingResolve={resolve,reject,win:canvas}})
  await canvas.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}`})
  const canvasPixels=await canvasReady

  const metrics={
    full:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height),
    background:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height,{x:0,y:0,width:240,height:160}),
    narrator:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height,{x:480,y:230,width:960,height:220}),
    speech:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height,{x:250,y:540,width:720,height:300}),
    thought:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height,{x:950,y:550,width:700,height:280}),
    extension:oracle.comparePixelBuffers(domPixels,canvasPixels,width,height,{x:1300,y:180,width:420,height:230}),
  }
  if(metrics.background.meanAbsoluteError>1||metrics.background.changedPixelRatio>0.01)throw new Error(`Background divergiu: ${JSON.stringify(metrics.background)}`)
  if(metrics.extension.meanAbsoluteError>3||metrics.extension.changedPixelRatio>0.04)throw new Error(`Plugin V546 divergiu entre preview/export: ${JSON.stringify(metrics.extension)}`)
  if(metrics.full.meanAbsoluteError>25||metrics.full.changedPixelRatio>0.22)throw new Error(`Preview/export divergiu além do gate inicial: ${JSON.stringify(metrics.full)}`)
  console.log(JSON.stringify({ok:true,frame:0,metrics},null,2))
  settled=true
  clearTimeout(timer)
  intentionalClose.add(canvas)
  canvas.destroy()
  app.exit(0)
}).catch(fail)
