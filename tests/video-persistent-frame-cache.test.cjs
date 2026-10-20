'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoPersistentFrameCache.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)(require,mod,mod.exports)
const {VideoPersistentFrameCache,VIDEO_RENDERER_CACHE_VERSION}=mod.exports

test('persistent semantic cache survives a new instance and returns exact bytes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-persistent-cache-'))
  try{
    const pixels=Buffer.alloc(1920*16*4,7)
    const cold=new VideoPersistentFrameCache(root,64*1024*1024)
    assert.equal(await cold.get('scene-a',pixels.length),undefined)
    await cold.set('scene-a',pixels)
    const warm=new VideoPersistentFrameCache(root,64*1024*1024)
    assert.deepEqual(await warm.get('scene-a',pixels.length),pixels)
    const stats=await warm.stats()
    assert.equal(stats.hits,1)
    assert.equal(stats.entries,1)
    assert.equal(typeof VIDEO_RENDERER_CACHE_VERSION,'string')
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('corrupt persistent entries fail closed and are removed',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-persistent-corrupt-'))
  try{
    const pixels=Buffer.alloc(1024*1024,11)
    const cache=new VideoPersistentFrameCache(root,64*1024*1024)
    await cache.set('scene-corrupt',pixels)
    const frameDir=path.join(root,'frames')
    const file=fs.readdirSync(frameDir)[0]
    fs.writeFileSync(path.join(frameDir,file),Buffer.from('corrupt'))
    assert.equal(await cache.get('scene-corrupt',pixels.length),undefined)
    assert.equal(fs.existsSync(path.join(frameDir,file)),false)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('persistent cache enforces disk budget and repair removes interrupted temp files',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-persistent-budget-'))
  try{
    const cache=new VideoPersistentFrameCache(root,64*1024*1024)
    for(let i=0;i<20;i++){
      const pixels=Buffer.alloc(4*1024*1024)
      for(let j=0;j<pixels.length;j+=4096)pixels[j]=(i+j)%251
      await cache.set('scene-'+i,pixels)
    }
    fs.mkdirSync(path.join(root,'frames'),{recursive:true})
    fs.writeFileSync(path.join(root,'frames','.interrupted.tmp'),'x')
    await cache.repair()
    const stats=await cache.stats()
    assert.ok(stats.bytes<=stats.maxBytes)
    assert.equal(fs.existsSync(path.join(root,'frames','.interrupted.tmp')),false)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('persistent cache rejects a frame whose authenticated RGBA checksum no longer matches',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-persistent-sha-'))
  try{
    const pixels=Buffer.alloc(512*1024,23)
    const cache=new VideoPersistentFrameCache(root,64*1024*1024)
    await cache.set('scene-authenticated',pixels)
    const frameDir=path.join(root,'frames')
    const file=path.join(frameDir,fs.readdirSync(frameDir)[0])
    const bytes=fs.readFileSync(file)
    // Keep the compressed payload intact and corrupt only the persisted SHA-256.
    // The legacy sparse rolling checksum could not provide this full-frame guarantee.
    bytes[8]^=0xff
    fs.writeFileSync(file,bytes)
    assert.equal(await cache.get('scene-authenticated',pixels.length),undefined)
    assert.equal(fs.existsSync(file),false)
    assert.match(VIDEO_RENDERER_CACHE_VERSION,/sha256/)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})


test('separate cache instances serialize mutations against the same root',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-persistent-concurrent-root-'))
  try{
    const a=new VideoPersistentFrameCache(root,64*1024*1024)
    const b=new VideoPersistentFrameCache(root,64*1024*1024)
    const pixelsA=Buffer.alloc(2*1024*1024,31)
    const pixelsB=Buffer.alloc(2*1024*1024,47)
    await Promise.all([
      a.set('scene-concurrent-a',pixelsA),
      b.set('scene-concurrent-b',pixelsB),
    ])
    const reopened=new VideoPersistentFrameCache(root,64*1024*1024)
    assert.deepEqual(await reopened.get('scene-concurrent-a',pixelsA.length),pixelsA)
    assert.deepEqual(await reopened.get('scene-concurrent-b',pixelsB.length),pixelsB)
    const stats=await reopened.stats()
    assert.equal(stats.entries,2)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
