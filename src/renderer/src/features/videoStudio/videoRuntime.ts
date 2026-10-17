import type {
  VideoActorState, VideoCharacterTrack, VideoProject, VideoSaveMarker, VideoStateSegment
} from '../../../../shared/videoStudio'

export function frameAtTime(project: VideoProject, seconds: number): number {
  if (!Number.isFinite(seconds)) return 0
  return Math.max(0, Math.min(project.durationFrames - 1, Math.floor(Math.max(0, seconds) * project.frameRate + 1e-7)))
}

export function stateAtFrame(track: VideoCharacterTrack, frame: number): VideoActorState | null {
  const segments = track.segments
  let low = 0
  let high = segments.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const segment = segments[mid]
    if (frame < segment.startFrame) high = mid
    else if (frame >= segment.endFrameExclusive) low = mid + 1
    else return segment.state
  }
  return null
}

export type EvaluatedCharacter = {
  elementId: string
  state: VideoActorState
  previousState: VideoActorState | null
  transitionProgress: number
}

export function evaluateVideoProject(project: VideoProject, timeSeconds: number): {
  frame: number
  characters: EvaluatedCharacter[]
  texts: Array<{ id: string; kind: 'dialogue' | 'thought'; text: string }>
} {
  const frame = frameAtTime(project, timeSeconds)
  const timeMs = Math.max(0, timeSeconds) * 1000
  const characters = project.characterTracks.flatMap(track => {
    const index = track.segments.findIndex(segment => segment.startFrame <= frame && frame < segment.endFrameExclusive)
    if (index < 0) return []
    const segment = track.segments[index]
    const elapsedMs = timeMs - segment.startFrame / project.frameRate * 1000
    const transitionMs = segment.transitionInMs
    const progress = index > 0 && transitionMs > 0
      ? Math.max(0, Math.min(1, elapsedMs / transitionMs)) : 1
    return [{
      elementId: track.elementId,
      state: segment.state,
      previousState: index > 0 && progress < 1 ? track.segments[index - 1].state : null,
      transitionProgress: progress
    }]
  })
  const texts = project.textTracks.flatMap(track =>
    track.clips
      .filter(clip => clip.startFrame <= frame && frame < clip.endFrameExclusive)
      .map(clip => ({ id: clip.id, kind: track.kind, text: clip.text }))
  )
  return { frame, characters, texts }
}

export function equalActorState(a: VideoActorState, b: VideoActorState): boolean {
  return a.poseId === b.poseId && a.expressionId === b.expressionId && a.faceMode === b.faceMode
}

function saveToTrack(track: VideoCharacterTrack, frame: number, nextState: VideoActorState): VideoCharacterTrack {
  if (track.locked) return track
  const index = track.segments.findIndex(s => s.startFrame <= frame && frame < s.endFrameExclusive)
  if (index < 0) return track
  const current = track.segments[index]
  if (equalActorState(current.state, nextState)) return track
  const segments = [...track.segments]
  if (frame === current.startFrame) {
    segments[index] = { ...current, state: { ...nextState } }
  } else {
    const left: VideoStateSegment = { ...current, endFrameExclusive: frame }
    const right: VideoStateSegment = {
      ...current, id: crypto.randomUUID(), startFrame: frame,
      state: { ...nextState }, transitionInMs: 20
    }
    segments.splice(index, 1, left, right)
  }
  return { ...track, segments }
}

export function recordVideoFrame(
  project: VideoProject, frame: number, drafts: Readonly<Record<string, VideoActorState>>
): VideoProject {
  const target = Math.max(0, Math.min(project.durationFrames - 1, Math.floor(frame)))
  const changedIds: string[] = []
  const tracks = project.characterTracks.map(track => {
    const state = drafts[track.elementId]
    if (!state) return track
    const next = saveToTrack(track, target, state)
    if (next !== track) changedIds.push(track.id)
    return next
  })
  const saved = project.saveMarkers.find(marker => marker.frame === target)
  const markers: VideoSaveMarker[] = saved
    ? project.saveMarkers.map(marker => marker.frame !== target ? marker : {
      ...marker, affectedTrackIds: [...new Set([...marker.affectedTrackIds, ...changedIds])]
    })
    : [...project.saveMarkers, { frame: target, affectedTrackIds: changedIds }].sort((a, b) => a.frame - b.frame)
  return { ...project, characterTracks: tracks, saveMarkers: markers, updatedAt: new Date().toISOString() }
}

export function moveCharacterBoundary(
  project: VideoProject, trackId: string, leftId: string, rightId: string, frame: number
): VideoProject {
  const index = project.characterTracks.findIndex(track => track.id === trackId)
  if (index < 0) return project
  const track = project.characterTracks[index]
  if (track.locked) return project
  const leftIndex = track.segments.findIndex(segment => segment.id === leftId)
  if (leftIndex < 0 || track.segments[leftIndex + 1]?.id !== rightId) return project
  const left = track.segments[leftIndex]
  const right = track.segments[leftIndex + 1]
  if (left.endFrameExclusive !== right.startFrame) return project
  const target = Math.max(left.startFrame + 1, Math.min(right.endFrameExclusive - 1, Math.floor(frame)))
  if (target === left.endFrameExclusive) return project
  const segments = [...track.segments]
  segments.splice(leftIndex, 2, { ...left, endFrameExclusive: target }, { ...right, startFrame: target })
  const characterTracks = [...project.characterTracks]
  characterTracks[index] = { ...track, segments }
  return { ...project, characterTracks, updatedAt: new Date().toISOString() }
}

export function updateVideoDuration(project: VideoProject, durationFrames: number): VideoProject {
  const next = Math.max(1, Math.min(project.frameRate * 36000, Math.floor(durationFrames)))
  if (next === project.durationFrames) return project
  if (next < project.durationFrames) {
    const hasDataPastEnd = project.saveMarkers.some(marker => marker.frame >= next)
      || project.textTracks.some(track => track.clips.some(clip => clip.endFrameExclusive > next))
      || project.characterTracks.some(track => track.segments.length > 1 && track.segments.at(-1)!.startFrame >= next)
    if (hasDataPastEnd) return project
  }
  return {
    ...project, durationFrames: next,
    characterTracks: project.characterTracks.map(track => ({
      ...track,
      segments: track.segments
        .filter(segment => segment.startFrame < next)
        .map(segment => ({ ...segment, endFrameExclusive: Math.min(segment.endFrameExclusive, next) }))
        .map((segment, index, source) => index === source.length - 1
          ? { ...segment, endFrameExclusive: next } : segment)
    })),
    updatedAt: new Date().toISOString()
  }
}
