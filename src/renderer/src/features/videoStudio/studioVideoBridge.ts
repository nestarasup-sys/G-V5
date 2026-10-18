import type { StudioAsset, StudioDocument } from '../../../../shared/studio'
import type { VideoProject, VideoSceneFrame, VideoStudioScene } from '../../../../shared/videoStudio'

/**
 * Studio editor is the only authoring UI and visual compositor.
 * This adapter isolates its persisted media from the original Studio directory.
 * The Video Studio's sceneFrames are the canonical timeline scene snapshots.
 */
export function studioDocumentForVideo(project: VideoProject, frame?: number): StudioDocument {
  const frameScene = typeof frame === 'number' ? recordedSceneAtFrame(project, frame) : null
  const base = project.studioScene
  const scene = frameScene ?? base ?? {
    schemaVersion: 1 as const,
    id: project.id,
    title: project.title,
    color: project.color,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    backgroundColor: project.canvas.backgroundColor,
    backgroundAssetId: project.canvas.backgroundAssetId,
    backgroundX: 0, backgroundY: 0, backgroundWidth: 100,
    backgroundHeight: 100, backgroundRotation: 0, elements: []
  }
  return { ...scene, assets: project.assets }
}

export function recordedSceneAtFrame(project: VideoProject, frame: number): VideoStudioScene | null {
  const frames = project.sceneFrames ?? []
  let low = 0, high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].frame <= frame) low = middle + 1
    else high = middle
  }
  return low > 0 ? frames[low - 1].scene : null
}

/** Keep immutable media IDs for every recorded frame, even if Studio edits an existing PNG. */
export function captureStudioScene(project: VideoProject, document: StudioDocument): VideoProject {
  const media = [...project.assets]
  const previousById = new Map(media.map(asset => [asset.id, asset]))
  const remap = new Map<string, string>()
  for (const asset of document.assets) {
    const previous = previousById.get(asset.id)
    if (!previous) {
      media.push(asset)
      remap.set(asset.id, asset.id)
      continue
    }
    if (previous.dataUrl === asset.dataUrl) {
      remap.set(asset.id, asset.id)
      continue
    }
    const shared = media.find(candidate =>
      candidate.category === asset.category && candidate.mimeType === asset.mimeType &&
      candidate.dataUrl === asset.dataUrl)
    if (shared) remap.set(asset.id, shared.id)
    else {
      const id = crypto.randomUUID()
      media.push({ ...asset, id })
      remap.set(asset.id, id)
    }
  }
  const mapId = (id: string | undefined): string | undefined => id ? (remap.get(id) ?? id) : id
  const { assets: _assets, ...meta } = document
  const studioScene: VideoStudioScene = {
    ...meta,
    backgroundAssetId: mapId(meta.backgroundAssetId ?? undefined) ?? null,
    elements: meta.elements.map(element => ({
      ...element, ...(element.assetId ? { assetId: mapId(element.assetId) } : {})
    }))
  }
  return { ...project, assets: media, studioScene, updatedAt: new Date().toISOString() }
}

/** Full frame snapshot; no partial updates or hidden state from the Studio editor. */
export function recordStudioSceneAtFrame(project: VideoProject, document: StudioDocument, frame: number): VideoProject {
  const captured = captureStudioScene(project, document)
  if (!captured.studioScene) return project
  const target = Math.max(0, Math.min(captured.durationFrames - 1, Math.floor(frame)))
  const current: VideoSceneFrame = { frame: target, scene: structuredClone(captured.studioScene) }
  const existing = captured.sceneFrames ?? []
  const frames = [...existing.filter(value => value.frame !== target), current].sort((a, b) => a.frame - b.frame)
  return { ...captured, sceneFrames: frames, saveMarkers: [
    ...captured.saveMarkers.filter(marker => marker.frame !== target),
    { frame: target, affectedTrackIds: [] }
  ].sort((a, b) => a.frame - b.frame) }
}

export function videoSceneContainsAssets(project: VideoProject): boolean {
  const ids = new Set(project.assets.map(item => item.id))
  return (project.sceneFrames ?? []).every(frame =>
    (!frame.scene.backgroundAssetId || ids.has(frame.scene.backgroundAssetId)) &&
    frame.scene.elements.every(element => !element.assetId || ids.has(element.assetId)))
}

/** Pure view-model: tracks reflect authored per-character changes without a second timeline authority. */
export function characterLanesFromScenes(project: VideoProject): Array<{ id: string; label: string; frames: number[] }> {
  const frames = project.sceneFrames ?? []
  const lanes = new Map<string, { id: string; label: string; frames: number[]; previous: string }>()
  for (const entry of frames) {
    for (const element of entry.scene.elements.filter(element => element.kind === 'character')) {
      const label = element.text || 'Personagem'
      const state = JSON.stringify(element)
      const lane = lanes.get(element.id)
      if (!lane) lanes.set(element.id, { id: element.id, label, frames: [entry.frame], previous: state })
      else if (lane.previous !== state) { lane.frames.push(entry.frame); lane.previous = state }
    }
  }
  return [...lanes.values()].map(({ id, label, frames }) => ({ id, label, frames }))
}

/** Video-scene metadata should never use a different geometry convention than Studio. */
export function isStudioSceneAssetCompatible(scene: StudioDocument, assets: readonly StudioAsset[]): boolean {
  const ids = new Set(assets.map(asset => asset.id))
  return (!scene.backgroundAssetId || ids.has(scene.backgroundAssetId))
    && scene.elements.every(element => !element.assetId || ids.has(element.assetId))
}
