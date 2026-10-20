'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const ffmpeg = process.env.GACHA_FFMPEG_PATH
const ffprobe = process.env.GACHA_FFPROBE_PATH

function requireTool(value,label) {
  if (!value || !path.isAbsolute(value) || !fs.existsSync(value)) throw new Error(`${label} absoluto é obrigatório.`)
  return value
}
function run(executable,args,encoding='utf8') {
  return execFileSync(executable,args,{encoding,timeout:240000,windowsHide:true,maxBuffer:64*1024*1024})
}
function loadTs(relativePath,deps={}) {
  const source=fs.readFileSync(path.resolve(__dirname,'../..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name in deps?deps[name]:require(name),mod,mod.exports)
  return mod.exports
}
function rms(samples,startSecond,endSecond) {
  const sampleRate=48000, channels=2
  const start=Math.floor(startSecond*sampleRate)*channels
  const end=Math.min(samples.length,Math.floor(endSecond*sampleRate)*channels)
  let sum=0,count=0
  for(let i=start;i<end;i+=channels){
    const left=samples[i],right=samples[i+1]
    sum+=left*left+right*right
    count+=2
  }
  return count?Math.sqrt(sum/count):0
}

async function main(){
  requireTool(ffmpeg,'GACHA_FFMPEG_PATH')
  requireTool(ffprobe,'GACHA_FFPROBE_PATH')
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gacha-v5-audio-assembly-'))
  const videoChunk=path.join(root,'chunk-000000.mp4')
  const sourceMedia=path.join(root,'source-audio.mp4')
  const output=path.join(root,'final.mp4')
  try{
    run(ffmpeg,[
      '-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','color=c=#203040:s=1920x1080:r=60:d=5',
      '-an','-c:v','h264_mf','-b:v','4M','-pix_fmt','yuv420p','-frames:v','300',
      '-movflags','+faststart',videoChunk
    ])
    run(ffmpeg,[
      '-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','testsrc2=size=320x180:rate=60:duration=4',
      '-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=4',
      '-shortest','-c:v','mpeg4','-q:v','5','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',sourceMedia
    ])

    const videoAudio=loadTs('src/shared/videoAudio.ts')
    const audioPlan=loadTs('src/shared/videoStudioAudioPlan.ts',{'./videoAudio':videoAudio})
    const rawWriter=loadTs('electron/videoRawFrameWriter.ts')
    const capabilities=loadTs('electron/videoFfmpegCapabilities.ts',{'./videoRawFrameWriter':rawWriter})
    const assembler=loadTs('electron/videoExportAssembler.ts',{
      '../src/shared/videoStudioAudioPlan':audioPlan,
      './videoFfmpegCapabilities':capabilities,
    })
    const verifier=loadTs('electron/videoOutputVerifier.ts',{'./videoFfmpegCapabilities':capabilities})
    const cap={
      executable:ffmpeg,versionLine:'fixture',buildConfiguration:'',encoderList:'',
      videoEncoder:'h264_mf',audioEncoder:'aac',smokeEncoded:true,
    }
    const timeline={
      schemaVersion:1,frameRate:60,durationFrames:300,playheadFrame:0,playing:false,
      characterKeys:[],textClips:[],saveMarkers:[],
      videoAudio:{volume:1,muted:false},
      videoClips:[{
        id:'audio-clip',assetId:'source-audio',
        startFrame:60,endFrame:180,sourceStartFrame:30,sourceEndFrame:150,
        audio:{volume:0.5,muted:false}
      }],
    }
    const media=new Map([['source-audio',{path:sourceMedia,hasAudio:true}]])
    const assembled=await assembler.assembleVideoStudioOutput({
      ffmpeg:cap,
      chunks:[{index:0,startFrame:0,endFrameExclusive:300,path:videoChunk}],
      timeline,media,outputPath:output,tempRoot:root,timeoutMs:180000,
    })
    if(!assembled.audio) throw new Error('Assembler não habilitou áudio para a fixture audível.')
    const verified=await verifier.verifyVideoStudioOutput({
      ffprobeExecutable:ffprobe,ffmpegExecutable:ffmpeg,outputPath:output,
      expected:{width:1920,height:1080,frameRate:60,durationFrames:300,audio:true},
      timeoutMs:180000,
    })
    const timingProbe=JSON.parse(run(ffprobe,[
      '-v','error','-show_entries','stream=codec_type,start_time,duration,sample_rate,channels','-of','json',output
    ]))
    const audioStream=timingProbe.streams?.find((stream)=>stream.codec_type==='audio')
    if(!audioStream)throw new Error('FFprobe não encontrou stream de áudio para validar timing.')
    const pcm=run(ffmpeg,[
      '-v','error','-i',output,'-map','0:a:0',
      '-af','aresample=48000:first_pts=0',
      '-f','s16le','-acodec','pcm_s16le','-ar','48000','-ac','2','-'
    ],null)
    const bytes=Buffer.from(pcm)
    const samples=new Int16Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/2))
    const before=rms(samples,0.1,0.8)
    const active=rms(samples,1.2,2.8)
    const after=rms(samples,3.2,4.7)
    if(before>25) throw new Error(`Áudio apareceu antes do clip: RMS=${before}`)
    if(active<100) throw new Error(`Áudio não apareceu no intervalo do clip: RMS=${active}`)
    if(after>25) throw new Error(`Áudio continuou depois do clip: RMS=${after}`)
    console.log(JSON.stringify({ok:true,verified,audioStream,rms:{before,active,after},outputBytes:fs.statSync(output).size}))
  }finally{
    fs.rmSync(root,{recursive:true,force:true})
  }
}

main().catch((error)=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1})
