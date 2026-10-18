import { StudioPage } from '../studio/StudioPage'

/** Studio workspace with a separate document library and persistence folder. */
export function VideoStudioPage({ onEditorActiveChange }: { onEditorActiveChange?: (active: boolean) => void }) {
  return <StudioPage workspace="video" onEditorActiveChange={onEditorActiveChange} />
}
