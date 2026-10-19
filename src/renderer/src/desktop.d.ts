import type { FabricatorDesktopApi } from '../../shared/fabricator'
import type { CustomizerDesktopApi } from '../../shared/customizer'
import type { StudioDesktopApi, VideoStudioDesktopApi } from '../../shared/studio'

declare global {
  interface Window {
    desktop: {
      platform: string
      appName: string
      getAppDataStorageSummary: () => Promise<{
        disk: { measuredAt: string; groups: Record<string, { files: number; bytes: number; unreadable: number }> }
        catalog: { assets: number; archivedAssets: number; uniqueObjects: number; referencedObjects: number; objectBytes: number; unreferencedObjects: number }
      }>
    } & FabricatorDesktopApi & CustomizerDesktopApi & StudioDesktopApi & VideoStudioDesktopApi
  }
}

export {}
