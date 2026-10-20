'use strict'

const now='2026-01-01T00:00:00.000Z'
const defaults={
  jobId:'31d7e0d9-6fd8-4cd0-b07a-272615882451',
  studioId:'94152e4f-6a3e-4f18-b38f-ec9eead01573',
  assetId:'58aa83fd-f989-4a5a-a1c8-d76bb148c671',
  characterId:'synthetic-character',
  actorId:'synthetic-actor',
}

async function svgPng(width,height,body){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  const png=await require('sharp')(Buffer.from(svg)).png({palette:false}).toBuffer()
  if(!png.length)throw new Error('Não foi possível criar PNG sintético.')
  return 'data:image/png;base64,'+png.toString('base64')
}
function part(id,name,x,y,w,h,dataUrl,rotation=0){return{id,name,x,y,width:w,height:h,dataUrl,rotation}}
function faceAsset(id,kind,name,x,y,w,h,dataUrl,rightSidePositioned=false,pairId){
  return{schemaVersion:1,id,modelSlot:1,kind,name,width:w,height:h,defaultTransform:{x,y,scaleX:1,scaleY:1,rotation:0},rightSidePositioned,pairId,updatedAt:now,dataUrl}
}
function catalog(id,category,name,pieceUrl,pieceW,pieceH,transform){
  return{schemaVersion:1,id,modelSlot:1,category,name,
    sheet:{kind:category,name,width:pieceW,height:pieceH,tolerance:0,dataUrl:pieceUrl},
    pieces:[{id:id+'-piece',sheet:category,index:0,crop:{x:0,y:0,width:pieceW,height:pieceH},width:pieceW,height:pieceH,dataUrl:pieceUrl}],
    transforms:{mouth:transform},eyeLinked:true,browLinked:true,selectedNose:0,selectedExpression:0,updatedAt:now}
}
function summaryComponent(asset){const{defaultTransform,dataUrl,...summary}=asset;return summary}
function summaryCatalog(item){return{id:item.id,modelSlot:item.modelSlot,category:item.category,name:item.name,updatedAt:item.updatedAt,pieceCount:item.pieces.length}}

