'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoExportAutoTuner.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)(require,mod,mod.exports)
const {chooseVideoExportWorkerCount,videoExportWorkerOverride}=mod.exports
const GiB=1024**3
const base={pendingChunks:4,durationFrames:3600,logicalCpuCount:12,totalMemoryBytes:16*GiB,freeMemoryBytes:8*GiB,videoEncoder:'h264_mf'}

test('autotuner promotes two workers only with enough chunks CPU and memory',()=>{
  assert.equal(chooseVideoExportWorkerCount(base).workerCount,2)
  assert.equal(chooseVideoExportWorkerCount({...base,pendingChunks:1}).workerCount,1)
  assert.equal(chooseVideoExportWorkerCount({...base,durationFrames:600}).workerCount,1)
  assert.equal(chooseVideoExportWorkerCount({...base,logicalCpuCount:4}).workerCount,1)
  assert.equal(chooseVideoExportWorkerCount({...base,freeMemoryBytes:2*GiB}).workerCount,1)
  assert.equal(chooseVideoExportWorkerCount({...base,totalMemoryBytes:6*GiB}).workerCount,1)
  assert.deepEqual(chooseVideoExportWorkerCount({...base,sceneComplexityUnits:12}),{workerCount:1,reason:'complex scene memory guard'})
  assert.equal(chooseVideoExportWorkerCount({...base,sceneComplexityUnits:11}).workerCount,2)
})

test('diagnostic worker override is explicit and bounded',()=>{
  assert.equal(chooseVideoExportWorkerCount({...base,overrideWorkers:1}).workerCount,1)
  assert.equal(chooseVideoExportWorkerCount({...base,pendingChunks:1,overrideWorkers:2}).workerCount,2)
  assert.equal(videoExportWorkerOverride('1'),1)
  assert.equal(videoExportWorkerOverride('2'),2)
  assert.equal(videoExportWorkerOverride('3'),undefined)
  assert.equal(videoExportWorkerOverride(undefined),undefined)
})
