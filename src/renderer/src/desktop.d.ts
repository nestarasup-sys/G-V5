import type { FabricatorDesktopApi } from '../../shared/fabricator'
import type { CustomizerDesktopApi } from '../../shared/customizer'

declare global {
  interface Window {
    desktop: {
      platform: string
      appName: string
    } & FabricatorDesktopApi & CustomizerDesktopApi
  }
}

export {}
