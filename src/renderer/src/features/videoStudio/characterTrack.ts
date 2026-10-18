import type { StudioDocument, StudioElement, VideoCharacterState, VideoTimelineDocument } from '../../../../shared/studio'

export function captureVideoCharacter(studio: StudioDocument, element: StudioElement): VideoCharacterState | null {
  const imageDataUrl = studio.assets.find((asset) => asset.id === element.assetId)?.dataUrl
  return element.kind === 'character' && imageDataUrl ? { element: structuredClone(element), imageDataUrl } : null
}

export function characterStateAt(timeline: VideoTimelineDocument, elementId: string, frame: number): VideoCharacterState | undefined {
  let current = timeline.characterBases?.[elementId]
  for (const key of timeline.characterKeys.filter((item) => item.elementId === elementId).sort((a, b) => a.frame - b.frame)) {
    if (key.frame > frame) break
    if (key.state) current = key.state
  }
  return current
}

export function restoreVideoTracks(studio: StudioDocument, frame: number): StudioDocument {
  const timeline = studio.videoTimeline
  if (!timeline) return studio
  const states = new Map(studio.elements.filter((element) => element.kind === 'character').map((element) => [element.id, characterStateAt(timeline, element.id, frame)]))
  return {
    ...studio,
    elements: studio.elements.map((element) => {
      if (element.kind === 'speech' || element.kind === 'thought') {
        const clip = timeline.textClips.find((item) => item.elementId === element.id && item.startFrame <= frame && frame < item.endFrame)
        return clip?.state ? structuredClone(clip.state) : element
      }
      const state = states.get(element.id)
      return state ? structuredClone(state.element) : element
    }),
    assets: studio.assets.map((asset) => {
      const element = studio.elements.find((item) => item.assetId === asset.id && item.kind === 'character')
      const state = element ? states.get(element.id) : undefined
      return state ? { ...asset, dataUrl: state.imageDataUrl, mimeType: 'image/png' } : asset
    })
  }
}

export function videoCharacterStateEquals(left: VideoCharacterState | undefined, right: VideoCharacterState | undefined): boolean {
  return Boolean(left && right && left.imageDataUrl === right.imageDataUrl && JSON.stringify(left.element) === JSON.stringify(right.element))
}
