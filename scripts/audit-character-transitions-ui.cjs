const { app, BrowserWindow } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { resolve, join } = require('node:path')
const assert = require('node:assert/strict')

const output = resolve('out/audit-character-transitions-ui')
app.setPath('userData', join(output, 'profile'))
app.setPath('sessionData', join(output, 'session'))
const entry = `
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TransitionRenderer } from '../../src/renderer/src/features/videoStudio/transitionRenderer'
import { useCharacterTransitions } from '../../src/renderer/src/features/videoStudio/useCharacterTransitions'
import { prepareSavedCharacterRenderer } from '../../src/renderer/src/features/customizer/CustomizerPage'
import { faceRenderGeometry, trimTransparentImage } from '../../src/renderer/src/features/videoStudio/characterGeometry'
function image(width, height, draw) { const c=document.createElement('canvas'); c.width=width;c.height=height;draw(c.getContext('2d'));return c.toDataURL('image/png') }
const skin=image(100,100,c=>{c.fillStyle='#f9dec5';c.fillRect(0,0,100,100)})
const eye=image(30,16,c=>{c.fillStyle='white';c.strokeStyle='#302025';c.lineWidth=2;c.beginPath();c.ellipse(15,8,14,7,0,0,Math.PI*2);c.fill();c.stroke()})
const pupil=image(12,12,c=>{c.fillStyle='#76401f';c.beginPath();c.arc(6,6,6,0,Math.PI*2);c.fill()})
const brow=image(28,4,c=>{c.fillStyle='#422522';c.fillRect(0,0,28,4)})
const mouth=image(18,7,c=>{c.fillStyle='#b73d59';c.fillRect(0,0,18,7)})
const part=(id,name,x,y,width,height,rotation=0)=>({id,name,x,y,width,height,rotation,dataUrl:skin})
const model={schemaVersion:1,slot:1,name:'Fixture',sourceName:'Fixture',sourceAssetName:'Fixture',sourceDataUrl:skin,width:300,height:500,tolerance:0,parts:[part('head','Cabeça',100,0,100,100),part('torso','Tronco',125,110,50,100),part('arm','Braço',175,110,20,100)],joints:[{id:'joint',parentPartId:'torso',childPartId:'arm',parentAnchor:{x:185,y:120},childAnchor:{x:185,y:120}}],layerOrder:['torso','arm','head'],hiddenPartIds:[],updatedAt:'2026-10-17T00:00:00Z'}
const pose={...model,slot:2,sourceModelSlot:1,sourceModelName:'Fixture',sourceModelUpdatedAt:model.updatedAt,parts:[model.parts[0],model.parts[1],part('arm','Braço',135,70,20,100,90)]}
const component=(id,kind,dataUrl,width,height,x,y,scaleX=1,scaleY=1)=>({schemaVersion:1,id,modelSlot:1,name:id,kind,dataUrl,width,height,updatedAt:model.updatedAt,defaultTransform:{x,y,scaleX,scaleY,rotation:0}})
const components={eye:component('eye','eye-left',eye,30,16,30,45),pupil:component('pupil','pupil-left',pupil,12,12,0,0,.4,.4),brow:component('brow','brow-left',brow,28,4,30,30)}
const mouthItem={schemaVersion:1,id:'mouth',modelSlot:1,name:'Mouth',category:'mouth-closed',width:100,height:100,transforms:{mouth:{x:50,y:76,scaleX:1,scaleY:1,rotation:0}},pieces:[{id:'m0',index:0,sheet:'mouth-closed',dataUrl:mouth,width:18,height:7},{id:'m1',index:1,sheet:'mouth-closed',dataUrl:mouth,width:18,height:7}],updatedAt:model.updatedAt}
const sources=JSON.stringify({model,pose,components,mouthItem})
window.desktop={loadFabricatorSlot:async()=>model,loadFabricatorPose:async()=>pose,listFaceExpressionPresets:async()=>[],loadFaceComponentAsset:async(_,id)=>components[id]??null,loadFaceCatalogItem:async(_,id)=>id==='mouth'?mouthItem:null,listFaceCatalog:async()=>[],listFaceComponentAssets:async()=>[],loadWardrobeSet:async()=>null}
const appearance={modelSlot:1,components:{'eye-left':{assetId:'eye'},'pupil-left':{assetId:'pupil'},'brow-left':{assetId:'brow'}},mouthClosedCatalogId:'mouth',eyeState:0,eyebrows:true,noseIndex:0,expressionIndex:0,mouthOpen:false,mouthBlushEnabled:true}
const character={schemaVersion:1,id:'actor',name:'Fixture',createdAt:model.updatedAt,updatedAt:model.updatedAt,customization:{modelSlot:1,poseSlot:null,partOverrides:{},layerOrder:[],faceAppearance:appearance}}
const neutral={enabled:false,color:'#e86388',opacity:0,softness:.5,size:.2,offsetY:0}
const effects={shadow:{...neutral,enabled:true,color:'#322342',opacity:.6},blush:{...neutral,enabled:true,opacity:.4},mouthBlush:{...neutral,enabled:true,opacity:.5,width:.3,height:.1,rotation:15}}
const override=sourceTransformOverride=>({x:0,y:0,width:100,height:100,rotation:0,sourceTransformOverride})
const transforms={'expression-component:eye-left':override({...components.eye.defaultTransform,x:48,y:40,rotation:20}),'expression-component:pupil-left':override({...components.pupil.defaultTransform,x:3,y:2}),'expression-component:brow-left':override({...components.brow.defaultTransform,y:25,rotation:18}),'expression:mouth-closed:mouth':override({...mouthItem.transforms.mouth,y:72,scaleX:1.3})}
const base={id:'element',characterId:character.id,kind:'character',text:'Fixture',x:0,y:0,width:20,height:50,characterCanvasWidth:30,rotation:0,zIndex:0,poseSlot:null,faceAppearance:appearance,activeFaceMode:'idle',activeExpressionPresetId:null}
window.auditPromise=(async()=>{
  const sourceRenderer=await prepareSavedCharacterRenderer(character)
  const fromRendered=await sourceRenderer.render(appearance)
  const explicit=await prepareSavedCharacterRenderer(character,{source:model,artwork:model})
  if((await explicit.render(appearance)).dataUrl!==fromRendered.dataUrl)throw Error('Default renderer changed with the additive source API')
  const targetAppearance={...appearance,expressionIndex:1}
  const targetCharacter={...character,customization:{...character.customization,poseSlot:2,faceAppearance:targetAppearance}}
  const toRendered=await (await prepareSavedCharacterRenderer(targetCharacter)).render(targetAppearance,transforms,effects,'idle')
  const fromCrop=await trimTransparentImage(fromRendered.dataUrl),toCrop=await trimTransparentImage(toRendered.dataUrl)
  const from={element:{...base,...faceRenderGeometry(base,fromRendered,fromCrop,1920,1080)},imageDataUrl:fromCrop?.dataUrl??fromRendered.dataUrl}
  const to={element:{...base,...faceRenderGeometry(base,toRendered,toCrop,1920,1080),poseSlot:2,faceAppearance:targetAppearance,faceTransforms:transforms,activeExpressionEffects:effects,activeExpressionPresetId:'indignada'},imageDataUrl:toCrop?.dataUrl??toRendered.dataUrl}
  const span={elementId:'element',startFrame:165,boundaryFrame:180,from,to}
  const engine=new TransitionRenderer()
  const middle=await engine.render(span,172.5,character)
  const sample60fps=await engine.render(span,179,character)
  if(Math.abs(middle.element.faceTransforms['expression-component:eye-left'].sourceTransformOverride.x-39)>1e-7)throw Error('Base did not resolve supplier eye calibration')
  if(Math.abs(middle.element.activeExpressionEffects.shadow.opacity-.3)>1e-7)throw Error('Shadow does not interpolate')
  if(middle.imageDataUrl===from.imageDataUrl||middle.imageDataUrl===to.imageDataUrl)throw Error('No intermediate artwork')
  if((await engine.render(span,180,character))!==to)throw Error('Wrong exact boundary state')
  if((await engine.render(span,165,character))!==from)throw Error('Wrong exact start state')
  const states=[];const errors=[]
  const studio={id:'script-fixture',elements:[from.element],assets:[],videoTimeline:{schemaVersion:1,frameRate:60,durationFrames:600,characterBases:{element:from},characterKeys:[{id:'key',elementId:'element',frame:180,state:to}],characterGaps:[]}}
  const characters=[character]
  const onError=message=>errors.push(message)
  function Probe(){const result=useCharacterTransitions(studio,characters,179,true,onError);React.useEffect(()=>{if(result.samples.has('element'))states.push(result.samples.get('element'))},[result.samples]);return null}
  const root=createRoot(document.getElementById('probe'));root.render(React.createElement(StrictMode,null,React.createElement(Probe)))
  const until=Date.now()+45000;while(!states.length&&Date.now()<until&&!errors.length)await new Promise(r=>setTimeout(r,30))
  root.unmount();if(errors.length)throw Error(errors.join('; '));if(!states.length)throw Error('StrictMode transition cache did not publish an animation frame')
  if(JSON.stringify({model,pose,components,mouthItem})!==sources)throw Error('Supplier documents were mutated')
  const panel=document.getElementById('artwork');for(const [label,state]of[['Base / pose 1',from],['Transição / pose interpolada',middle],['Indignada / pose 2',to]]){const card=document.createElement('article');const title=document.createElement('h2');title.textContent=label;const img=new Image();img.src=state.imageDataUrl;await img.decode();card.append(title,img);panel.append(card)}
  return {timingMs:250,fps:60,outputSamples:[179],supplierCalibration:true,bodyAndFaceInterpolated:true,shadowInterpolated:true,strictModeCache:true,sourceUnchanged:true,intermediateBytes:sample60fps.imageDataUrl.length}
})()
`

