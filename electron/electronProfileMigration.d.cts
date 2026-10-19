export function migrateElectronProfile(options: {
  dataRoot: string
  legacyRoot: string
  profileRoot: string
  sessionRoot: string
}): { movedProfile: number; movedSession: number; removedDisposable: number; removedLegacyDomainDirs: number }
export function splitElectronSessionData(options: {
  dataRoot: string
  profileRoot: string
  sessionRoot: string
}): { movedProfile: number; movedSession: number; removedDisposable: number; removedLegacyDomainDirs: number }
