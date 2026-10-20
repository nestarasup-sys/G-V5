'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const fsp=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

function loadEncoder(capture){
  const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoSerialChunkEncoder.ts'),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  class FakeWriter{
    constructor(options){this.options=options;capture.writerOptions=options;capture.frames=[]}
    async ready(){}
    async writeFrame(frame){capture.onWrite?.();capture.frames.push(Buffer.from(frame));if(capture.writeDelayMs)await new Promise(resolve=>setTimeout(resolve,capture.writeDelayMs))}
    async finish(){
      await fsp.writeFile(this.options.outputPath,Buffer.from('synthetic-mp4'))
      return{code:0,stderr:'',bytesWritten:capture.frames.reduce((n,b)=>n+b.length,0),framesWritten:capture.frames.length,writeCallbackWaitMs:0,peakInFlight:1}
    }
    async cancel(){}
  }
  const fakeRaw={
    VideoRawFrameWriter:FakeWriter,
    buildVideoStudioChunkArgs:(outputPath,frameCount,pixelFormat,videoEncoder)=>{
      capture.pixelFormat=pixelFormat;capture.videoEncoder=videoEncoder
      return['-fake',outputPath,String(frameCount),pixelFormat,videoEncoder]
    }
  }
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name==='./videoRawFrameWriter'?fakeRaw:require(name),mod,mod.exports)
  return mod.exports
}

test('serial chunk encoder declares RGBA and forwards renderer bytes unchanged',async(t)=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'gv5-serial-rgba-'))
  t.after(()=>fsp.rm(root,{recursive:true,force:true}))
  const output=path.join(root,'chunk.mp4')
  const capture={}
  const {encodeVideoStudioSerialChunk}=loadEncoder(capture)
  const rgba=Buffer.alloc(1920*1080*4)
  rgba[0]=10;rgba[1]=20;rgba[2]=30;rgba[3]=255
  const ffmpeg={executable:path.resolve(process.execPath),smokeEncoded:true,videoEncoder:'h264_mf'}
  const result=await encodeVideoStudioSerialChunk({
    ffmpeg,outputPath:output,startFrame:0,endFrameExclusive:1,width:1920,height:1080,frameRate:60
  },async()=>rgba)
  assert.equal(capture.pixelFormat,'rgba')
  assert.equal(capture.videoEncoder,'h264_mf')
  assert.equal(capture.frames.length,1)
  assert.equal(capture.frames[0][0],10)
  assert.equal(capture.frames[0][1],20)
  assert.equal(capture.frames[0][2],30)
  assert.equal(capture.frames[0][3],255)
  assert.equal(result.frameCount,1)
})

test('serial chunk encoder does not accept malformed renderer frame sizes',async(t)=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'gv5-serial-rgba-size-'))
  t.after(()=>fsp.rm(root,{recursive:true,force:true}))
  const capture={}
  const {encodeVideoStudioSerialChunk}=loadEncoder(capture)
  const ffmpeg={executable:path.resolve(process.execPath),smokeEncoded:true,videoEncoder:'h264_mf'}
  await assert.rejects(()=>encodeVideoStudioSerialChunk({
    ffmpeg,outputPath:path.join(root,'chunk.mp4'),startFrame:0,endFrameExclusive:1
  },async()=>Buffer.alloc(4)),/esperava/)
})


test('serial chunk encoder keeps exactly one render ahead while writer is busy',async(t)=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'gv5-serial-lookahead-'))
  t.after(()=>fsp.rm(root,{recursive:true,force:true}))
  const capture={writeDelayMs:20}
  let rendersStarted=0
  const observed=[]
  capture.onWrite=()=>observed.push(rendersStarted)
  const {encodeVideoStudioSerialChunk}=loadEncoder(capture)
  const ffmpeg={executable:path.resolve(process.execPath),smokeEncoded:true,videoEncoder:'h264_mf'}
  await encodeVideoStudioSerialChunk({
    ffmpeg,outputPath:path.join(root,'chunk.mp4'),startFrame:0,endFrameExclusive:3
  },async()=>{
    rendersStarted++
    return Buffer.alloc(1920*1080*4,9)
  })
  assert.deepEqual(observed,[2,3,3],'next frame render starts before current writer callback completes')
  assert.equal(capture.frames.length,3)
})
