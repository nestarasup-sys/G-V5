import type { FabricatorDesktopApi } from '../../shared/fabricator'

declare global {
  interface Window {
    desktop: {
      platform: string
      appName: string
    } & FabricatorDesktopApi
  }
}

export {}
