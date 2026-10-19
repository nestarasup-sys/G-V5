'use strict'

// Deterministic 10-part synthetic reference, NEVER read profile or personal
// media. This fixture uses the exact Wardrobe Dev 2.0 source coordinate system.
// The raster backend is Electron nativeImage, not a mock of IPC persistence.
const { createHash } = require('node:crypto')
const WIDTH = 1122, HEIGHT = 1402, MODEL_SLOT = 9
const SOURCE_NAME = 'source-00000000-0000-4000-8000-000000000009.png'
const SET_ID = '09ed9e10-1000-4000-8000-000000000009'
const HAIR_ID = '09ed9e10-1000-4000-8000-000000000019'
const EXTRA_ID = '09ed9e10-1000-4000-8000-000000000029'
const FACE_IDS = Object.freeze({ eyes: '09ed9e10-1000-4000-8000-000000000039',
  eyebrows: '09ed9e10-1000-4000-8000-000000000049', nose: '09ed9e10-1000-4000-8000-000000000059',
  mouth: '09ed9e10-1000-4000-8000-000000000069' })
const FRAMES = Object.freeze([
  { id: 'head', name: 'Cabeça', x: 399, y: 29, width: 319, height: 294 },
  { id: 'arm-left', name: 'Braço esquerdo', x: 238, y: 306, width: 119, height: 194 },
  { id: 'arm-right', name: 'Braço direito', x: 765, y: 306, width: 119, height: 194 },
  { id: 'torso', name: 'Tronco', x: 463, y: 338, width: 217, height: 332 },
  { id: 'forearm-left', name: 'Antebraço esquerdo', x: 130, y: 504, width: 148, height: 290 },
  { id: 'forearm-right', name: 'Antebraço direito', x: 845, y: 504, width: 147, height: 290 },
  { id: 'thigh-left', name: 'Coxa esquerda', x: 382, y: 672, width: 160, height: 275 },
  { id: 'thigh-right', name: 'Coxa direita', x: 601, y: 676, width: 169, height: 272 },
  { id: 'leg-left', name: 'Canela esquerda', x: 346, y: 960, width: 156, height: 431 },
  { id: 'leg-right', name: 'Canela direita', x: 646, y: 960, width: 198, height: 431 }
])
const now = '2026-10-18T00:00:00.000Z'
const partColor = (index) => [27 + index * 20, 51 + index * 13, 107 + index * 12, 255]
function pixelBuffer(width, height, color, marker = false) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    data[i] = color[0]; data[i+1] = color[1]; data[i+2] = color[2]; data[i+3] = color[3]
    if (marker && (x === Math.floor(width/2) || y === Math.floor(height/2))) {
      data[i] = 20; data[i+1] = 240; data[i+2] = 245
    }
  }
  return data
}
function asPng(nativeImage, width, height, bitmap) {
  const png = nativeImage.createFromBitmap(bitmap, { width, height }).toPNG()
  if (!Buffer.isBuffer(png) || !png.length) throw new Error('Could not render deterministic synthetic PNG')
  return png
}
function pngData(nativeImage, width, height, color, marker = false) {
  const bytes = asPng(nativeImage, width, height, pixelBuffer(width, height, color, marker))
  return { bytes, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex') }
}
function manifest(nativeImage) {
  const source = pixelBuffer(WIDTH, HEIGHT, [0, 0, 0, 0])
  const assets = {}
  for (const [index, f] of FRAMES.entries()) {
    const color = partColor(index)
    const part = pixelBuffer(f.width, f.height, color, true)
    for (let y=0;y<f.height;y++) {
      const i = ((f.y+y)*WIDTH + f.x)*4
      part.copy(source,i,y*f.width*4,(y+1)*f.width*4)
    }
    const png = asPng(nativeImage,f.width,f.height,part)
    assets[f.id] = { bytes: png,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      sha256: createHash('sha256').update(png).digest('hex') }
  }
  const sourceBytes = asPng(nativeImage, WIDTH, HEIGHT, source)
  // Displayed as saturated green after BGRA encoding; deliberately distinct
  // from the shared antialias marker used in the body-part rectangles.
  const shoe = pngData(nativeImage, 58, 34, [20, 255, 0, 255], true)
  const shirt = pngData(nativeImage, 150, 220, [255, 128, 18, 255], true)
  const glasses = pngData(nativeImage, 76, 20, [240, 40, 195, 255], true)
  const frontHair = pngData(nativeImage, 106, 70, [45, 100, 235, 255], true)
  const backHair = pngData(nativeImage, 220, 180, [25, 145, 80, 255], true)
  const headExtra = pngData(nativeImage, 70, 22, [235, 180, 12, 255], true)
  // The synthetic rig uses the real sheet reference rectangles as assembled
  // coordinates. This makes the preview read as one actor while retaining
  // stable IDs and dimensions for the binding oracle.
  const parts = FRAMES.map((f) => ({
    ...f, x:f.x, y:f.y,
    rotation: 0, sourceTransform: {
      x:f.x, y:f.y, width:f.width, height:f.height, rotation:0, anchorVersion:1
    }
  }))
  const base = { schemaVersion:1, slot:MODEL_SLOT, name:'DEV AI Model 9',
    sourceName:'synthetic-wardrobe-v2.png', sourceAssetName:SOURCE_NAME,
    width:WIDTH, height:HEIGHT, tolerance:0, parts,
    joints:[], layerOrder:parts.map(p=>p.id), hiddenPartIds:[], updatedAt:now }
  const pose = (slot) => ({
    schemaVersion:1,slot,name:slot===1?'DEV AI pose 1':'DEV AI pose 2',category:'Parado',
    sourceModelSlot:MODEL_SLOT,sourceModelName:base.name,sourceModelUpdatedAt:base.updatedAt,
    width:WIDTH,height:HEIGHT,joints:[],layerOrder:[...base.layerOrder],hiddenPartIds:[],updatedAt:now,
    parts:parts.map((part,index)=>({ ...part,
      x:part.x + (slot===2?25+index*2:0),y:part.y + (slot===2?15:0),
      rotation:slot===2?Math.min(10+index*2,30):0 }))
  })
  const components = [
    { id:'shirt',name:'Camisa sintética',category:'camisa',attachedPartId:'torso',
      x:496,y:394,width:150,height:220,rotation:0 },
    { id:'shoe-left',name:'Sapato esquerdo',category:'sapato',attachedPartId:'leg-left',
      x:380,y:1300,width:58,height:34,rotation:0 },
    { id:'glasses',name:'Óculos',category:'oculos',attachedPartId:'head',
      x:511,y:120,width:76,height:20,rotation:0,renderAboveHair:true }
  ]
  const binding = (c) => {
    const f=FRAMES.find(x=>x.id===c.attachedPartId)
    if(!f)throw Error('Missing synthetic bone')
    return { version:1,boneId:f.id,boneWidth:f.width,boneHeight:f.height,boneRotation:0,
      localCenterX:(c.x+c.width/2-f.x-f.width/2)/f.width,
      localCenterY:(c.y+c.height/2-f.y-f.height/2)/f.height,
      widthRatio:c.width/f.width,heightRatio:c.height/f.height,relativeRotation:0 }
  }
  const set = { schemaVersion:1,edition:2,id:SET_ID,modelSlot:MODEL_SLOT,modelName:base.name,
    name:'DEV AI Outfit',width:WIDTH,height:HEIGHT,updatedAt:now,
    components:components.map(c=>({...c,binding:binding(c)})) }
  const frontHairTransform = { x: 159.5, y: 100, scaleX: 1.2, scaleY: 1.1, rotation:0 }
  const backHairTransform = { x: 159.5, y: 226, scaleX: 1, scaleY: 1, rotation:0 }
  const neutralHairTransform = { x:0,y:0,scaleX:1,scaleY:1,rotation:0 }
  const hairStyle={schemaVersion:1,id:HAIR_ID,modelSlot:MODEL_SLOT,name:'DEV AI front hair',
    front:{width:106,height:70},back:{width:220,height:180},
    transforms:{front:frontHairTransform,back:backHairTransform},
    createdAt:now,updatedAt:now}
  const extraAsset={schemaVersion:1,id:EXTRA_ID,modelSlot:MODEL_SLOT,
    kind:'head-extra',name:'DEV AI glasses',width:70,height:22,
    defaultTransform:{x:160,y:105,scaleX:1.1,scaleY:1,rotation:0},
    updatedAt:now}
  const faceItems = [
    faceCatalogItem(nativeImage, 'eyes', FACE_IDS.eyes, [
      { side:'left', id:'eye-left', width:42, height:22, color:[238,45,82,255], transform:{x:110,y:145,scaleX:1,scaleY:1,rotation:0} },
      { side:'right', id:'eye-right', width:42, height:22, color:[40,92,238,255], transform:{x:209,y:145,scaleX:1,scaleY:1,rotation:0} }
    ]),
    faceCatalogItem(nativeImage, 'eyebrows', FACE_IDS.eyebrows, [
      { side:'left', id:'brow-left', width:44, height:9, color:[75,35,128,255], transform:{x:110,y:116,scaleX:1,scaleY:1,rotation:0} },
      { side:'right', id:'brow-right', width:44, height:9, color:[125,70,35,255], transform:{x:209,y:116,scaleX:1,scaleY:1,rotation:0} }
    ]),
    faceCatalogItem(nativeImage, 'nose', FACE_IDS.nose, [
      { id:'nose', width:18, height:24, color:[255,210,18,255], transform:{x:159.5,y:171,scaleX:1,scaleY:1,rotation:0} }
    ]),
    faceCatalogItem(nativeImage, 'mouth-closed', FACE_IDS.mouth, [
      { id:'mouth', width:48, height:15, color:[20,220,190,255], transform:{x:159.5,y:216,scaleX:1,scaleY:1,rotation:0} }
    ])
  ]
  return { model:base, pose1:pose(1), pose2:pose(2), set, assets, shoe, shirt, glasses,
    hairStyle,frontHair,backHair,extraAsset,headExtra,faceItems,
    sourceBytes, sourceHash:createHash('sha256').update(sourceBytes).digest('hex') }
}

function faceCatalogItem(nativeImage, category, id, definitions) {
  const sheetImage = pngData(nativeImage, 1, 1, [0,0,0,0])
  const pieces = []
  const assets = [{ id:`sheet-${category}`, dataUrl:sheetImage.dataUrl }]
  const transforms = {}
  for (const definition of definitions) {
    const image = pngData(nativeImage, definition.width, definition.height, definition.color, true)
    pieces.push({ id:definition.id, sheet:category, index:0, ...(definition.side ? {side:definition.side} : {}),
      crop:{x:0,y:0,width:definition.width,height:definition.height},
      width:definition.width,height:definition.height })
    assets.push({ id:definition.id, dataUrl:image.dataUrl })
    transforms[definition.id] = definition.transform
  }
  const item = { schemaVersion:1,id,modelSlot:MODEL_SLOT,category,name:`DEV AI ${category}`,
    sheet:{kind:category,name:`DEV AI ${category}`,width:1,height:1,tolerance:0},pieces,transforms,
    eyeLinked:false,browLinked:false,selectedNose:0,selectedExpression:0,updatedAt:now }
  return { item, assets }
}

module.exports = { WIDTH, HEIGHT, MODEL_SLOT, SOURCE_NAME, SET_ID, HAIR_ID, EXTRA_ID, FACE_IDS, FRAMES, pixelBuffer, manifest }
