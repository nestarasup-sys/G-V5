import type { StudioDocument, StudioElement, StudioFaceMode } from './studio'

/**
 * Video Studio has a separate, versioned document. StudioDocument is used only
 * as a frozen composition snapshot — never persisted back to the normal Studio.
 */
export type VideoActorState = {
  poseSlot: number | null
  expressionPresetId: string | null
  faceMode: StudioFaceMode
}
export type VideoCharacterSegment = {
  id: string
  startFrame: number
  endFrameExclusive: number
  state: VideoActorState
  transitionInMs: 20
}
export type VideoCharacterTrack = {
  id: string
  characterElementId: string
  label: string
  locked: boolean
  collapsed: boolean
  segments: VideoCharacterSegment[]
}
export type VideoTextClip = {
  id: string
  startFrame: number
  endFrameExclusive: number
  text: string
}
export type VideoTextTrack = {
  id: 'dialogue' | 'thought'
  label: string
  clips: VideoTextClip[]
}
export type VideoSaveMarker = { frame: number; affectedTrackIds: string[] }
export type VideoProject = {
  schemaVersion: 1
  id: string
  title: string
  createdAt: string
  updatedAt: string
  frameRate: number
  durationFrames: number
  scene: StudioDocument
  characterTracks: VideoCharacterTrack[]
  textTracks: VideoTextTrack[]
  saveMarkers: VideoSaveMarker[]
}
export type VideoProjectSummary = Pick<VideoProject, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'durationFrames' | 'frameRate'> & {
  characterCount: number
}
export type VideoStudioDesktopApi = {
  listVideoProjects: () => Promise<VideoProjectSummary[]>
  loadVideoProject: (id: string) => Promise<VideoProject>
  saveVideoProject: (project: VideoProject) => Promise<void>
  deleteVideoProject: (id: string) => Promise<void>
}

export function blankVideoProject(id: string, title: string): VideoProject {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1, id, title, createdAt: now, updatedAt: now,
    frameRate: 60, durationFrames: 60 * 60 * 10,
    scene: {
      schemaVersion: 1, id, title, color: '#d7b5cd', createdAt: now, updatedAt: now,
      backgroundColor: '#d7b5cd', backgroundAssetId: null, backgroundX: 0, backgroundY: 0,
      backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0,
      assets: [], elements: []
    },
    characterTracks: [],
    textTracks: [
      { id: 'dialogue', label: 'Falas', clips: [] },
      { id: 'thought', label: 'Pensamentos', clips: [] }
    ],
    saveMarkers: []
  }
}

export function actorStateFromElement(element: StudioElement): VideoActorState {
  return {
    poseSlot: element.poseSlot ?? null,
    expressionPresetId: element.activeExpressionPresetId ?? null,
    faceMode: element.activeFaceMode ?? 'idle'
  }
}

export function importStudioComposition(project: VideoProject, source: StudioDocument): VideoProject {
  // Clone data URLs and actor metadata. The source Studio is never modified.
  const scene: StudioDocument = {
    ...structuredClone(source), id: project.id, title: project.title,
    createdAt: project.createdAt, updatedAt: new Date().toISOString()
  }
  const previous = new Map(project.characterTracks.map((track) => [track.characterElementId, track]))
  const characterTracks = scene.elements.filter((element) => element.kind === 'character').map((element) => {
    const old = previous.get(element.id)
    return old ?? {
      id: `character:${element.id}`, characterElementId: element.id,
      label: scene.assets.find((asset) => asset.id === element.assetId)?.name?.replace(/\\.[^.]+$/, '') ?? 'Personagem',
      locked: false, collapsed: false,
      segments: [{
        id: `segment:${element.id}:0`, startFrame: 0, endFrameExclusive: project.durationFrames,
        state: actorStateFromElement(element), transitionInMs: 20 as const
      }]
    }
  })
  return { ...project, scene, characterTracks, saveMarkers: [], updatedAt: new Date().toISOString() }
}

export function actorStateAtFrame(track: VideoCharacterTrack, frame: number): VideoActorState {
  const clamped = Math.max(0, Math.floor(frame))
  const segment = track.segments.find((entry) => entry.startFrame <= clamped && clamped < entry.endFrameExclusive)
    ?? track.segments.at(-1)
  if (!segment) return { poseSlot: null, expressionPresetId: null, faceMode: 'idle' }
  return { ...segment.state }
}