;(async () => {
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'entry.ts'), entry)
  const { build } = await import('vite')
  await build({ configFile: false, define: { 'process.env.NODE_ENV': JSON.stringify('development') }, logLevel: 'warn', root: process.cwd(), build: { outDir: join(output, 'bundle'), emptyOutDir: false, lib: { entry: join(output, 'entry.ts'), name: 'TransitionAudit', formats: ['iife'], fileName: () => 'audit.js' }, rollupOptions: { output: { inlineDynamicImports: true } } } })
  await writeFile(join(output, 'index.html'), '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#141a26;color:white;font:14px system-ui}h1{font-size:21px}#artwork{display:flex;gap:18px}article{width:260px;padding:12px;background:#303f54;border-radius:12px}h2{font-size:14px}img{width:100%;height:380px;object-fit:contain}</style><h1>Video Studio · transição real de corpo, rosto e efeitos</h1><div id="artwork"></div><div id="probe"></div><script src="./bundle/audit.js"></script></html>')
  await app.whenReady()
  const window = new BrowserWindow({ width: 960, height: 580, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  window.webContents.on('console-message', (event) => console.log('renderer:', event.message))
  window.webContents.on('preload-error', (_event, _path, error) => console.error(error))
  await window.loadFile(join(output, 'index.html'))
  const result = await window.webContents.executeJavaScript('window.auditPromise')
  assert.equal(result.strictModeCache, true)
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await writeFile(join(output, 'artwork.png'), (await window.webContents.capturePage()).toPNG())
  console.log(JSON.stringify(result))
  window.destroy(); app.exit(0)
})().catch((error) => { console.error(error); app.exit(1) })
