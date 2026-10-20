'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const source=fs.readFileSync(path.resolve(__dirname,'../src/renderer/src/features/videoStudio/videoPreviewSeekScheduler.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)(require,mod,mod.exports)
const {VideoPreviewSeekScheduler}=mod.exports

test('preview seek scheduler applies only the newest target in a burst',()=>{
  const callbacks=[]
  const applied=[]
  const scheduler=new VideoPreviewSeekScheduler((callback)=>callbacks.push(callback))
  const a=scheduler.request(1,task=>applied.push(task))
  const b=scheduler.request(2,task=>applied.push(task))
  const c=scheduler.request(3,task=>applied.push(task))
  assert.equal(callbacks.length,1)
  callbacks.shift()()
  assert.deepEqual(applied,[{targetSeconds:3,requestId:c}])
  assert.equal(scheduler.isCurrent(a),false)
  assert.equal(scheduler.isCurrent(b),false)
  assert.equal(scheduler.isCurrent(c),true)
})

test('preview seek scheduler cancel/dispose invalidates queued work',()=>{
  const callbacks=[]
  const applied=[]
  const scheduler=new VideoPreviewSeekScheduler((callback)=>callbacks.push(callback))
  const id=scheduler.request(4,task=>applied.push(task))
  scheduler.cancel()
  callbacks.shift()()
  assert.deepEqual(applied,[])
  assert.equal(scheduler.isCurrent(id),false)

  scheduler.request(5,task=>applied.push(task))
  scheduler.dispose()
  callbacks.shift()()
  assert.deepEqual(applied,[])
})
