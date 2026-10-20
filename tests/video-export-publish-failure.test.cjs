'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const realFs=require('node:fs/promises')
const fsSync=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const ts=require('typescript')

function loadLibraryWithFailingWrite(code='ENOSPC',message='synthetic disk full'){
  const source=fsSync.readFileSync(path.resolve(__dirname,'../electron/videoExports.ts'),'utf8')
  const compiled=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022})
  const fakeFs={...realFs,writeFile:async(file,...args)=>{
    if(String(file).includes('.tmp')){
      const error=new Error(message);error.code=code;throw error
    }
    return realFs.writeFile(file,...args)
  }}
  const mod={exports:{}}
  new Function('require','module','exports',compiled)((name)=>name==='node:fs/promises'?fakeFs:require(name),mod,mod.exports)
  return mod.exports.VideoExportLibrary
}
const projectId='360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const jobId='f3c40c08-5be8-476f-8132-4dafca4f3d57'
const exportId='006e1fc0-24ea-43ac-8edb-33a46d95fc06'

test('ENOSPC while publishing metadata rolls MP4 back into job and publishes nothing',async(t)=>{
  const root=await realFs.mkdtemp(path.join(os.tmpdir(),'gv5-publish-enospc-'))
  t.after(()=>realFs.rm(root,{recursive:true,force:true}))
  const Library=loadLibraryWithFailingWrite()
  const library=new Library(root)
  const job=path.join(library.jobRoot,jobId)
  await realFs.mkdir(job,{recursive:true})
  const source=path.join(job,'final.mp4')
  const payload=Buffer.from('validated-final-video-before-publish')
  await realFs.writeFile(source,payload)
  await assert.rejects(()=>library.finalize(jobId,{
    id:exportId,studioId:projectId,studioTitle:'ENOSPC Fixture',width:1920,height:1080,
    frameRate:60,durationFrames:60,videoCodec:'h264',audioCodec:null
  }),/synthetic disk full/)
  assert.deepEqual(await realFs.readFile(source),payload,'validated final is restored to the recoverable job')
  const projectFolder=path.join(library.exportRoot,projectId)
  const published=await realFs.readdir(projectFolder).catch(()=>[])
  assert.deepEqual(published,[],'no mp4 or sidecar remains published after rollback')
})


test('EACCES while publishing metadata restores validated MP4 and leaves no partial export',async(t)=>{
  const root=await realFs.mkdtemp(path.join(os.tmpdir(),'gv5-publish-eacces-'))
  t.after(()=>realFs.rm(root,{recursive:true,force:true}))
  const Library=loadLibraryWithFailingWrite('EACCES','synthetic permission denied')
  const library=new Library(root)
  const job=path.join(library.jobRoot,jobId)
  await realFs.mkdir(job,{recursive:true})
  const source=path.join(job,'final.mp4')
  const payload=Buffer.from('validated-final-video-before-permission-failure')
  await realFs.writeFile(source,payload)

  await assert.rejects(()=>library.finalize(jobId,{
    id:exportId,studioId:projectId,studioTitle:'Permission Fixture',width:1920,height:1080,
    frameRate:60,durationFrames:60,videoCodec:'h264',audioCodec:null
  }),/synthetic permission denied/)

  assert.deepEqual(await realFs.readFile(source),payload)
  const projectFolder=path.join(library.exportRoot,projectId)
  const published=await realFs.readdir(projectFolder).catch(()=>[])
  assert.deepEqual(published,[])
})
