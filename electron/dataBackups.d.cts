import type { DataPlatform } from './dataPlatform.cjs'

export class DataBackupService {
  constructor(options: { dataRoot: string; catalog: DataPlatform })
  createBackup(): Promise<{ id: string; valid: boolean; fileCount: number; byteLength: number; createdAt: string; verifiedAt: string; databaseSchema: number }>
  listBackups(): Promise<Array<{ id: string; createdAt: string; fileCount: number; byteLength: number; verifiedAt: string | null }>>
  verifyBackup(id: string): Promise<{ id: string; valid: boolean; fileCount: number; byteLength: number; createdAt: string; verifiedAt: string; databaseSchema: number }>
  stageRestore(id: string): Promise<{ restoreId: string; backupId: string; fileCount: number; byteLength: number }>
  applyPendingRestore(): Promise<{ schemaVersion: number; restoreId: string; backupId: string; state: string; roots: Array<{ root: string; present: boolean }> } | null>
  finalizePendingRestore(): Promise<{ backupId: string; finalized: boolean } | null>
  deleteBackup(id: string): Promise<void>
}
