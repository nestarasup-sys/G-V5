'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

function load(relativePath,deps={}){
  const source=fs.readFileSync(path.resolve(__dirname,'..',relativePath),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name in deps?deps[name]:require(name),mod,mod.exports)
  return mod.exports
}
const cas=load('electron/videoCasShadow.ts')

test('CAS shadow deduplicates identical bytes without removing legacy source',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-cas-'))
  try{
    const a=path.join(root,'a.mp4'),b=path.join(root,'b.mp4')
    fs.writeFileSync(a,Buffer.alloc(4096,7))
    fs.writeFileSync(b,Buffer.alloc(4096,7))
    const store=new cas.VideoCasShadow(path.join(root,'cas'))
    const first=await store.mirror(a)
    const second=await store.mirror(b)
    assert.equal(first.sha256,second.sha256)
    assert.equal(second.reused,true)
    assert.equal(await store.verify(first.sha256,4096),true)
    assert.equal(fs.existsSync(a),true)
    assert.equal(fs.existsSync(b),true)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('CAS shadow detects mismatched expected hash and corrupted objects',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv5-cas-corrupt-'))
  try{
    const source=path.join(root,'source.bin')
    fs.writeFileSync(source,Buffer.from('hello-cas'))
    const store=new cas.VideoCasShadow(path.join(root,'cas'))
    await assert.rejects(()=>store.mirror(source,'0'.repeat(64)),/mudou/)
    const mirrored=await store.mirror(source)
    fs.writeFileSync(mirrored.path,Buffer.from('corrupt'))
    assert.equal(await store.verify(mirrored.sha256,9),false)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
