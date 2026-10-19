import type {
  FaceCatalogItem, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSummary, FaceExpressionPreset,
  FaceExpressionPresetSummary, FaceSet, FabricatorDesktopApi, FabricatorPose, FabricatorProject, HairStyle, WardrobeSet,
} from './fabricator'

/** Exact Fabricator/Customizer read surface used by the saved-character compositor. */
export type VideoCharacterRenderAssetProvider = Pick<FabricatorDesktopApi,
  | 'loadFabricatorSlot' | 'loadFabricatorPose' | 'loadHairStyle' | 'loadWardrobeSet' | 'loadFaceSet'
  | 'listFaceComponentAssets' | 'loadFaceComponentAsset' | 'listFaceCatalog' | 'loadFaceCatalogItem'
  | 'listFaceExpressionPresets' | 'loadFaceExpressionPreset'
>

type SnapshotEntry<M extends string, A extends ReadonlyArray<unknown>, V> = Readonly<{ method: M; args: A; value: V }>
export type VideoCharacterRenderAssetEntry =
  | SnapshotEntry<'loadFabricatorSlot', readonly [number], FabricatorProject | null>
  | SnapshotEntry<'loadFabricatorPose', readonly [number, number], FabricatorPose | null>
  | SnapshotEntry<'loadHairStyle', readonly [number, string], HairStyle | null>
  | SnapshotEntry<'loadWardrobeSet', readonly [number, string], WardrobeSet | null>
  | SnapshotEntry<'loadFaceSet', readonly [number, string], FaceSet | null>
  | SnapshotEntry<'listFaceComponentAssets', readonly [number, string | null], FaceComponentAssetSummary[]>
  | SnapshotEntry<'loadFaceComponentAsset', readonly [number, string], FaceComponentAsset | null>
  | SnapshotEntry<'listFaceCatalog', readonly [number], FaceCatalogItemSummary[]>
  | SnapshotEntry<'loadFaceCatalogItem', readonly [number, string], FaceCatalogItem | null>
  | SnapshotEntry<'listFaceExpressionPresets', readonly [number], FaceExpressionPresetSummary[]>
  | SnapshotEntry<'loadFaceExpressionPreset', readonly [number, string], FaceExpressionPreset | null>

export type VideoCharacterRenderAssetSnapshot = Readonly<{
  schemaVersion: 1
  entries: ReadonlyArray<VideoCharacterRenderAssetEntry>
}>

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Snapshot de assets contém um número inválido.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  throw new Error('Snapshot de assets contém um valor não serializável.')
}

function normalizedArgs(args: ReadonlyArray<unknown>) {
  // The only optional method argument is the face-component filter.
  return args.map((value) => value === undefined ? null : value)
}

function entryKey(method: string, args: ReadonlyArray<unknown>) {
  return stableJson([method, normalizedArgs(args)])
}

function validSlot(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function matchesReference(value: unknown, modelSlot: number, id: string): boolean {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { modelSlot?: unknown; id?: unknown }
  return candidate.modelSlot === modelSlot && candidate.id === id
}

function validSummaryList(value: unknown, modelSlot: number): boolean {
  return Array.isArray(value) && value.every((item) => !!item && typeof item === 'object'
    && !Array.isArray(item) && (item as { modelSlot?: unknown }).modelSlot === modelSlot
    && typeof (item as { id?: unknown }).id === 'string' && !!(item as { id: string }).id.trim())
}

function validateEntry(entry: VideoCharacterRenderAssetEntry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.args)) throw new Error('Entrada inválida no snapshot de assets do personagem.')
  const [slot, id] = entry.args
  if (!validSlot(slot)) throw new Error('Snapshot de assets contém modelSlot inválido.')
  switch (entry.method) {
    case 'loadFabricatorSlot':
      if (entry.args.length !== 1 || (entry.value && entry.value.slot !== slot)) throw new Error('Referência de modelo incompatível no snapshot.')
      break
    case 'loadFabricatorPose':
      if (entry.args.length !== 2 || !Number.isSafeInteger(id) || (entry.value && (entry.value.slot !== id || entry.value.sourceModelSlot !== slot))) throw new Error('Referência de pose incompatível no snapshot.')
      break
    case 'loadHairStyle': case 'loadWardrobeSet': case 'loadFaceSet': case 'loadFaceCatalogItem': case 'loadFaceComponentAsset': case 'loadFaceExpressionPreset':
      if (entry.args.length !== 2 || typeof id !== 'string' || !id.trim()
        || !matchesReference(entry.value, slot, id)) throw new Error(`Referência incompatível em ${entry.method}.`)
      break
    case 'listFaceComponentAssets':
      if (entry.args.length !== 2 || (id !== null && typeof id !== 'string') || !validSummaryList(entry.value, slot)
        || entry.value.some((item) => item.modelSlot !== slot || (id && item.kind !== id))) throw new Error('Lista de componentes faciais incompatível no snapshot.')
      break
    case 'listFaceCatalog':
      if (entry.args.length !== 1 || !validSummaryList(entry.value, slot)) throw new Error('Lista de catálogo facial incompatível no snapshot.')
      break
    case 'listFaceExpressionPresets':
      if (entry.args.length !== 1 || !validSummaryList(entry.value, slot)) throw new Error('Lista de presets faciais incompatível no snapshot.')
      break
    default: throw new Error('Snapshot de assets contém um método desconhecido.')
  }
}

