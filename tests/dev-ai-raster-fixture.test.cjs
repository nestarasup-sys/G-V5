'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { WIDTH, HEIGHT, FRAMES, MODEL_SLOT, SOURCE_NAME, SET_ID, HAIR_ID, EXTRA_ID, FACE_IDS, pixelBuffer, manifest } =
  require('../scripts/dev-ai/asset-flow-raster-fixture.cjs')
const { boundComponentBounds, compareBounds, expectedPoseDifference, headLocalBounds } =
  require('../scripts/dev-ai/raster-geometry.cjs')

test('raster model reference has ten stable nonoverlapping valid source rectangles', () => {
  assert.equal(MODEL_SLOT,9)
  assert.equal(WIDTH,1122)
  assert.equal(HEIGHT,1402)
  assert.equal(FRAMES.length,10)
  assert.equal(new Set(FRAMES.map(p=>p.id)).size,10)
  assert.equal(FRAMES[0].id,'head')
  assert.equal(FRAMES.at(-1).id,'leg-right')
  for(const part of FRAMES){
    assert.ok(part.x>=0 && part.y>=0)
    assert.ok(part.width>0 && part.height>0)
    assert.ok(part.x+part.width<=WIDTH && part.y+part.height<=HEIGHT)
    assert.ok(/^[a-z0-9-]+$/.test(part.id))
  }
  assert.match(SOURCE_NAME,/^source-[a-f0-9-]+\.png$/i)
  assert.match(SET_ID,/^[a-f0-9-]{36}$/)
})
test('deterministic synthetic BGRA raster supports transparent source and colored markers', () => {
  const a=pixelBuffer(16,12,[11,22,33,255],true)
  assert.deepEqual(a,pixelBuffer(16,12,[11,22,33,255],true))
  assert.notDeepEqual(a,pixelBuffer(16,12,[11,22,33,255],false))
  assert.equal(a.length,16*12*4)
  assert.deepEqual([...a.subarray(0,4)],[11,22,33,255])
  assert.deepEqual([...pixelBuffer(1,1,[0,0,0,0])],[0,0,0,0])
})

test('AF-13 fixture includes assembled model, pose, complete outfit, both hair layers, face and accessory', () => {
  const nativeImage={createFromBitmap:(bitmap)=>({toPNG:()=>Buffer.from(bitmap)})}
  const fixture=manifest(nativeImage)
  assert.equal(fixture.model.parts.length,10)
  assert.equal(fixture.pose1.parts.length,10)
  assert.equal(fixture.pose2.parts.length,10)
  assert.deepEqual(fixture.set.components.map(item=>item.id),['shirt','shoe-left','glasses'])
  assert.ok(fixture.set.components.find(item=>item.id==='shirt').binding.boneId==='torso')
  assert.ok(fixture.set.components.find(item=>item.id==='glasses').renderAboveHair)
  assert.equal(fixture.hairStyle.id,HAIR_ID)
  assert.ok(fixture.hairStyle.front && fixture.hairStyle.back)
  assert.equal(fixture.extraAsset.id,EXTRA_ID)
  assert.deepEqual(fixture.faceItems.map(item=>item.item.category),['eyes','eyebrows','nose','mouth-closed'])
  assert.deepEqual(fixture.faceItems.map(item=>item.item.id),Object.values(FACE_IDS))
  assert.ok(fixture.faceItems.every(item=>item.assets.length>=2))
  assert.match(fixture.shoe.dataUrl,/^data:image\/png;base64,/)
})

test('raster geometry oracle predicts shoe and head-local assets in source and posed frames', () => {
  const sourceHead = { x:399,y:29,width:319,height:294,rotation:0 }
  const hair = { width:106,height:70 }
  const hairTransform = { x:159.5,y:100,scaleX:1.2,scaleY:1.1,rotation:0 }
  const poseOneHead = { id:'head',x:399,y:29,width:319,height:294,rotation:0 }
  const poseTwoHead = { id:'head',x:424,y:44,width:319,height:294,rotation:10 }
  const oneHair = headLocalBounds(hair,hairTransform,sourceHead,poseOneHead)
  const twoHair = headLocalBounds(hair,hairTransform,sourceHead,poseTwoHead)
  assert.deepEqual(oneHair,{x:494,y:90,width:129,height:78})
  assert.deepEqual(twoHair,{x:522,y:95,width:139,height:99})

  const shoe = { id:'shoe-left',binding:{ boneId:'leg-left',localCenterX:-15/156,
    localCenterY:141.5/431,widthRatio:58/156,heightRatio:34/431,relativeRotation:0 } }
  const legOne = { id:'leg-left',x:346,y:960,width:156,height:431,rotation:0 }
  const legTwo = { id:'leg-left',x:387,y:975,width:156,height:431,rotation:26 }
  const shoeOne = boundComponentBounds(shoe,legOne)
  const shoeTwo = boundComponentBounds(shoe,legTwo)
  assert.deepEqual(shoeOne,{x:380,y:1300,width:58,height:34})
  assert.deepEqual(shoeTwo,{x:355,y:1283,width:69,height:57})
  assert.equal(compareBounds(shoeOne,{x:380,y:1300,width:58,height:34}).passed,true)
})

test('head-extra default transform uses canvas coordinates and per-actor deltas', () => {
  const sourceHead={x:399,y:29,width:319,height:294,rotation:0}
  const targetHead={id:'head',x:65,y:50,width:319,height:294,rotation:0}
  const asset={width:70,height:22}
  const factory={x:160,y:105,scaleX:1.1,scaleY:1,rotation:0}
  assert.deepEqual(headLocalBounds(asset,factory,sourceHead,targetHead),
    {x:186,y:144,width:78,height:22})
  assert.deepEqual(headLocalBounds(asset,{...factory,x:163,y:107,rotation:5},sourceHead,targetHead),
    {x:188,y:142,width:80,height:30})
})

test('pose-relative wardrobe oracle rotates width and offset with a bent leg', () => {
  const component={binding:{boneId:'leg-left',localCenterX:0,localCenterY:0,widthRatio:.2,heightRatio:.2,relativeRotation:0}}
  const bone={id:'leg-left',x:0,y:0,width:100,height:200,rotation:90}
  const group={offsetX:10,offsetY:0,scaleX:2,scaleY:1,rotation:0,
    adjustmentReference:{version:1,boneId:'leg-left',width:100,height:200,rotation:0}}
  const actual=boundComponentBounds(component,bone,group)
  assert.equal(compareBounds(actual,{x:30,y:90,width:40,height:40},1).passed,true)
  const {adjustmentReference,...legacy}=group
  assert.notDeepEqual(actual,boundComponentBounds(component,bone,legacy),
    'A escala horizontal de tela antiga não deve ser confundida com largura relativa à perna')
})

test('pose visual report distinguishes expected pose changes from equality regressions', () => {
  assert.deepEqual(expectedPoseDifference(0.02,0.005),{
    identical:false,equivalent:null,expectedDifferenceObserved:true,passed:true,minimumChangedPixelRatio:0.005
  })
  assert.equal(expectedPoseDifference(0.001,0.005).passed,false)
})
