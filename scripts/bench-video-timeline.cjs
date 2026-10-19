'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/renderer/src/features/videoStudio/videoTimelineIndex.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loadedModule, loadedModule.exports)
const { characterSegmentAtFrame, indexVideoTimeline, nearestTimelineSnapFrame } = loadedModule.exports
const characterTrackPath = path.join(__dirname, '../src/renderer/src/features/videoStudio/characterTrack.ts')
const characterTrackCompiled = ts.transpile(fs.readFileSync(characterTrackPath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedCharacterTrack = { exports: {} }
new Function('require', 'module', 'exports', characterTrackCompiled)(require, loadedCharacterTrack, loadedCharacterTrack.exports)
const { characterStateAt } = loadedCharacterTrack.exports

function oldSegment(timeline, elementId, frame, duration) {
  const starts = timeline.characterKeys.filter((key) => key.elementId === elementId).map((key) => key.frame).sort((a, b) => a - b)
  const stateStart = starts.filter((start) => start <= frame).at(-1) ?? 0
  const stateEnd = starts.find((start) => start > stateStart) ?? duration
  const gaps = timeline.characterGaps.filter((gap) => gap.elementId === elementId)
  if (gaps.some((gap) => gap.startFrame <= frame && frame < gap.endFrame)) return null
  const precedingGap = gaps.filter((gap) => gap.endFrame <= frame && gap.endFrame > stateStart).sort((a, b) => b.endFrame - a.endFrame)[0]
  const followingGap = gaps.filter((gap) => gap.startFrame > frame && gap.startFrame < stateEnd).sort((a, b) => a.startFrame - b.startFrame)[0]
  return { startFrame: precedingGap?.endFrame ?? stateStart, endFrame: followingGap?.startFrame ?? stateEnd }
}

function oldSnap(timeline, frame, playheadFrame, pixelsPerSecond) {
  const candidates = [playheadFrame, Math.round(frame / 60) * 60,
    ...timeline.characterKeys.map((key) => key.frame),
    ...timeline.textClips.flatMap((clip) => [clip.startFrame, clip.endFrame]),
    ...timeline.videoClips.flatMap((clip) => [clip.startFrame, clip.endFrame])]
  const nearest = candidates.reduce((best, candidate) => Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best, candidates[0] ?? frame)
  return Math.abs(nearest - frame) / 60 * pixelsPerSecond <= 8 ? nearest : frame
}

function oldCharacterStateAt(timeline, elementId, frame) {
  let current = timeline.characterBases[elementId]
  for (const key of timeline.characterKeys.filter((item) => item.elementId === elementId).sort((a, b) => a.frame - b.frame)) {
    if (key.frame > frame) break
    if (key.state) current = key.state
  }
  return current
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function time(fn, rounds = 3) {
  const samples = []
  for (let round = 0; round < rounds; round++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

for (const count of [100, 1000, 10000]) {
  const actorCount = Math.min(10, Math.max(1, Math.floor(count / 100)))
  const characterKeys = Array.from({ length: count }, (_, i) => ({ id: `key-${i}`, elementId: `actor-${i % actorCount}`, frame: i * 10 }))
  const textCount = Math.floor(count / 10)
  const textClips = Array.from({ length: textCount }, (_, i) => ({ id: `text-${i}`, elementId: `speech-${i}`, kind: 'speech', startFrame: i * 100, endFrame: i * 100 + 50 }))
  const videoClips = Array.from({ length: textCount }, (_, i) => ({ id: `video-${i}`, assetId: `asset-${i}`, startFrame: i * 120, endFrame: i * 120 + 80, sourceStartFrame: 0, sourceEndFrame: 80 }))
  const timeline = { schemaVersion: 1, frameRate: 60, durationFrames: count * 20, playheadFrame: 0, playing: false, characterKeys, characterGaps: [], textClips, videoClips, saveMarkers: [] }
  const queries = Array.from({ length: 120 }, (_, i) => ({ actorId: `actor-${i % actorCount}`, frame: Math.floor((i + 1) * timeline.durationFrames / 121) + 2 }))
  const indexMs = time(() => indexVideoTimeline(timeline), 5)
  const index = indexVideoTimeline(timeline)
  const baselineQueryMs = time(() => {
    for (const query of queries) {
      oldSegment(timeline, query.actorId, query.frame, timeline.durationFrames)
      oldSnap(timeline, query.frame + 3, 0, 60)
    }
  })
  const indexedQueryMs = time(() => {
    for (const query of queries) {
      characterSegmentAtFrame(index, query.actorId, query.frame, timeline.durationFrames)
      nearestTimelineSnapFrame(index, query.frame + 3, 0, 60)
    }
  })
  for (const query of queries) {
    const before = oldSegment(timeline, query.actorId, query.frame, timeline.durationFrames)
    const after = characterSegmentAtFrame(index, query.actorId, query.frame, timeline.durationFrames)
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Segment mismatch at ${count} events / frame ${query.frame}`)
  }
  process.stdout.write(`${JSON.stringify({ events: count, actors: actorCount, queries: queries.length, indexBuildMs: +indexMs.toFixed(2), baselineQueriesMs: +baselineQueryMs.toFixed(2), indexedQueriesMs: +indexedQueryMs.toFixed(2), querySpeedup: +(baselineQueryMs / Math.max(indexedQueryMs, 0.001)).toFixed(2) })}\n`)

  const stateFor = (actorId, pose) => ({ imageDataUrl: `fixture:${actorId}:${pose}`, element: { id: actorId, kind: 'character', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, pose } })
  const playbackTimeline = {
    ...timeline,
    characterBases: Object.fromEntries(Array.from({ length: actorCount }, (_, i) => [`actor-${i}`, stateFor(`actor-${i}`, 'base')])),
    characterTransforms: Object.fromEntries(Array.from({ length: actorCount }, (_, i) => [`actor-${i}`, { x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }]))
  }
  playbackTimeline.characterKeys = Array.from({ length: count }, (_, i) => {
    const actorId = `actor-${i % actorCount}`
    const pose = `pose-${i}`
    return { id: `key-${i}`, elementId: actorId, frame: Math.floor(i / actorCount) * 10, state: stateFor(actorId, pose) }
  })
  const stateQueries = queries.map((query) => ({ ...query, frame: Math.floor(query.frame / 20) * 20 }))
  const baselineStateMs = time(() => {
    for (const query of stateQueries) oldCharacterStateAt(playbackTimeline, query.actorId, query.frame)
  })
  const indexedStateMs = time(() => {
    for (const query of stateQueries) characterStateAt(playbackTimeline, query.actorId, query.frame)
  })
  for (const query of stateQueries) {
    const before = oldCharacterStateAt(playbackTimeline, query.actorId, query.frame)?.element.pose
    const after = characterStateAt(playbackTimeline, query.actorId, query.frame)?.element.pose
    if (before !== after) throw new Error(`Character state mismatch at ${count} events / ${query.actorId} / frame ${query.frame}`)
  }
  process.stdout.write(`${JSON.stringify({ playbackStateEvents: count, actors: actorCount, queries: stateQueries.length, baselineStateQueriesMs: +baselineStateMs.toFixed(2), indexedStateQueriesMs: +indexedStateMs.toFixed(2), playbackLookupSpeedup: +(baselineStateMs / Math.max(indexedStateMs, 0.001)).toFixed(2), comparison: 'same selected pose for every synthetic query' })}\n`)
}