export function createVideoCharacterRenderAssetSnapshot(entries: ReadonlyArray<VideoCharacterRenderAssetEntry>): VideoCharacterRenderAssetSnapshot {
  if (!Array.isArray(entries)) throw new Error('Snapshot de assets do personagem inválido.')
  const seen = new Set<string>()
  for (const entry of entries) {
    validateEntry(entry)
    const key = entryKey(entry.method, entry.args)
    if (seen.has(key)) throw new Error('Snapshot de assets contém uma leitura duplicada.')
    seen.add(key)
  }
  const ordered = [...entries].sort((a, b) => entryKey(a.method, a.args).localeCompare(entryKey(b.method, b.args)))
  return cloneAndFreeze({ schemaVersion: 1 as const, entries: ordered })
}

export function serializeVideoCharacterRenderAssetSnapshot(snapshot: VideoCharacterRenderAssetSnapshot): string {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries)) throw new Error('Snapshot de assets do personagem inválido.')
  const validated = createVideoCharacterRenderAssetSnapshot(snapshot.entries)
  return stableJson(validated)
}

export function parseVideoCharacterRenderAssetSnapshot(serialized: string): VideoCharacterRenderAssetSnapshot {
  let value: unknown
  try { value = JSON.parse(serialized) } catch { throw new Error('Snapshot de assets do personagem corrompido.') }
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !Array.isArray((value as { entries?: unknown }).entries)) throw new Error('Versão incompatível do snapshot de assets do personagem.')
  return createVideoCharacterRenderAssetSnapshot((value as { entries: VideoCharacterRenderAssetEntry[] }).entries)
}

