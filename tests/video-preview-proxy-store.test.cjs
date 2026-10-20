'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

function load(deps={}){
  const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoPreviewProxyStore.ts'),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name in deps?deps[name]:require(name),mod,mod.exports)
  return mod.exports
}

test('preview proxy store keys derivatives by source SHA and reuses them warm',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-proxy-'))
  const source=path.join(root,'source.mp4')
  fs.writeFileSync(source,Buffer.alloc(8192,3))
  let calls=0
  const mod=load({'./videoFfmpegCapabilities':{
    runVideoStudioProcess:async(_exe,args)=>{
      calls++
      const out=args.at(-1)
      if(args.includes('showwavespic=s=1200x120:colors=white')) fs.writeFileSync(out,Buffer.alloc(256,4))
      else fs.writeFileSync(out,Buffer.alloc(2048,5))
      return {code:0,stdout:'',stderr:''}
    }
  }})
  const store=new mod.VideoPreviewProxyStore(path.join(root,'cache'))
  const ffmpeg={executable:path.resolve(process.execPath),videoEncoder:'h264_mf',smokeEncoded:true}
  try{
    const first=await store.ensure({sourcePath:source,ffmpeg})
    assert.equal(first.proxyFilename,'preview.mp4')
    assert.equal(first.waveformFilename,'waveform.png')
    const firstCalls=calls
    const second=await store.ensure({sourcePath:source,ffmpeg})
    assert.deepEqual(second,first)
    assert.equal(calls,firstCalls,'warm proxy does not invoke FFmpeg again')
    assert.equal(await store.resolveFile(first.sourceSha256,'proxy'),path.join(root,'cache',first.sourceSha256.slice(0,2),first.sourceSha256,'preview.mp4'))
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
