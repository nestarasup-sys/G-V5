import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runVideoStudioProcess, type VideoStudioFfmpegCapabilities } from './videoFfmpegCapabilities'

export const VIDEO_PREVIEW_PROXY_VERSION = 'proxy-540p30-v1'

export type VideoPreviewProxyRecord = Readonly<{
  schemaVersion: 1
  profileVersion: typeof VIDEO_PREVIEW_PROXY_VERSION
  sourceSha256: string
  sourceBytes: number
  proxyBytes: number
  proxyFilename: string
  waveformFilename: string | null
  createdAt: string
}>

const SHA = /^[a-f0-9]{64}$/

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise,reject)=>{
    const stream=createReadStream(path)
    stream.on('data',(chunk)=>hash.update(chunk))
    stream.once('error',reject)
    stream.once('end',resolvePromise)
  })
  return hash.digest('hex')
}

export class VideoPreviewProxyStore {
  constructor(readonly root: string) {}

  private folderFor(sha: string): string {
    if(!SHA.test(sha)) throw new Error('SHA de proxy inválido.')
    return join(this.root,sha.slice(0,2),sha)
  }
  private manifestPath(sha:string){ return join(this.folderFor(sha),'manifest.json') }

  async read(sha: string): Promise<VideoPreviewProxyRecord | null> {
    if(!SHA.test(sha)) throw new Error('SHA de proxy inválido.')
    try{
      const record=JSON.parse(await readFile(this.manifestPath(sha),'utf8')) as VideoPreviewProxyRecord
      if(record.schemaVersion!==1||record.profileVersion!==VIDEO_PREVIEW_PROXY_VERSION||record.sourceSha256!==sha
        ||record.proxyFilename!=='preview.mp4'||(record.waveformFilename!==null&&record.waveformFilename!=='waveform.png')
        ||!Number.isSafeInteger(record.sourceBytes)||record.sourceBytes<1||!Number.isSafeInteger(record.proxyBytes)||record.proxyBytes<1) return null
      const proxy=await stat(join(this.folderFor(sha),record.proxyFilename)).catch(()=>null)
      if(!proxy?.isFile()||proxy.size!==record.proxyBytes) return null
      if(record.waveformFilename){
        const wave=await stat(join(this.folderFor(sha),record.waveformFilename)).catch(()=>null)
        if(!wave?.isFile()||wave.size<1) return null
      }
      return record
    }catch(reason){
      if((reason as NodeJS.ErrnoException).code==='ENOENT') return null
      return null
    }
  }

  async ensure(input:{
    sourcePath:string
    ffmpeg:VideoStudioFfmpegCapabilities
    signal?:AbortSignal
    timeoutMs?:number
  }):Promise<VideoPreviewProxyRecord>{
    const sourcePath=resolve(input.sourcePath)
    const source=await stat(sourcePath)
    if(!source.isFile()||source.size<1) throw new Error('Fonte do proxy de preview está ausente.')
    const sha=await hashFile(sourcePath)
    const existing=await this.read(sha)
    if(existing) return existing

    const folder=this.folderFor(sha)
    await mkdir(folder,{recursive:true})
    const proxyTemp=join(folder,`.preview-${randomUUID()}.tmp.mp4`)
    const waveTemp=join(folder,`.waveform-${randomUUID()}.tmp.png`)
    const proxyFinal=join(folder,'preview.mp4')
    const waveFinal=join(folder,'waveform.png')
    const timeoutMs=Math.max(30_000,Math.min(30*60_000,input.timeoutMs??10*60_000))
    try{
      const proxy=await runVideoStudioProcess(input.ffmpeg.executable,[
        '-hide_banner','-loglevel','error','-nostdin','-y','-i',sourcePath,
        '-map','0:v:0','-map','0:a:0?',
        '-vf',"scale=w='min(960,iw)':h=-2:flags=bicubic,fps=30",
        '-c:v',input.ffmpeg.videoEncoder,'-b:v','3M','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','96k','-ar','48000','-ac','2',
        '-movflags','+faststart','-f','mp4',proxyTemp
      ],{timeoutMs,signal:input.signal})
      if(proxy.code!==0) throw new Error(`Falha ao criar proxy de preview. ${proxy.stderr}`)
      const proxyInfo=await stat(proxyTemp)
      if(!proxyInfo.isFile()||proxyInfo.size<128) throw new Error('Proxy de preview saiu vazio.')
      await rename(proxyTemp,proxyFinal).catch(async(reason)=>{
        if((reason as NodeJS.ErrnoException).code==='EEXIST') await rm(proxyTemp,{force:true})
        else throw reason
      })

      let waveformFilename:string|null=null
      const wave=await runVideoStudioProcess(input.ffmpeg.executable,[
        '-hide_banner','-loglevel','error','-nostdin','-y','-i',sourcePath,
        '-map','0:a:0?','-filter_complex','aformat=channel_layouts=mono,showwavespic=s=1200x120:colors=white',
        '-frames:v','1','-f','image2',waveTemp
      ],{timeoutMs,signal:input.signal}).catch(()=>null)
      if(wave?.code===0){
        const info=await stat(waveTemp).catch(()=>null)
        if(info?.isFile()&&info.size>0){
          await rename(waveTemp,waveFinal).catch(async(reason)=>{
            if((reason as NodeJS.ErrnoException).code==='EEXIST') await rm(waveTemp,{force:true})
            else throw reason
          })
          waveformFilename='waveform.png'
        }
      }

      const finalInfo=await stat(proxyFinal)
      const record:VideoPreviewProxyRecord={
        schemaVersion:1,profileVersion:VIDEO_PREVIEW_PROXY_VERSION,sourceSha256:sha,
        sourceBytes:source.size,proxyBytes:finalInfo.size,proxyFilename:'preview.mp4',
        waveformFilename,createdAt:new Date().toISOString()
      }
      const manifestTemp=join(folder,`.manifest-${randomUUID()}.tmp`)
      await writeFile(manifestTemp,`${JSON.stringify(record,null,2)}\n`,{flag:'wx'})
      await rename(manifestTemp,this.manifestPath(sha))
      return record
    }finally{
      await rm(proxyTemp,{force:true}).catch(()=>undefined)
      await rm(waveTemp,{force:true}).catch(()=>undefined)
    }
  }

  async resolveFile(sha:string,kind:'proxy'|'waveform'):Promise<string>{
    const record=await this.read(sha)
    if(!record) throw new Error('Derivado de preview não encontrado.')
    if(kind==='waveform'&&!record.waveformFilename) throw new Error('Waveform indisponível.')
    return join(this.folderFor(sha),kind==='proxy'?record.proxyFilename:record.waveformFilename!)
  }
}