/** Capture every supplier read exactly once while preparing a render or export. */
export function createRecordingVideoCharacterRenderAssetProvider(source: VideoCharacterRenderAssetProvider): {
  provider: VideoCharacterRenderAssetProvider
  snapshot: () => VideoCharacterRenderAssetSnapshot
} {
  const requests = new Map<string, Promise<unknown>>()
  const entries = new Map<string, VideoCharacterRenderAssetEntry>()
  const read = <T>(method: VideoCharacterRenderAssetEntry['method'], args: ReadonlyArray<unknown>, loader: () => Promise<T>): Promise<T> => {
    const key = entryKey(method, args)
    const existing = requests.get(key)
    if (existing) return existing as Promise<T>
    const request = Promise.resolve().then(loader).then((value) => {
      const cloned = cloneAndFreeze(value)
      const serializedArgs = normalizedArgs(args)
      // `read` is called with each method's exact argument and result types; the cast
      // accounts for normalizing the one optional argument to null for JSON storage.
      const entry = { method, args: serializedArgs, value: cloned } as unknown as VideoCharacterRenderAssetEntry
      validateEntry(entry)
      entries.set(key, entry)
      return cloned
    }).catch((error: unknown) => {
      requests.delete(key)
      throw error
    })
    requests.set(key, request)
    return request
  }
  const provider: VideoCharacterRenderAssetProvider = Object.freeze({
    loadFabricatorSlot: (slot) => read('loadFabricatorSlot', [slot], () => source.loadFabricatorSlot(slot)),
    loadFabricatorPose: (modelSlot, poseSlot) => read('loadFabricatorPose', [modelSlot, poseSlot], () => source.loadFabricatorPose(modelSlot, poseSlot)),
    loadHairStyle: (modelSlot, id) => read('loadHairStyle', [modelSlot, id], () => source.loadHairStyle(modelSlot, id)),
    loadWardrobeSet: (modelSlot, id) => read('loadWardrobeSet', [modelSlot, id], () => source.loadWardrobeSet(modelSlot, id)),
    loadFaceSet: (modelSlot, id) => read('loadFaceSet', [modelSlot, id], () => source.loadFaceSet(modelSlot, id)),
    listFaceComponentAssets: (modelSlot, kind) => read('listFaceComponentAssets', [modelSlot, kind], () => source.listFaceComponentAssets(modelSlot, kind)),
    loadFaceComponentAsset: (modelSlot, id) => read('loadFaceComponentAsset', [modelSlot, id], () => source.loadFaceComponentAsset(modelSlot, id)),
    listFaceCatalog: (modelSlot) => read('listFaceCatalog', [modelSlot], () => source.listFaceCatalog(modelSlot)),
    loadFaceCatalogItem: (modelSlot, id) => read('loadFaceCatalogItem', [modelSlot, id], () => source.loadFaceCatalogItem(modelSlot, id)),
    listFaceExpressionPresets: (modelSlot) => read('listFaceExpressionPresets', [modelSlot], () => source.listFaceExpressionPresets(modelSlot)),
    loadFaceExpressionPreset: (modelSlot, id) => read('loadFaceExpressionPreset', [modelSlot, id], () => source.loadFaceExpressionPreset(modelSlot, id)),
  })
  return { provider, snapshot: () => createVideoCharacterRenderAssetSnapshot([...entries.values()]) }
}

/** A captured provider fails loudly if rendering asks for an asset that was not captured. */
export function createVideoCharacterRenderSnapshotProvider(snapshot: VideoCharacterRenderAssetSnapshot): VideoCharacterRenderAssetProvider {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries)) throw new Error('Snapshot de assets do personagem inválido.')
  const validated = createVideoCharacterRenderAssetSnapshot(snapshot.entries)
  const entries = new Map(validated.entries.map((entry) => [entryKey(entry.method, entry.args), entry.value]))
  const read = <T>(method: VideoCharacterRenderAssetEntry['method'], args: ReadonlyArray<unknown>): Promise<T> => {
    const key = entryKey(method, args)
    if (!entries.has(key)) return Promise.reject(new Error(`Dependência não capturada no snapshot de assets: ${method}.`))
    return Promise.resolve(entries.get(key) as T)
  }
  return Object.freeze({
    loadFabricatorSlot: (slot) => read('loadFabricatorSlot', [slot]),
    loadFabricatorPose: (modelSlot, poseSlot) => read('loadFabricatorPose', [modelSlot, poseSlot]),
    loadHairStyle: (modelSlot, id) => read('loadHairStyle', [modelSlot, id]),
    loadWardrobeSet: (modelSlot, id) => read('loadWardrobeSet', [modelSlot, id]),
    loadFaceSet: (modelSlot, id) => read('loadFaceSet', [modelSlot, id]),
    listFaceComponentAssets: (modelSlot, kind) => read('listFaceComponentAssets', [modelSlot, kind]),
    loadFaceComponentAsset: (modelSlot, id) => read('loadFaceComponentAsset', [modelSlot, id]),
    listFaceCatalog: (modelSlot) => read('listFaceCatalog', [modelSlot]),
    loadFaceCatalogItem: (modelSlot, id) => read('loadFaceCatalogItem', [modelSlot, id]),
    listFaceExpressionPresets: (modelSlot) => read('listFaceExpressionPresets', [modelSlot]),
    loadFaceExpressionPreset: (modelSlot, id) => read('loadFaceExpressionPreset', [modelSlot, id]),
  })
}
