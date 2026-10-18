import type { FabricatorDesktopApi } from '../../shared/fabricator'
import type { CustomizerDesktopApi } from '../../shared/customizer'
import type { StudioDesktopApi, VideoStudioDesktopApi } from '../../shared/studio'

declare global {
  interface Window {
    desktop: {
      platform: string
      appName: string
    } & FabricatorDesktopApi & CustomizerDesktopApi & StudioDesktopApi & VideoStudioDesktopApi
  }
}

export {}
