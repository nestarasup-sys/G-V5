'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoSemanticFrameCache.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)(require,mod,mod.exports)
const {VideoSemanticFrameCache}=mod.exports

test('semantic frame cache reuses non-consecutive keys and updates LRU order',()=>{
  const cache=new VideoSemanticFrameCache(8*1024*1024)
  const a=Buffer.alloc(1024,1),b=Buffer.alloc(1024,2),c=Buffer.alloc(1024,3)
  cache.set('a',a);cache.set('b',b)
  assert.equal(cache.get('a'),a)
  cache.set('c',c)
  assert.equal(cache.get('b'),b)
  assert.equal(cache.get('a'),a)
  const stats=cache.stats()
  assert.equal(stats.hits,3)
  assert.equal(stats.misses,0)
  assert.equal(stats.entries,3)
})

test('semantic frame cache evicts oldest entries by byte budget and reports misses',()=>{
  const cache=new VideoSemanticFrameCache(8*1024*1024)
  const frame=Buffer.alloc(3*1024*1024)
  cache.set('a',frame)
  cache.set('b',Buffer.from(frame))
  assert.equal(cache.get('a')?.length,frame.length,'touch a so b becomes oldest')
  cache.set('c',Buffer.from(frame))
  assert.equal(cache.get('b'),undefined)
  assert.equal(cache.get('a')?.length,frame.length)
  assert.equal(cache.get('c')?.length,frame.length)
  const stats=cache.stats()
  assert.equal(stats.evictions,1)
  assert.equal(stats.misses,1)
  assert.ok(stats.bytes<=stats.maxBytes)
})

test('semantic frame cache refuses an individual entry larger than its full budget',()=>{
  const cache=new VideoSemanticFrameCache(8*1024*1024)
  cache.set('huge',Buffer.alloc(8*1024*1024+4))
  assert.equal(cache.get('huge'),undefined)
  assert.equal(cache.stats().entries,0)
})
