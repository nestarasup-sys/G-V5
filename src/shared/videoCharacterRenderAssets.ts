import type { FaceComponentAsset, FaceCatalogItem, FaceExpressionEffects, FabricatorPose, FabricatorProject } from './fabricator'

export type VideoCharacterTransitionCoreAssetProvider = Readonly<{
  loadModel: (modelSlot: number) => Promise<FabricatorProject | null>
  loadPose: (modelSlot: number, poseSlot: number) => Promise<FabricatorPose | null>
  loadFaceComponent: (modelSlot: number, id: string) => Promise<FaceComponentAsset | null>
  loadFaceCatalogItem: (modelSlot: number, id: string) => Promise<FaceCatalogItem | null>
  loadStandardExpressionEffects: (modelSlot: number) => Promise<Record<number, FaceExpressionEffects>>
}>

export type VideoCharacterTransitionCoreAssetSnapshotInput = Readonly<{
  models: ReadonlyArray<Readonly<{ modelSlot: number; value: FabricatorProject | null }>>
  poses: ReadonlyArray<Readonly<{ modelSlot: number; poseSlot: number; value: FabricatorPose | null }>>
  faceComponents: ReadonlyArray<Readonly<{ modelSlot: number; id: string; value: FaceComponentAsset | null }>>
  faceCatalogItems: ReadonlyArray<Readonly<{ modelSlot: number; id: string; value: FaceCatalogItem | null }>>
  standardExpressionEffects: ReadonlyArray<Readonly<{ modelSlot: number; value: Record<number, FaceExpressionEffects> }>>
}>

export type VideoCharacterTransitionCoreAssetSnapshot = VideoCharacterTransitionCoreAssetSnapshotInput

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const child of Object.values(value)) deepFreeze(child, visited)
  return Object.freeze(value)
}

function uniqueBy<T>(items: ReadonlyArray<T>, keyOf: (item: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of items) {
    const key = keyOf(item)
    if (!key || result.has(key)) throw new Error(`Snapshot de render contém referência duplicada ou inválida: ${label}.`)
    result.set(key, item)
  }
  return result
}

/** Clone and freeze all supplier data before a render job can consume it. */
export function createVideoCharacterTransitionCoreAssetSnapshot(input: VideoCharacterTransitionCoreAssetSnapshotInput): VideoCharacterTransitionCoreAssetSnapshot {
  if (!input || !Array.isArray(input.models) || !Array.isArray(input.poses) || !Array.isArray(input.faceComponents)
    || !Array.isArray(input.faceCatalogItems) || !Array.isArray(input.standardExpressionEffects)) {
    throw new Error('Snapshot de assets do personagem inválido.')
  }
  uniqueBy(input.models, (item) => String(item.modelSlot), 'modelos')
  uniqueBy(input.poses, (item) => `${item.modelSlot}:${item.poseSlot}`, 'poses')
  uniqueBy(input.faceComponents, (item) => `${item.modelSlot}:${item.id}`, 'componentes faciais')
  uniqueBy(input.faceCatalogItems, (item) => `${item.modelSlot}:${item.id}`, 'catálogo facial')
  uniqueBy(input.standardExpressionEffects, (item) => String(item.modelSlot), 'efeitos faciais padrão')
  for (const entry of input.models) {
    if (!Number.isSafeInteger(entry.modelSlot) || entry.modelSlot < 1 || (entry.value && entry.value.slot !== entry.modelSlot)) throw new Error('Snapshot de modelo com slot incompatível.')
  }
  for (const entry of input.poses) {
    if (!Number.isSafeInteger(entry.modelSlot) || entry.modelSlot < 1 || !Number.isSafeInteger(entry.poseSlot) || entry.poseSlot < 1
      || (entry.value && (entry.value.sourceModelSlot !== entry.modelSlot || entry.value.slot !== entry.poseSlot))) throw new Error('Snapshot de pose com referência incompatível.')
  }
  for (const entry of input.faceComponents) {
    if (!Number.isSafeInteger(entry.modelSlot) || entry.modelSlot < 1 || typeof entry.id !== 'string' || !entry.id.trim()
      || (entry.value && (entry.value.modelSlot !== entry.modelSlot || entry.value.id !== entry.id))) throw new Error('Snapshot de componente facial com referência incompatível.')
  }
  for (const entry of input.faceCatalogItems) {
    if (!Number.isSafeInteger(entry.modelSlot) || entry.modelSlot < 1 || typeof entry.id !== 'string' || !entry.id.trim()
      || (entry.value && (entry.value.modelSlot !== entry.modelSlot || entry.value.id !== entry.id))) throw new Error('Snapshot de catálogo facial com referência incompatível.')
  }
  for (const entry of input.standardExpressionEffects) {
    if (!Number.isSafeInteger(entry.modelSlot) || entry.modelSlot < 1 || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) throw new Error('Snapshot de efeitos faciais com referência inválida.')
  }
  return deepFreeze(structuredClone(input))
}

/** Provide a read-only, deterministic asset source backed only by the captured snapshot. */
export function createVideoCharacterTransitionCoreSnapshotProvider(snapshot: VideoCharacterTransitionCoreAssetSnapshot): VideoCharacterTransitionCoreAssetProvider {
  const models = new Map(snapshot.models.map((entry) => [entry.modelSlot, entry.value]))
  const poses = new Map(snapshot.poses.map((entry) => [`${entry.modelSlot}:${entry.poseSlot}`, entry.value]))
  const faceComponents = new Map(snapshot.faceComponents.map((entry) => [`${entry.modelSlot}:${entry.id}`, entry.value]))
  const faceCatalogItems = new Map(snapshot.faceCatalogItems.map((entry) => [`${entry.modelSlot}:${entry.id}`, entry.value]))
  const effects = new Map(snapshot.standardExpressionEffects.map((entry) => [entry.modelSlot, entry.value]))
  return Object.freeze({
    loadModel: async (modelSlot) => models.get(modelSlot) ?? null,
    loadPose: async (modelSlot, poseSlot) => poses.get(`${modelSlot}:${poseSlot}`) ?? null,
    loadFaceComponent: async (modelSlot, id) => faceComponents.get(`${modelSlot}:${id}`) ?? null,
    loadFaceCatalogItem: async (modelSlot, id) => faceCatalogItems.get(`${modelSlot}:${id}`) ?? null,
    loadStandardExpressionEffects: async (modelSlot) => effects.get(modelSlot) ?? {},
  })
}