/** The same complete synthetic character/media fixture used by the visual oracle. */
async function createCharacterMediaFixture(options={}){
  const {jobId,studioId,assetId,characterId,actorId}= {...defaults,...options}
  const durationFrames=options.durationFrames??300
  if(!Number.isSafeInteger(durationFrames)||durationFrames<300)throw new Error('A fixture de personagem exige no mínimo 300 frames.')
  const background=await svgPng(640,360,'<rect width="640" height="360" fill="#203247"/><rect width="320" height="360" fill="#29435f"/><circle cx="500" cy="60" r="32" fill="#4e718d"/>')
  const head=await svgPng(100,100,'<rect width="100" height="100" rx="30" fill="#f0bb8e"/><rect x="4" y="4" width="92" height="92" rx="27" fill="none" stroke="#5b3c2c" stroke-width="6"/>')
  const torso=await svgPng(110,160,'<rect x="5" y="5" width="100" height="150" rx="25" fill="#7957c8"/><path d="M20 70h70" stroke="#eadfff" stroke-width="12"/>')
  const eyeLeft=faceAsset('eye-left-open','eye','Olho esquerdo aberto',30,38,24,14,await svgPng(24,14,'<ellipse cx="12" cy="7" rx="11" ry="6" fill="white"/><circle cx="12" cy="7" r="4" fill="#14233c"/>'),true,'pair-left')
  const eyeRight=faceAsset('eye-right-open','eye','Olho direito aberto',70,38,24,14,await svgPng(24,14,'<ellipse cx="12" cy="7" rx="11" ry="6" fill="white"/><circle cx="12" cy="7" r="4" fill="#14233c"/>'),true,'pair-right')
  const eyeLeftClosed=faceAsset('eye-left-closed','eye-closed','Olho esquerdo fechado',30,38,24,8,await svgPng(24,8,'<path d="M1 4 Q12 8 23 4" fill="none" stroke="#36251f" stroke-width="3"/>'),true,'pair-left')
  const eyeRightClosed=faceAsset('eye-right-closed','eye-closed','Olho direito fechado',70,38,24,8,await svgPng(24,8,'<path d="M1 4 Q12 8 23 4" fill="none" stroke="#36251f" stroke-width="3"/>'),true,'pair-right')
  const mouthClosedPng=await svgPng(34,12,'<path d="M2 6 Q17 10 32 6" fill="none" stroke="#8a3150" stroke-width="4"/>')
  const mouthOpenPng=await svgPng(36,22,'<ellipse cx="18" cy="11" rx="15" ry="9" fill="#6b1835"/><ellipse cx="18" cy="14" rx="8" ry="3" fill="#ef789b"/>')
  const mouthClosed=catalog('mouth-closed','mouth-closed','Boca fechada',mouthClosedPng,34,12,{x:50,y:72,scaleX:1,scaleY:1,rotation:0})
  const mouthOpen=catalog('mouth-open','mouth-open','Boca aberta',mouthOpenPng,36,22,{x:50,y:72,scaleX:1,scaleY:1,rotation:0})

  const model={schemaVersion:1,slot:1,name:'Modelo sintético',sourceName:'synthetic',sourceAssetName:'synthetic.png',sourceDataUrl:head,width:200,height:300,tolerance:0,
    parts:[part('torso','Torso',45,125,110,160,torso),part('head','Cabeça',50,15,100,100,head)],joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}
  const pose1={schemaVersion:1,slot:1,name:'Pose 1',sourceModelSlot:1,sourceModelName:model.name,sourceModelUpdatedAt:now,width:200,height:300,
    parts:model.parts.map(x=>({...x})),joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}
  const pose2={schemaVersion:1,slot:2,name:'Pose 2',sourceModelSlot:1,sourceModelName:model.name,sourceModelUpdatedAt:now,width:200,height:300,
    parts:[part('torso','Torso',35,125,110,160,torso,-8),part('head','Cabeça',72,20,100,100,head,12)],joints:[],layerOrder:['torso','head'],hiddenPartIds:[],updatedAt:now}
  const faceAppearance={modelSlot:1,components:{'eye-left':{assetId:eyeLeft.id},'eye-right':{assetId:eyeRight.id}},mouthClosedCatalogId:mouthClosed.id,mouthOpenCatalogId:mouthOpen.id,
    eyeState:0,eyebrows:false,noseIndex:0,expressionIndex:0,mouthOpen:false}
  const baseElement={id:actorId,kind:'character',characterId,poseSlot:1,faceAppearance,text:'Synthetic',x:-18,y:0,width:20,height:48,rotation:0,zIndex:5,characterCanvasWidth:20}
  const nextElement={...baseElement,poseSlot:2,x:-14,y:1,faceAppearance:{...faceAppearance,expressionIndex:1}}
  const authored1=await svgPng(200,300,'<rect x="45" y="125" width="110" height="160" rx="25" fill="#7957c8"/><rect x="50" y="15" width="100" height="100" rx="30" fill="#f0bb8e"/><circle cx="82" cy="55" r="6" fill="#14233c"/><circle cx="118" cy="55" r="6" fill="#14233c"/><path d="M84 85 Q100 94 116 85" stroke="#8a3150" stroke-width="5" fill="none"/>')
  const authored2=await svgPng(200,300,'<g transform="rotate(-8 90 205)"><rect x="35" y="125" width="110" height="160" rx="25" fill="#7957c8"/></g><g transform="rotate(12 122 70)"><rect x="72" y="20" width="100" height="100" rx="30" fill="#f0bb8e"/><circle cx="102" cy="58" r="6" fill="#14233c"/><circle cx="138" cy="58" r="6" fill="#14233c"/><path d="M104 88 Q120 97 136 88" stroke="#8a3150" stroke-width="5" fill="none"/></g>')
  const baseState={imageDataUrl:authored1,element:baseElement}
  const nextState={imageDataUrl:authored2,element:nextElement}
  const narrator={id:'narrator-oracle',kind:'narrator',text:'Narrador: ação, você e coração',x:0,y:-38,width:42,height:12,rotation:0,zIndex:3}
  const speech={id:'speech-oracle',kind:'speech',speakerCharacterId:actorId,speakerName:'Synthetic',speakerColor:'#7957c8',text:'Falando no oracle',x:-5,y:35,width:28,height:13,rotation:0,zIndex:6}
  const thought={id:'thought-oracle',kind:'thought',speakerCharacterId:actorId,speakerName:'Synthetic',speakerColor:'#7957c8',text:'Pensamento sintético',x:34,y:25,width:23,height:13,rotation:0,zIndex:6}
  const extension={id:'extension-oracle',kind:'image',assetId:'@g-v5-fixture:extension-box',text:'Extensão V546',x:32,y:-6,width:10,height:10,rotation:0,zIndex:7}
  const timeline={schemaVersion:1,frameRate:60,durationFrames,playheadFrame:0,playing:false,animateCharacterTransitions:true,
    characterBases:{[actorId]:baseState},characterKeys:[{id:'pose-change',elementId:actorId,frame:30,poseSlot:2,expressionCollectionId:null,expressionPresetId:null,faceMode:'idle',state:nextState}],
    textClips:[{id:'narrator-clip',elementId:narrator.id,kind:'narrator',startFrame:0,endFrame:durationFrames},{id:'speech-clip',elementId:speech.id,kind:'speech',startFrame:50,endFrame:90},{id:'thought-clip',elementId:thought.id,kind:'thought',startFrame:0,endFrame:Math.min(150,durationFrames)}],
    characterTransforms:{[actorId]:{x:-14,y:1,rotation:2,characterScale:100,characterWidthScale:100,characterHeightScale:100,zIndex:5}},
    videoAssets:[{id:assetId,name:'synthetic-video.mp4',mimeType:'video/mp4',extension:'mp4',size:1,durationFrames}],
    videoClips:[{id:'synthetic-video-clip',assetId,startFrame:0,endFrame:durationFrames,sourceStartFrame:0,sourceEndFrame:durationFrames,transform:{x:25,y:-10,width:30,height:28,rotation:4}}],saveMarkers:[]}
  const studio={schemaVersion:1,id:studioId,title:'Synthetic Character Media Fixture',color:'#333',createdAt:now,updatedAt:now,
    backgroundColor:'#203247',backgroundAssetId:'oracle-background',backgroundX:0,backgroundY:0,backgroundWidth:100,backgroundHeight:100,backgroundRotation:0,
    assets:[{id:'oracle-background',category:'background',name:'Synthetic background',mimeType:'image/png',dataUrl:background}],elements:[baseElement,narrator,speech,thought,extension],videoTimeline:timeline}
  const character={id:characterId,name:'Synthetic',hair:'',outfit:'',skin:'',createdAt:now,updatedAt:now,
    customization:{modelSlot:1,poseSlot:1,partOverrides:{},layerOrder:[],faceAppearance}}
  const entries=[
    {method:'loadFabricatorSlot',args:[1],value:model},
    {method:'loadFabricatorPose',args:[1,1],value:pose1},
    {method:'loadFabricatorPose',args:[1,2],value:pose2},
    {method:'loadFaceComponentAsset',args:[1,eyeLeft.id],value:eyeLeft},
    {method:'loadFaceComponentAsset',args:[1,eyeRight.id],value:eyeRight},
    {method:'loadFaceComponentAsset',args:[1,eyeLeftClosed.id],value:eyeLeftClosed},
    {method:'loadFaceComponentAsset',args:[1,eyeRightClosed.id],value:eyeRightClosed},
    {method:'listFaceComponentAssets',args:[1,'eye-closed'],value:[summaryComponent(eyeLeftClosed),summaryComponent(eyeRightClosed)]},
    {method:'listFaceCatalog',args:[1],value:[summaryCatalog(mouthClosed),summaryCatalog(mouthOpen)]},
    {method:'loadFaceCatalogItem',args:[1,mouthClosed.id],value:mouthClosed},
    {method:'loadFaceCatalogItem',args:[1,mouthOpen.id],value:mouthOpen},
    {method:'listFaceExpressionPresets',args:[1],value:[]},
  ]
  return{jobId,snapshot:{studio,timeline,frameRate:60,durationFrames},characters:{schemaVersion:1,characters:[character]},characterAssets:{schemaVersion:1,entries},renderVariant:'animated'}
}

module.exports={createCharacterMediaFixture}
