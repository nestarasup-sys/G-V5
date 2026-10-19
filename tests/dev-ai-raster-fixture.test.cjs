'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { WIDTH, HEIGHT, FRAMES, MODEL_SLOT, SOURCE_NAME, SET_ID, pixelBuffer } =
  require('../scripts/dev-ai/asset-flow-raster-fixture.cjs')

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
