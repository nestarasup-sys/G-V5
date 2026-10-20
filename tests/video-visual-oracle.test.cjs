'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const source=fs.readFileSync(path.resolve(__dirname,'../src/shared/videoVisualOracle.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)(require,mod,mod.exports)

test('pixel oracle reports exact equality',()=>{
  const a=Uint8Array.from([1,2,3,255,4,5,6,255])
  const result=mod.exports.comparePixelBuffers(a,a,2,1)
  assert.deepEqual(result,{pixels:2,changedPixels:0,changedPixelRatio:0,meanAbsoluteError:0,p95AbsoluteError:0,maxChannelError:0,maxAbsoluteError:0,differenceBounds:null})
})

test('pixel oracle isolates ROI and ignores alpha channel',()=>{
  const a=Uint8Array.from([
    0,0,0,0, 10,20,30,255,
    0,0,0,255, 10,20,30,0,
  ])
  const b=Uint8Array.from([
    255,255,255,255, 10,20,30,0,
    255,255,255,0, 20,20,30,255,
  ])
  const result=mod.exports.comparePixelBuffers(a,b,2,2,{x:1,y:0,width:1,height:2})
  assert.equal(result.pixels,2)
  assert.equal(result.changedPixels,1)
  assert.equal(result.changedPixelRatio,0.5)
  assert.equal(result.maxAbsoluteError,10)
  assert.equal(result.maxChannelError,10)
  assert.deepEqual(result.differenceBounds,{x:1,y:1,width:1,height:1})
})

test('pixel oracle can ignore one-channel rounding when counting changed pixels while retaining raw error metrics',()=>{
  const left=Uint8Array.from([10,10,10,255,20,20,20,255])
  const right=Uint8Array.from([11,10,10,255,22,20,20,255])
  const exact=mod.exports.comparePixelBuffers(left,right,2,1)
  const tolerant=mod.exports.comparePixelBuffers(left,right,2,1,undefined,1)
  assert.equal(exact.changedPixelRatio,1)
  assert.equal(tolerant.changedPixelRatio,.5)
  assert.equal(tolerant.meanAbsoluteError,exact.meanAbsoluteError)
  assert.equal(tolerant.maxChannelError,exact.maxChannelError)
})
