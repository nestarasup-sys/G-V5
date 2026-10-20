'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const source=fs.readFileSync(path.resolve(__dirname,'../electron/videoExportCoordinator.ts'),'utf8')
const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
const mod={exports:{}}
new Function('require','module','exports',compiled)((name)=>{
  if(name.startsWith('node:'))return require(name)
  return {}
},mod,mod.exports)
const {VideoExportCoordinator}=mod.exports

const jobId='f3c40c08-5be8-476f-8132-4dafca4f3d57'
const reopened={
  manifest:{renderVariant:'animated',chunks:[],durationFrames:60,chunkFrames:600},
  snapshot:{studio:{id:'360d7ac8-27c8-4aab-b8be-2397e1c46a76',title:'fixture',videoTimeline:{durationFrames:60}}},
  characters:{characters:[]},
  characterAssets:{schemaVersion:1,entries:[]},
}

test('failed job drains its old task then resumes the persisted checkpoint in the same session',async()=>{
  const order=[]
  const jobs={reopen:async(id)=>{order.push('reopen');assert.equal(id,jobId);return reopened}}
  const coordinator=new VideoExportCoordinator(jobs,{}, {}, async()=>{}, ()=>{})
  let release
  const task=new Promise(resolve=>{release=()=>{order.push('old-task-finished');resolve()}})
  coordinator.active.set(jobId,{
    jobId,variant:'animated',controller:new AbortController(),
    progress:{jobId,stage:'failed',renderVariant:'animated',completedFrames:0,totalFrames:60},
    surfaces:new Set(),task,
  })
  coordinator.run=async()=>{}
  const pending=coordinator.resume(jobId)
  await Promise.resolve()
  assert.deepEqual(order,[],'reopen waits for terminal task cleanup')
  release()
  assert.equal(await pending,jobId)
  assert.deepEqual(order,['old-task-finished','reopen'])
  assert.equal(coordinator.status(jobId).stage,'queued')
})

test('completed job is never reopened as recovery',async()=>{
  let reopenedCount=0
  const jobs={reopen:async()=>{reopenedCount++;return reopened}}
  const coordinator=new VideoExportCoordinator(jobs,{}, {}, async()=>{}, ()=>{})
  coordinator.active.set(jobId,{
    jobId,variant:'animated',controller:new AbortController(),
    progress:{jobId,stage:'done',renderVariant:'animated',completedFrames:60,totalFrames:60},
    surfaces:new Set(),task:Promise.resolve(),
  })
  await assert.rejects(()=>coordinator.resume(jobId),/concluída/)
  assert.equal(reopenedCount,0)
})


test('terminal history can be forgotten but an active job cannot be evicted',()=>{
  const coordinator=new VideoExportCoordinator({},{}, {}, async()=>{}, ()=>{})
  coordinator.active.set(jobId,{
    jobId,variant:'animated',controller:new AbortController(),
    progress:{jobId,stage:'failed',renderVariant:'animated',completedFrames:0,totalFrames:60},
    surfaces:new Set(),task:Promise.resolve(),
  })
  coordinator.forgetTerminal(jobId)
  assert.equal(coordinator.status(jobId),null)

  coordinator.active.set(jobId,{
    jobId,variant:'animated',controller:new AbortController(),
    progress:{jobId,stage:'rendering',renderVariant:'animated',completedFrames:1,totalFrames:60},
    surfaces:new Set(),task:Promise.resolve(),
  })
  assert.throws(()=>coordinator.forgetTerminal(jobId),/ainda está ativo/)
  assert.equal(coordinator.status(jobId).stage,'rendering')
})
