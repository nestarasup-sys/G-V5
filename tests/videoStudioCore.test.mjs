import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blankVideoProject, importStudioComposition, evaluateVideoProject,
  commitVideoFrame, moveVideoBoundary, changeVideoDuration
} from '../src/shared/videoStudio.ts'

const uuid = '12345678-1234-4123-8123-123456789012'
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const when = '2026-10-17T00:00:00.000Z'

function fixture() {
  const project = blankVideoProject(uuid, 'Teste canônico')
  const scene = {
    ...project.scene,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    createdAt: when, updatedAt: when,
    elements: [{ id: actorId, kind: 'character', characterId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      assetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', text: '', x: 0, y: 0, width: 20,
      height: 60, rotation: 0, zIndex: 1, poseSlot: 1, activeFaceMode: 'idle' }],
    assets: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', category: 'character',
      name: 'Hero.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' }]
  }
  return { project: importStudioComposition(project, scene), scene }
}

test('video projects begin blank with 10 minutes at 60 FPS', () => {
  const project = blankVideoProject(uuid, 'Novo')
  assert.equal(project.frameRate, 60)
  assert.equal(project.durationFrames, 36000)
  assert.equal(project.scene.elements.length, 0)
  assert.equal(project.characterTracks.length, 0)
})

test('importing a Studio snapshots its assets and actor without altering the source', () => {
  const { project, scene } = fixture()
  assert.equal(project.characterTracks.length, 1)
  assert.equal(project.characterTracks[0].segments[0].endFrameExclusive, 36000)
  assert.notEqual(project.scene, scene)
  project.scene.elements[0].x = 123
  assert.equal(scene.elements[0].x, 0)
})

test('Save Frame changes only the target track and permits an intentional single-frame state', () => {
  let { project } = fixture()
  const original = project.characterTracks[0]
  project = commitVideoFrame(project, 90, { [actorId]: { poseSlot: 2, expressionPresetId: 'angry', faceMode: 'talk' } })
  assert.deepEqual(project.characterTracks[0].segments.map(s => [s.startFrame,s.endFrameExclusive]), [[0,90],[90,36000]])
  assert.equal(original.segments.length, 1)
  assert.equal(evaluateVideoProject(project,89)[actorId].faceMode, 'idle')
  assert.equal(evaluateVideoProject(project,90)[actorId].faceMode, 'talk')
  project = commitVideoFrame(project, 91, { [actorId]: { poseSlot: 1, expressionPresetId: null, faceMode: 'idle' } })
  assert.deepEqual(project.characterTracks[0].segments.map(s => [s.startFrame,s.endFrameExclusive]), [[0,90],[90,91],[91,36000]])
  assert.equal(evaluateVideoProject(project,90)[actorId].faceMode, 'talk')
  assert.equal(evaluateVideoProject(project,91)[actorId].faceMode, 'idle')
  assert.deepEqual(project.saveMarkers.map(m=>m.frame),[90,91])
})

test('unchanged actor does not cause a new segment, locked actors refuse edits', () => {
  let { project } = fixture()
  project = commitVideoFrame(project, 100, { [actorId]: { poseSlot: 1, expressionPresetId: null, faceMode: 'idle' } })
  assert.equal(project.characterTracks[0].segments.length,1)
  const locked = { ...project, characterTracks: project.characterTracks.map(track => ({ ...track, locked: true })) }
  const after = commitVideoFrame(locked, 200, { [actorId]: { poseSlot: 3, expressionPresetId:null, faceMode:'blink' } })
  assert.equal(after.characterTracks[0].segments.length,1)
  assert.equal(evaluateVideoProject(after,200)[actorId].faceMode,'idle')
})

test('shared segment boundary moves without changing total duration or losing state', () => {
  let { project } = fixture()
  project = commitVideoFrame(project, 100, { [actorId]: { poseSlot: 2, expressionPresetId: null, faceMode: 'talk' } })
  const id = project.characterTracks[0].id
  const moved = moveVideoBoundary(project, id, 0, 35999)
  assert.deepEqual(moved.characterTracks[0].segments.map(s => [s.startFrame,s.endFrameExclusive]), [[0,35999],[35999,36000]])
  assert.equal(evaluateVideoProject(moved,35999)[actorId].faceMode,'talk')
  assert.equal(moved.characterTracks[0].segments.at(-1).endFrameExclusive,project.durationFrames)
})

test('duration growth retains actor state and shrinking protects authored cuts', () => {
  let { project } = fixture()
  project = changeVideoDuration(project, 40000)
  assert.equal(project.characterTracks[0].segments[0].endFrameExclusive,40000)
  project = commitVideoFrame(project, 30000, { [actorId]: { poseSlot: 2, expressionPresetId: null, faceMode: 'blink' } })
  assert.equal(changeVideoDuration(project, 20000),project)
  assert.equal(changeVideoDuration(project, 35000).durationFrames,35000)
})
