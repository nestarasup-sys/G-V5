import type { DataPlatform } from './dataPlatform.cjs'

export const DOMAINS: readonly Array<{ id: string; roots: string[] }>
export function inventoryDomain(userDataRoot: string, domainId: string): Promise<{
  domainId: string; files: Array<{ absolute: string; relativePath: string; sourceRelativePath: string; byteLength: number; mtimeMs: number; sha256: string }>
  directories: string[]; fileCount: number; directoryCount: number; byteLength: number; inventorySha256: string
}>

export class DataMigrationService {
  constructor(options: { dataRoot: string; userDataRoot: string; catalog: DataPlatform; onProgress?: (progress: {
    domainId: string; completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number
  }) => void })
  prepare(): Promise<{ domains: Array<{ domainId: string; state: string; fileCount: number; directoryCount: number; byteLength: number; inventorySha256: string | null }>; availableBytes: number; estimatedRequiredBytes: number; hasEnoughSpace: boolean }>
  migrateDomain(domainId: string): Promise<{ domainId: string; state: string; migrationId?: string; fileCount: number; directoryCount?: number; byteLength: number; inventorySha256?: string }>
  finalizeAfterHealthyLoad(): Promise<Array<{ domainId: string; cleaned: boolean; reason: string | null }>>
}
