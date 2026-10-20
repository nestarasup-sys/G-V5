import type { FabricatorDesktopApi } from '../../shared/fabricator'
import type { CustomizerDesktopApi } from '../../shared/customizer'
import type { StudioDesktopApi, VideoStudioDesktopApi } from '../../shared/studio'
import type { RoteirosDesktopApi } from '../../shared/roteiros'
import type { VideoExportSurfaceBootstrap, VideoExportSurfaceFrameReady, VideoExportSurfaceReady, VideoExportSurfaceRenderRequest } from '../../shared/videoExportSurface'

declare global {
  interface Window {
    desktop: {
      platform: string
      appName: string
      normalizeImageForImport: (bytes: Uint8Array) => Promise<{ dataUrl: string; width: number; height: number; bitDepth: 8 | 16; sourceBytes: number; outputBytes: number }>
      loadFabricatorDesignSettings: () => Promise<unknown | null>
      saveFabricatorDesignSettings: (settings: unknown) => Promise<void>
      getAppDataStorageSummary: () => Promise<{
        disk: { measuredAt: string; groups: Record<string, { files: number; bytes: number; unreadable: number }> }
        catalog: { assets: number; archivedAssets: number; uniqueObjects: number; referencedObjects: number; objectBytes: number; unreferencedObjects: number }
      }>
      getDataMigrationSummary: () => Promise<{
        domains: Array<{ domainId: string; state: string; fileCount: number; directoryCount: number; byteLength: number; inventorySha256: string | null }>
        availableBytes: number; estimatedRequiredBytes: number; hasEnoughSpace: boolean
      }>
      runDataMigration: () => Promise<{ outcomes: Array<{ domainId: string; state: string; fileCount: number; byteLength: number }>; paused: boolean; summary: Awaited<ReturnType<Window['desktop']['getDataMigrationSummary']>> }>
      pauseDataMigration: () => Promise<{ paused: boolean }>
      restartAfterDataMigration: () => Promise<void>
      onDataMigrationProgress: (callback: (progress: { domainId: string; completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number }) => void) => () => void
      listDataBackups: () => Promise<Array<{ id: string; createdAt: string; fileCount: number; byteLength: number; verifiedAt: string | null }>>
      createDataBackup: () => Promise<{ id: string; valid: boolean; fileCount: number; byteLength: number; createdAt: string; verifiedAt: string; databaseSchema: number }>
      verifyDataBackup: (id: string) => Promise<{ id: string; valid: boolean; fileCount: number; byteLength: number; createdAt: string; verifiedAt: string; databaseSchema: number }>
      restoreDataBackup: (id: string) => Promise<{ cancelled?: boolean; safetyBackupId?: string; restoreId?: string; backupId?: string; fileCount?: number; byteLength?: number }>
      deleteDataBackup: (id: string) => Promise<{ deleted: boolean }>
      prepareVideoExportSurface: (jobId: string) => Promise<VideoExportSurfaceBootstrap>
      onVideoExportSurfaceRender: (callback: (request: VideoExportSurfaceRenderRequest) => void) => () => void
      reportVideoExportSurfaceFrame: (ready: VideoExportSurfaceFrameReady) => void
      reportVideoExportSurfaceReady: (ready: VideoExportSurfaceReady) => void
    } & FabricatorDesktopApi & CustomizerDesktopApi & StudioDesktopApi & VideoStudioDesktopApi & RoteirosDesktopApi
  }
}

export {}
