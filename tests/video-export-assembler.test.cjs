'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const fsp=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

function loadAssembler(runProcess){
  const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoExportAssembler.ts'),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  const audioPlan={
    buildVideoStudioAudioPlan:()=>({enabled:false,inputArgs:[],filterComplex:null,outputArgs:['-an']})
  }
  new Function('require','module','exports',compiled)((name)=>{
    if(name==='./videoFfmpegCapabilities')return{runVideoStudioProcess:runProcess}
    if(name==='../src/shared/videoStudioAudioPlan')return audioPlan
    return require(name)
  },mod,mod.exports)
  return mod.exports
}

const ffmpeg={executable:path.resolve(process.execPath),smokeEncoded:true,videoEncoder:'h264_mf',audioEncoder:'aac'}
const timeline={schemaVersion:1,frameRate:60,durationFrames:120,videoAssets:[],videoClips:[],characterBases:{},characterKeys:[],textClips:[],masterAudio:{muted:false,volume:1}}

async function fixture(){
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'gv5-assembler-failure-'))
  const chunks=[0,1].map(index=>({
    index,startFrame:index*60,endFrameExclusive:(index+1)*60,path:path.join(root,`chunk-${index}.mp4`)
  }))
  for(const chunk of chunks)await fsp.writeFile(chunk.path,Buffer.alloc(256,chunk.index+1))
  return{root,chunks,output:path.join(root,'final.mp4')}
}

test('assembler never promotes final.mp4 when concat fails',async(t)=>{
  const fx=await fixture();t.after(()=>fsp.rm(fx.root,{recursive:true,force:true}))
  const {assembleVideoStudioOutput}=loadAssembler(async()=>({code:1,stdout:'',stderr:'synthetic concat crash'}))
  await assert.rejects(()=>assembleVideoStudioOutput({
    ffmpeg,chunks:fx.chunks,timeline,media:new Map(),outputPath:fx.output,tempRoot:fx.root
  }),/Concatenação/)
  await assert.rejects(fsp.stat(fx.output),{code:'ENOENT'})
  const names=await fsp.readdir(fx.root)
  assert.deepEqual(names.sort(),['chunk-0.mp4','chunk-1.mp4'])
})

test('assembler removes mux temp and preserves prior canonical final when mux is cancelled',async(t)=>{
  const fx=await fixture();t.after(()=>fsp.rm(fx.root,{recursive:true,force:true}))
  const old=Buffer.from('previous-recoverable-final')
  await fsp.writeFile(fx.output,old)
  let calls=0
  const {assembleVideoStudioOutput}=loadAssembler(async(_exe,args)=>{
    calls++
    const out=args.at(-1)
    if(calls===1){
      await fsp.writeFile(out,Buffer.alloc(512,4))
      return{code:0,stdout:'',stderr:''}
    }
    await fsp.writeFile(out,Buffer.alloc(512,5))
    throw new Error('synthetic mux cancelled')
  })
  await assert.rejects(()=>assembleVideoStudioOutput({
    ffmpeg,chunks:fx.chunks,timeline,media:new Map(),outputPath:fx.output,tempRoot:fx.root
  }),/synthetic mux cancelled/)
  assert.deepEqual(await fsp.readFile(fx.output),old)
  const names=await fsp.readdir(fx.root)
  assert.equal(names.some(name=>name.includes('.assemble-')),false)
  assert.equal(names.some(name=>name.startsWith('gacha-video-assemble-')),false)
})

test('assembler promotes only a completed mux temp to canonical final.mp4',async(t)=>{
  const fx=await fixture();t.after(()=>fsp.rm(fx.root,{recursive:true,force:true}))
  let calls=0
  const {assembleVideoStudioOutput}=loadAssembler(async(_exe,args)=>{
    calls++
    const out=args.at(-1)
    await fsp.writeFile(out,Buffer.alloc(calls===1?512:768,calls))
    return{code:0,stdout:'',stderr:''}
  })
  const result=await assembleVideoStudioOutput({
    ffmpeg,chunks:fx.chunks,timeline,media:new Map(),outputPath:fx.output,tempRoot:fx.root
  })
  assert.equal(result.outputPath,fx.output)
  assert.equal(result.outputBytes,768)
  assert.equal((await fsp.stat(fx.output)).size,768)
  const names=await fsp.readdir(fx.root)
  assert.equal(names.some(name=>name.includes('.assemble-')),false)
  assert.equal(names.some(name=>name.startsWith('gacha-video-assemble-')),false)
})
