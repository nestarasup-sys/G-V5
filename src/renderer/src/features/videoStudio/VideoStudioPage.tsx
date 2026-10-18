import { VideoStudioEditor } from './VideoStudioEditor'

/** Independent editor, layout styles, and document library for Video Studio. */
export function VideoStudioPage({ onEditorActiveChange }: { onEditorActiveChange?: (active: boolean) => void }) {
  return <VideoStudioEditor onEditorActiveChange={onEditorActiveChange} />
}
