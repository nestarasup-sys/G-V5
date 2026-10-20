'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const ffmpeg=process.env.GACHA_FFMPEG_PATH
const ffprobe=process.env.GACHA_FFPROBE_PATH
const rendererFile=path.resolve(__dirname,'../../out/renderer/index.html')
const preloadPath=path.resolve(__dirname,'../../out/preload/video-export-preload.cjs')
const jobId='f3c40c08-5be8-476f-8132-4dafca4f3d57'
const studioId='360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const width=1920,height=1080,totalFrames=120

function loadTs(relativePath,deps={}){
  const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name in deps?deps[name]:require(name),mod,mod.exports)
  return mod.exports
}
function run(exe,args,encoding='utf8'){
  return execFileSync(exe,args,{encoding,timeout:180000,windowsHide:true,maxBuffer:32*1024*1024})
}
function requireTool(v,name){if(!v||!path.isAbsolute(v)||!fs.existsSync(v))throw new Error(`${name} obrigatório.`)}

const narrator={id:'turbo-text',kind:'narrator',text:'TURBO 2 WORKERS',x:0,y:0,width:48,height:16,rotation:0,zIndex:2}
const timeline={schemaVersion:1,frameRate:60,durationFrames:totalFrames,playheadFrame:0,playing:false,characterKeys:[],videoClips:[],videoAssets:[],saveMarkers:[],textClips:[{id:'text-clip',elementId:narrator.id,kind:'narrator',startFrame:0,endFrame:totalFrames}]}
const studio={schemaVersion:1,id:studioId,title:'Turbo smoke',color:'#333333',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',backgroundColor:'#27415a',backgroundAssetId:null,backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,assets:[],elements:[narrator],videoTimeline:timeline}
const bootstrap={jobId,snapshot:{studio,timeline,frameRate:60,durationFrames:totalFrames},characters:{schemaVersion:1,characters:[]},characterAssets:{schemaVersion:1,entries:[]},renderVariant:'static-characters'}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor','1')
app.commandLine.appendSwitch('disable-background-timer-throttling')

app.whenReady().then(async()=>{
  requireTool(ffmpeg,'FFmpeg');requireTool(ffprobe,'FFprobe')
  const raw=loadTs('electron/videoRawFrameWriter.ts')
  const pixels=loadTs('electron/videoPixelFormat.ts')
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gacha-v5-turbo-smoke-'))
  const windows=new Set()
  const sessions=new Map()
  let failure=null
  const timeout=setTimeout(()=>finish(new Error('Turbo smoke excedeu 120 segundos.')),120000)

  function cleanup(){
    clearTimeout(timeout)
    for(const w of windows)if(!w.isDestroyed())w.destroy()
    try{ipcMain.removeHandler('video-studio:export-surface:prepare')}catch{}
    ipcMain.removeAllListeners('video-studio:export-surface:ready')
    ipcMain.removeAllListeners('video-studio:export-surface:frame-ready')
    fs.rmSync(root,{recursive:true,force:true})
  }
  function finish(error){
    if(failure)return
    failure=error||new Error('finished')
    cleanup()
    if(error){console.error(error.stack||error.message);app.exit(1)}else app.exit(0)
  }

  ipcMain.handle('video-studio:export-surface:prepare',(event,id)=>{
    if(id!==jobId||!sessions.has(event.sender.id))throw new Error('Sender Turbo inválido.')
    return bootstrap
  })
  ipcMain.on('video-studio:export-surface:ready',(event,ready)=>{
    const s=sessions.get(event.sender.id)
    if(!s)return
    if(ready.error){s.reject(new Error(ready.error));return}
    s.ready=true;s.request()
  })
  ipcMain.on('video-studio:export-surface:frame-ready',(event,ready)=>{
    const s=sessions.get(event.sender.id)
    if(!s||ready.requestId!==`${s.name}-${s.frame}`)return
    if(ready.error){s.reject(new Error(ready.error));return}
    s.chain=s.chain.then(async()=>{
      if(!(ready.pixels instanceof Uint8Array))throw new Error('Surface Turbo não devolveu pixels.')
      await s.writer.writeFrame(pixels.rgbaToBgra(ready.pixels))
      s.frame++
      if(s.frame<s.end)s.request()
      else{
        await s.writer.finish()
        s.resolve()
      }
    }).catch(s.reject)
  })

  async function createWorker(name,start,end){
    const output=path.join(root,`${name}.mp4`)
    const writer=new raw.VideoRawFrameWriter({
      executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(output,end-start,'bgra','h264_mf'),
      outputPath:output,frameBytes:width*height*4,frameCount:end-start,
    })
    await writer.ready()
    const win=new BrowserWindow({show:false,width,height,useContentSize:true,backgroundColor:'#000',webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}})
    windows.add(win)
    let resolve,reject
    const done=new Promise((res,rej)=>{resolve=res;reject=rej})
    const session={name,frame:start,end,writer,ready:false,chain:Promise.resolve(),resolve,reject,request(){win.webContents.send('video-studio:export-surface:render',{requestId:`${name}-${this.frame}`,frame:this.frame})}}
    sessions.set(win.webContents.id,session)
    win.webContents.on('render-process-gone',(_e,d)=>reject(new Error(`${name} renderer: ${d.reason}`)))
    await win.loadFile(rendererFile,{hash:`/video-export-surface?jobId=${jobId}`})
    return {done,output,win}
  }

  try{
    const [a,b]=await Promise.all([createWorker('worker-a',0,60),createWorker('worker-b',60,120)])
    await Promise.all([a.done,b.done])
    a.win.destroy();b.win.destroy()
    const list=path.join(root,'concat.txt')
    fs.writeFileSync(list,`file '${a.output.replace(/\\/g,'/')}'\nfile '${b.output.replace(/\\/g,'/')}'\n`)
    const final=path.join(root,'turbo-final.mp4')
    run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-an','-movflags','+faststart',final])
    const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration','-of','json',final]))
    const stream=probe.streams?.[0]
    if(!stream||stream.codec_name!=='h264'||stream.width!==width||stream.height!==height||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==totalFrames)throw new Error(`Turbo concat inválido: ${JSON.stringify(probe)}`)
    run(ffmpeg,['-v','error','-i',final,'-f','null','-'])
    console.log(JSON.stringify({ok:true,workers:2,frames:totalFrames,bytes:fs.statSync(final).size,stream}))
    finish()
  }catch(error){finish(error)}
}).catch((error)=>{console.error(error.stack||error.message);app.exit(1)})
