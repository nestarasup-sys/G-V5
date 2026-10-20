'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(relativePath, deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => name in deps ? deps[name] : require(name), mod, mod.exports)
  return mod.exports
}

const timelineHelpers = loadTs('src/shared/videoCharacterTimeline.ts')
const characterTrack = loadTs('src/renderer/src/features/videoStudio/characterTrack.ts', {
  '../../../../shared/videoCharacterTimeline': timelineHelpers,
})

function state(poseSlot, width, height) {
  return {
    imageDataUrl: `data:image/png;base64,POSE_${poseSlot}`,
    element: {
      id: 'actor', kind: 'character', characterId: 'character-a', poseSlot,
      assetId: 'asset-a', text: 'A', x: 5, y: 7, width, height, rotation: 0, zIndex: 1,
      characterCanvasWidth: 28, characterScale: 100, characterWidthScale: 100, characterHeightScale: 100,
    },
  }
}

function studio() {
  const first = state(1, 18, 46)
  const second = state(2, 31, 34)
  return {
    id: 'studio-a', elements: [structuredClone(first.element)], assets: [{ id: 'asset-a', dataUrl: first.imageDataUrl }],
    videoTimeline: {
      schemaVersion: 1, frameRate: 60, durationFrames: 120, playheadFrame: 60, playing: false,
      characterBases: { actor: first },
      characterKeys: [{ id: 'pose-2', elementId: 'actor', frame: 60, poseSlot: 2, expressionCollectionId: null, expressionPresetId: null, faceMode: 'idle', state: second }],
      textClips: [], saveMarkers: [],
    },
  }
}

test('changing pose-local crop geometry does not resize the other pose segment', () => {
  const before = studio()
  const after = structuredClone(before)
  const current = after.elements[0]
  current.poseSlot = 2
  current.width = 31
  current.height = 34
  after.assets[0].dataUrl = 'data:image/png;base64,POSE_2'

  const synchronized = characterTrack.synchronizeVideoCharacterTransforms(before, after)
  assert.deepEqual(
    [synchronized.videoTimeline.characterBases.actor.element.width, synchronized.videoTimeline.characterBases.actor.element.height],
    [18, 46],
    'the first pose keeps its own visible bounds',
  )
  assert.deepEqual(
    [synchronized.videoTimeline.characterKeys[0].state.element.width, synchronized.videoTimeline.characterKeys[0].state.element.height],
    [31, 34],
    'the second pose keeps its own visible bounds',
  )
  assert.deepEqual([synchronized.elements[0].width, synchronized.elements[0].height], [31, 34])
})

test('actor-wide stage controls still apply to every segment while preserving each pose crop', () => {
  const source = studio()
  const before = structuredClone(source)
  const after = structuredClone(source)
  after.elements[0].x = 22
  after.elements[0].characterScale = 135

  const synchronized = characterTrack.synchronizeVideoCharacterTransforms(before, after)
  const states = [synchronized.videoTimeline.characterBases.actor, synchronized.videoTimeline.characterKeys[0].state]
  assert.deepEqual(states.map(({ element }) => [element.x, element.characterScale]), [[22, 135], [22, 135]])
  assert.deepEqual(states.map(({ element }) => [element.width, element.height]), [[18, 46], [31, 34]])

  const stateAtSecondPose = characterTrack.characterStateAt(synchronized.videoTimeline, 'actor', 60)
  assert.deepEqual([stateAtSecondPose.element.width, stateAtSecondPose.element.height], [31, 34])
  assert.deepEqual([stateAtSecondPose.element.x, stateAtSecondPose.element.characterScale], [22, 135])
})

test('legacy global transforms containing width and height no longer override pose crops', () => {
  const source = studio()
  source.videoTimeline.characterTransforms = { actor: { x: 12, y: 7, width: 99, height: 99, rotation: 0, zIndex: 1 } }
  const first = characterTrack.characterStateAt(source.videoTimeline, 'actor', 0)
  const second = characterTrack.characterStateAt(source.videoTimeline, 'actor', 60)
  assert.deepEqual([first.element.width, first.element.height], [18, 46])
  assert.deepEqual([second.element.width, second.element.height], [31, 34])
  assert.equal(first.element.x, 12)
  assert.equal(second.element.x, 12)
})
