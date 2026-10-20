'use strict'
const {spawn,execFileSync}=require('node:child_process')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const ffmpeg=process.env.GACHA_FFMPEG_PATH,ffprobe=process.env.GACHA_FFPROBE_PATH
const run=(exe,args)=>execFileSync(exe,args,{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:16*1024*1024})
async function waitForBytes(file,min,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){const s=await fs.promises.stat(file).catch(()=>null);if(s?.isFile()&&s.size>=min)return s.size;await new Promise(r=>setTimeout(r,100))}throw new Error('MP4 fragmentado não cresceu antes do timeout.')}
async function main(){
 if(!ffmpeg||!ffprobe||!path.isAbsolute(ffmpeg)||!path.isAbsolute(ffprobe))throw new Error('FFmpeg/ffprobe absolutos obrigatórios.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-hybrid-recovery-')),broken=path.join(root,'broken.mp4'),recovered=path.join(root,'recovered.mp4')
 let child
 try{
  child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-re','-f','lavfi','-i','testsrc2=size=640x360:rate=60','-an','-c:v','h264_mf','-b:v','3M','-pix_fmt','yuv420p','-movflags','+hybrid_fragmented','-f','mp4',broken],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']})
  let stderr='';child.stderr.on('data',x=>stderr=(stderr+String(x)).slice(-12000))
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
  const bytesBeforeKill=await waitForBytes(broken,128*1024)
  child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve))
  const interrupted=JSON.parse(run(ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate','-of','json',broken]))
  if(interrupted.streams?.[0]?.codec_name!=='h264')throw new Error('MP4 interrompido não ficou legível. '+stderr)
  run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-i',broken,'-map','0:v:0','-c:v','copy','-movflags','+faststart','-f','mp4',recovered])
  const probe=JSON.parse(run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames','-of','json',recovered]))
  const s=probe.streams?.[0],frames=Number(s?.nb_read_frames)
  if(s?.codec_name!=='h264'||Number(s.width)!==640||Number(s.height)!==360||s.r_frame_rate!=='60/1'||!Number.isSafeInteger(frames)||frames<10)throw new Error('MP4 recuperado inválido: '+JSON.stringify(s))
  run(ffmpeg,['-hide_banner','-loglevel','error','-xerror','-i',recovered,'-map','0:v:0','-f','null','-'])
  console.log(JSON.stringify({ok:true,bytesBeforeKill,recoveredBytes:fs.statSync(recovered).size,decodedFrames:frames}))
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null)try{child.kill('SIGKILL')}catch{}
  fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})
 }
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1})