/** Pure time evaluator. Preview and future export must call this same function. */
export function evaluateVideoProject(project: VideoProject, frame: number): Record<string, VideoActorState> {
  return Object.fromEntries(project.characterTracks.map((track) => [
    track.characterElementId, actorStateAtFrame(track, frame)
  ]))
}

function statesEqual(a: VideoActorState, b: VideoActorState): boolean {
  return a.poseSlot === b.poseSlot && a.expressionPresetId === b.expressionPresetId && a.faceMode === b.faceMode
}

/**
 * Explicit Save Frame writes only changed actors; all other tracks remain
 * byte-for-byte intact. End frames are exclusive, with 1-frame minimum.
 */
export function commitVideoFrame(
  project: VideoProject,
  frame: number,
  pending: Record<string, VideoActorState>
): VideoProject {
  const target = Math.max(0, Math.min(project.durationFrames - 1, Math.round(frame)))
  const affectedTrackIds: string[] = []
  const tracks = project.characterTracks.map((track) => {
    const state = pending[track.characterElementId]
    if (!state || track.locked) return track
    const index = track.segments.findIndex((segment) => segment.startFrame <= target && target < segment.endFrameExclusive)
    if (index < 0) return track
    const previous = track.segments[index]
    if (statesEqual(previous.state, state)) return track
    affectedTrackIds.push(track.id)
    const segments = track.segments.map((segment) => ({ ...segment, state: { ...segment.state } }))
    if (target === previous.startFrame) {
      segments[index].state = { ...state }
    } else {
      segments.splice(index, 1,
        { ...previous, endFrameExclusive: target },
        { ...previous, id: `segment:${track.characterElementId}:${target}`,
          startFrame: target, state: { ...state }, transitionInMs: 20 })
    }
    return { ...track, segments }
  })
  if (!affectedTrackIds.length && project.saveMarkers.some((marker) => marker.frame === target)) return project
  const markers = project.saveMarkers.filter((marker) => marker.frame !== target)
  markers.push({ frame: target, affectedTrackIds })
  markers.sort((a, b) => a.frame - b.frame)
  return { ...project, characterTracks: tracks, saveMarkers: markers, updatedAt: new Date().toISOString() }
}

export function moveVideoBoundary(project: VideoProject, trackId: string, boundaryIndex: number, targetFrame: number): VideoProject {
  const trackIndex = project.characterTracks.findIndex((track) => track.id === trackId)
  const track = project.characterTracks[trackIndex]
  if (!track || track.locked || boundaryIndex < 0 || boundaryIndex >= track.segments.length - 1) return project
  const segments = track.segments.map((segment) => ({ ...segment, state: { ...segment.state } }))
  const left = segments[boundaryIndex], right = segments[boundaryIndex + 1]
  if (left.endFrameExclusive !== right.startFrame) return project
  const boundary = Math.max(left.startFrame + 1, Math.min(right.endFrameExclusive - 1, Math.round(targetFrame)))
  if (boundary === left.endFrameExclusive) return project
  left.endFrameExclusive = boundary
  right.startFrame = boundary
  const tracks = [...project.characterTracks]
  tracks[trackIndex] = { ...track, segments }
  return { ...project, characterTracks: tracks, updatedAt: new Date().toISOString() }
}

export function changeVideoDuration(project: VideoProject, nextFrames: number): VideoProject {
  const target = Math.max(60, Math.min(60 * 60 * 60 * 8, Math.round(nextFrames)))
  if (target === project.durationFrames) return project
  if (target < project.durationFrames) {
    if (project.saveMarkers.some((marker) => marker.frame >= target)
      || project.textTracks.some((track) => track.clips.some((clip) => clip.endFrameExclusive > target))
      || project.characterTracks.some((track) => track.segments.some((segment) => segment.startFrame >= target))) return project
  }
  return {
    ...project, durationFrames: target, updatedAt: new Date().toISOString(),
    characterTracks: project.characterTracks.map((track) => ({
      ...track, segments: track.segments.map((segment, index) =>
        index === track.segments.length - 1 ? { ...segment, endFrameExclusive: target } : segment)
    }))
  }
}
