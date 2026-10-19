export interface AssetRecordInput {
  id: string
  domainId: string
  kind: string
  displayName: string
  schemaVersion?: number
  metadata?: Record<string, unknown>
  archived?: boolean
}

export interface DataPlatformOptions {
  dataRoot: string
}

export class DataPlatform {
  constructor(dataRoot: string)
  readonly root: string
  readonly database: import('better-sqlite3').Database | null
  initialize(): this
  registerDomain(input: { id: string; schemaVersion: number; manifest?: Record<string, unknown>; migrate?: (database: import('better-sqlite3').Database) => void }): void
  upsertAsset(input: AssetRecordInput): void
  upsertAssets(inputs: AssetRecordInput[]): void
  linkObject(input: { assetId: string; sha256: string; role?: string }): void
  addReference(input: { sourceDomain: string; sourceId: string; targetDomain: string; targetId: string; relation: string }): void
  search(input?: { query?: string; domainId?: string; kind?: string; limit?: number; offset?: number }): Array<{
    id: string; domainId: string; kind: string; displayName: string; schemaVersion: number
    metadata: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string
  }>
  storageSummary(): { assets: number; archivedAssets: number; uniqueObjects: number; referencedObjects: number; objectBytes: number; unreferencedObjects: number }
  close(): void
}

export class ContentAddressedStore {
  constructor(dataRoot: string)
  putObject(bytes: Buffer, options: { mimeType: string; extension: string }): Promise<{
    sha256: string; byteLength: number; mimeType: string; extension: string; relativePath: string; reused: boolean
  }>
  putFile(sourcePath: string, options: { mimeType: string; extension: string }): Promise<{
    sha256: string; byteLength: number; mimeType: string; extension: string; relativePath: string; reused: boolean
  }>
  createPngThumbnail(bytes: Buffer, options?: { maxDimension?: number }): Promise<{
    path: string; sha256: string; byteLength: number; reused: boolean
  }>
  createPngThumbnailFromFile(sourcePath: string, options?: { maxDimension?: number }): Promise<{
    path: string; sha256: string; byteLength: number; reused: boolean
  }>
  evaluateLosslessPng(bytes: Buffer): Promise<{
    pixelIdentical: boolean; originalBytes: number; candidateBytes: number; durationMs: number; savedBytes: number
    candidate: Buffer; originalSha256: string; candidateSha256: string
  }>
}

export const BUILTIN_DOMAINS: readonly string[]
export function registerObjectMetadata(catalog: DataPlatform, assetId: string, object: {
  sha256: string; byteLength: number; mimeType: string; extension?: string; relativePath: string
}, role?: string): Promise<void>
export function createDatabaseSnapshot(catalog: DataPlatform, destination: string): Promise<{
  path: string; byteLength: number; sha256: string
}>
export function getAppDataUsage(dataRoot: string): Promise<{
  groups: Record<string, { files: number; bytes: number; unreadable: number }>
  measuredAt: string
}>
export function sha256(bytes: Buffer | string): string
