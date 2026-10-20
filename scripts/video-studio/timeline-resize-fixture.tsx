import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VideoTimeline } from '../../src/renderer/src/features/videoStudio/VideoTimeline'
import { resizeTimelineBlock } from '../../src/shared/videoTimelineEditing'
import type { StudioDocument, VideoTimelineDocument } from '../../src/shared/studio'

const noop = () => {}
const initial = (): StudioDocument => ({
  id: 'synthetic', schemaVersion: 1, title: 'Synthetic timeline', assets: [],
  elements: [
    { id: 'actor', kind: 'character', text: 'Ator' },
    { id: 'speech', kind: 'speech', text: 'Fala' },
    { id: 'thought', kind: 'thought', text: 'Pensamento' }
  ],
  videoTimeline: {
    schemaVersion: 1, frameRate: 60, durationFrames: 600, playheadFrame: 0, playing: false, timelineZoom: 37,
    characterKeys: [0, 120, 240, 360].map((frame, index) => ({ id: `key${index}`, elementId: 'actor', frame, poseSlot: index, faceMode: 'idle', expressionCollectionId: null, expressionPresetId: `pose${index}` })),
    textClips: ['speech', 'thought'].flatMap((kind) => [0, 120, 240, 360].map((frame, index) => ({ id: `${kind}${index}`, elementId: kind, kind, startFrame: frame, endFrame: frame === 360 ? 600 : frame + 120 }))),
    videoAssets: [{ id: 'asset', name: 'Sintético', durationFrames: 1800 }],
    videoClips: [0, 120, 240, 360].map((frame, index) => ({ id: `video${index}`, assetId: 'asset', startFrame: frame, endFrame: frame === 360 ? 600 : frame + 120, sourceStartFrame: 600, sourceEndFrame: 600 + (frame === 360 ? 240 : 120) })),
    saveMarkers: []
  }
} as StudioDocument)

function Fixture() {
  const [studio, setStudio] = useState(initial)
  const [epoch, setEpoch] = useState(0)
  const [frame, setFrame] = useState(0)
  Object.assign(window, { fixture: {
    timeline: studio.videoTimeline,
    reset: () => { setStudio(initial()); setEpoch((value) => value + 1); setFrame(0) }
  } })
  const change = (fn: (timeline: VideoTimelineDocument) => VideoTimelineDocument) => setStudio((current) => ({ ...current, videoTimeline: fn(current.videoTimeline!) }))
  return <VideoTimeline key={epoch} preparing={false} onEnterFullscreen={noop} onExport={noop} canUndo={false} canRedo={false} onUndo={noop} onRedo={noop} studio={studio} playheadFrame={frame} playing={false} height={330} presetNames={{ pose0: 'A', pose1: 'B', pose2: 'C', pose3: 'D' }}
    onSeek={setFrame} onSelectElement={noop} onTogglePlayback={noop} onSaveFrame={noop} onSplitCharacter={noop} onSplitTextClip={noop} onSplitVideoClip={noop}
    onUpdateTextClip={(clip) => change((timeline) => ({ ...timeline, textClips: timeline.textClips.map((item) => item.id === clip.id ? clip : item) }))}
    onUpdateVideoClip={(clip) => change((timeline) => ({ ...timeline, videoClips: timeline.videoClips!.map((item) => item.id === clip.id ? clip : item) }))}
    onResizeBlock={(target, start, end) => change((timeline) => resizeTimelineBlock(timeline, target, start, end, ['actor']))}
    onChangeVideoAudio={noop} onBeginAudioEdit={noop} onDuplicateVideoClip={noop} onDeleteTextClip={noop} onDeleteVideoClip={noop} onDeleteTextElement={noop} onDeleteCharacterSegment={noop} onDuplicateTextClip={noop}
    onChangeDuration={(durationFrames) => change((timeline) => ({ ...timeline, durationFrames }))} onResize={noop} onAddText={noop} onAddVideo={noop} onChangeTrackSettings={noop} onSetCharacterAnimationsEnabled={noop} onMoveCharacterTrack={noop} onSetCharacterPositionsLocked={noop} onChangeTimelineView={noop} />
}
Object.assign(window, { desktop: { prepareVideoPreviewMedia: async () => ({}) } })
createRoot(document.getElementById('root')!).render(<Fixture />)
