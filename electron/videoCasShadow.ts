import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SHA=/^[a-f0-9]{64}$/

export async function sha256File(path:string):Promise<string>{
  const hash=createHash('sha256')
  await new Promise<void>((resolvePromise,reject)=>{
    const stream=createReadStream(path)
    stream.on('data',(chunk)=>hash.update(chunk))
    stream.once('error',reject)
    stream.once('end',resolvePromise)
  })
  return hash.digest('hex')
}

/**
 * Non-destructive global CAS shadow. Callers continue using their legacy files;
 * this store only materializes a verified content-addressed twin.
 */
export class VideoCasShadow {
  constructor(readonly root:string){ this.root=resolve(root) }

  objectPath(sha:string):string{
    if(!SHA.test(sha)) throw new Error('SHA CAS inválido.')
    return join(this.root,'objects',sha.slice(0,2),sha)
  }

  async mirror(sourcePath:string,expectedSha?:string):Promise<{sha256:string;path:string;bytes:number;reused:boolean}>{
    const source=resolve(sourcePath)
    const info=await stat(source)
    if(!info.isFile()||info.size<1) throw new Error('Fonte CAS inválida.')
    const sha=await sha256File(source)
    if(expectedSha&&expectedSha!==sha) throw new Error('Fonte mudou antes de entrar no CAS shadow.')
    const destination=this.objectPath(sha)
    const existing=await lstat(destination).catch(()=>null)
    if(existing){
      if(!existing.isFile()||existing.isSymbolicLink()||existing.size!==info.size) throw new Error('Objeto CAS existente é incompatível.')
      return {sha256:sha,path:destination,bytes:info.size,reused:true}
    }
    await mkdir(join(this.root,'objects',sha.slice(0,2)),{recursive:true})
    const temp=`${destination}.${randomUUID()}.tmp`
    try{
      await copyFile(source,temp,constants.COPYFILE_EXCL)
      const copied=await stat(temp)
      if(copied.size!==info.size||await sha256File(temp)!==sha) throw new Error('Cópia CAS não passou pela verificação.')
      try{ await rename(temp,destination) }
      catch(reason){
        if((reason as NodeJS.ErrnoException).code!=='EEXIST') throw reason
      }
    }finally{ await rm(temp,{force:true}).catch(()=>undefined) }
    const final=await stat(destination)
    if(!final.isFile()||final.size!==info.size) throw new Error('Objeto CAS final inválido.')
    return {sha256:sha,path:destination,bytes:info.size,reused:false}
  }

  async verify(sha:string,expectedBytes:number):Promise<boolean>{
    if(!SHA.test(sha)||!Number.isSafeInteger(expectedBytes)||expectedBytes<1) return false
    const path=this.objectPath(sha)
    const info=await lstat(path).catch(()=>null)
    if(!info?.isFile()||info.isSymbolicLink()||info.size!==expectedBytes) return false
    return await sha256File(path)===sha
  }
}
