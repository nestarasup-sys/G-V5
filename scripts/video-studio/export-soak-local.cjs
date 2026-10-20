'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')

const ffmpeg=process.env.GACHA_FFMPEG_PATH
const ffprobe=process.env.GACHA_FFPROBE_PATH
const seconds=Number(process.env.GACHA_SOAK_SECONDS || process.argv[2] || 90)
const encoder=process.env.GACHA_H264_ENCODER || 'h264_mf'
const width=1920,height=1080,fps=60,chunkFrames=600

function requireTool(v,name){if(!v||!path.isAbsolute(v)||!fs.existsSync(v))throw new Error(`${name} absoluto é obrigatório.`)}
function run(exe,args,encoding='utf8'){return execFileSync(exe,args,{encoding,timeout:30*60*1000,windowsHide:true,maxBuffer:32*1024*1024})}
function loadTs(relativePath){
  const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)(require,mod,mod.exports)
  return mod.exports
}

async function main(){
  requireTool(ffmpeg,'GACHA_FFMPEG_PATH');requireTool(ffprobe,'GACHA_FFPROBE_PATH')
  if(!Number.isSafeInteger(seconds)||![90,900].includes(seconds))throw new Error('Soak aceita apenas 90 ou 900 segundos.')
  const raw=loadTs('electron/videoRawFrameWriter.ts')
  if(!raw.videoStudioH264EncoderPreference.includes(encoder))throw new Error(`Encoder não aceito: ${encoder}`)
  const totalFrames=seconds*fps
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`gacha-v5-soak-${seconds}s-`))
  const rgba=Buffer.alloc(width*height*4)
  // Non-black frame catches truncated/zero input while remaining semantically static.
  for(let i=0;i<rgba.length;i+=4){rgba[i]=31;rgba[i+1]=67;rgba[i+2]=101;rgba[i+3]=255}
  let peakRss=process.memoryUsage().rss
  let encodedBytes=0
  let rawBytes=0
  const chunks=[]
  const started=performance.now()
  try{
    const count=Math.ceil(totalFrames/chunkFrames)
    for(let index=0;index<count;index++){
      const start=index*chunkFrames,end=Math.min(totalFrames,start+chunkFrames),frames=end-start
      const output=path.join(root,`chunk-${String(index).padStart(6,'0')}.mp4`)
      const writer=new raw.VideoRawFrameWriter({
        executable:ffmpeg,args:raw.buildVideoStudioChunkArgs(output,frames,'rgba',encoder),
        outputPath:output,frameBytes:rgba.length,frameCount:frames,
      })
      await writer.ready()
      for(let frame=0;frame<frames;frame++)await writer.writeFrame(rgba,{copy:false})
      const result=await writer.finish()
      rawBytes+=result.bytesWritten
      encodedBytes+=fs.statSync(output).size
      chunks.push(output)
      peakRss=Math.max(peakRss,process.memoryUsage().rss)
      console.log(JSON.stringify({stage:'chunk',index:index+1,count,framesDone:end,elapsedMs:performance.now()-started,rss:process.memoryUsage().rss}))
    }
    const concat=path.join(root,'concat.txt')
    fs.writeFileSync(concat,chunks.map(file=>`file '${file.replace(/\\/g,'/')}'`).join('\n')+'\n')
    const final=path.join(root,`soak-${seconds}s.mp4`)
    run(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concat,'-c','copy','-an','-movflags','+faststart',final])
    const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration','-of','json',final]))
    const stream=probe.streams?.[0]
    if(!stream||stream.codec_name!=='h264'||stream.width!==width||stream.height!==height||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==totalFrames)throw new Error(`Soak inválido: ${JSON.stringify(probe)}`)
    run(ffmpeg,['-v','error','-i',final,'-f','null','-'])
    const elapsedMs=performance.now()-started
    console.log(JSON.stringify({
      ok:true,seconds,totalFrames,encoder,chunks:chunks.length,elapsedMs,
      throughputFps:totalFrames/(elapsedMs/1000),
      realtimeFactor:seconds/(elapsedMs/1000),
      rawBytes,rawGiB:rawBytes/1024**3,encodedBytes,finalBytes:fs.statSync(final).size,
      peakRss,stream,
    },null,2))
  }finally{
    fs.rmSync(root,{recursive:true,force:true})
  }
}

main().catch(error=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1})
