export type JointLink = {
  id: string
  parentPartId: string
  childPartId: string
  parentAnchor: { x: number; y: number }
  childAnchor: { x: number; y: number }
  /** Pivô único exibido como uma bolinha no canvas. */
  pivot?: { x: number; y: number }
  /** Quando ativo, arrastar a peça-pai move esta peça junto com o encaixe. */
  fixed?: boolean
  suggested?: boolean
}

export type ModelPart = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
  /** Recorte original com uma pequena margem recuperável para reajustar o chroma. */
  chromaBaseDataUrl?: string
  chromaBaseSaved?: boolean
  rotation: number
  /** Pivô único da peça no canvas, em coordenadas da folha. */
  jointAnchor?: { x: number; y: number }
  /** Transformação imutável da peça na folha desmontada original. */
  sourceTransform?: { x: number; y: number; rotation: number; jointAnchor?: { x: number; y: number }; anchorVersion?: 1 }
  selected?: boolean
}

export type FabricatorProject = {
  schemaVersion: 1
  /** Versão da limpeza de contorno chroma aplicada às peças. */
  chromaVersion?: number
  slot: number
  name: string
  sourceName: string
  sourceAssetName: string
  sourceDataUrl: string
  width: number
  height: number
  tolerance: number
  /** Menor tolerância recuperável a partir da base de cada peça. */
  chromaBaseTolerance?: number
  parts: ModelPart[]
  joints: JointLink[]
  /** Ordem de desenho do fundo para a frente. Ausente em modelos antigos. */
  layerOrder?: string[]
  /** Peças temporariamente ocultas no editor. */
  hiddenPartIds?: string[]
  updatedAt: string
}

export type FabricatorSlotSummary = {
  slot: number
  name: string
  sourceName: string
  partCount: number
  updatedAt: string
} | null

export type FabricatorProjectSave = Omit<FabricatorProject, 'sourceDataUrl' | 'parts'> & {
  parts: Array<Omit<ModelPart, 'dataUrl' | 'chromaBaseDataUrl'>>
}

export type FabricatorAssetSave = { id: string; dataUrl: string; chromaBaseDataUrl?: string }

export type FabricatorHistoryAction = 'edit' | 'mixer' | 'reset'
export type FabricatorHistoryEntry = { action: FabricatorHistoryAction; project: FabricatorProject }
export type FabricatorHistoryState = { undo: FabricatorHistoryEntry[]; redo: FabricatorHistoryEntry[] }
export type FabricatorHistorySaveEntry = { action: FabricatorHistoryAction; project: Omit<FabricatorProject, 'sourceDataUrl'> }
export type FabricatorHistorySaveState = { undo: FabricatorHistorySaveEntry[]; redo: FabricatorHistorySaveEntry[] }

export type PosePart = Omit<ModelPart, 'chromaBaseDataUrl' | 'chromaBaseSaved'>
export type WardrobeCategory = 'camisa' | 'manga-superior' | 'manga-inferior' | 'calca-coxa' | 'calca-canela' | 'shorts'
export type WardrobeComponent = {
  id: string
  name: string
  category: WardrobeCategory
  attachedPartId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** Posição original do recorte na folha importada, para restaurar o encaixe inicial. */
  originX?: number
  originY?: number
  originWidth?: number
  originHeight?: number
  dataUrl: string
}
export type WardrobeSet = {
  schemaVersion: 1
  id: string
  modelSlot: number
  modelName: string
  name: string
  width: number
  height: number
  components: WardrobeComponent[]
  updatedAt: string
}
export type WardrobeSetSave = Omit<WardrobeSet, 'components'> & { components: Array<Omit<WardrobeComponent, 'dataUrl'>> }
export type WardrobeSetSummary = Pick<WardrobeSet, 'id' | 'modelSlot' | 'modelName' | 'name' | 'updatedAt'> & { componentCount: number }
export type WardrobeAssetSave = { id: string; dataUrl: string }
export type PoseWardrobeAttachment = { setId: string; category: WardrobeCategory; attachedPartId: string; referenceAnchor: { x: number; y: number }; referenceRotation: number }
export type WardrobePosePart = PosePart & { wardrobeAttachment?: PoseWardrobeAttachment }
export type FabricatorPose = {
  schemaVersion: 1
  slot: number
  name: string
  sourceModelSlot: number
  sourceModelName: string
  sourceModelUpdatedAt: string
  width: number
  height: number
  parts: WardrobePosePart[]
  joints: JointLink[]
  layerOrder: string[]
  hiddenPartIds: string[]
  updatedAt: string
}
export type FabricatorPoseSave = Omit<FabricatorPose, 'parts'> & { parts: Array<Omit<WardrobePosePart, 'dataUrl'>> }
export type FabricatorPoseSummary = { slot: number; sourceModelSlot: number; name: string; sourceModelName: string; partCount: number; updatedAt: string } | null
export type FabricatorPoseDraft = { editingSlot: number | null; project: Omit<FabricatorPose, 'slot'>; updatedAt: string }
export type FabricatorPoseDraftSave = { editingSlot: number | null; project: Omit<FabricatorPoseSave, 'slot'>; updatedAt: string }

export type FabricatorDesktopApi = {
  listFabricatorSlots: () => Promise<FabricatorSlotSummary[]>
  importFabricatorModel: (slot: number) => Promise<{ sourceName: string; sourceAssetName: string; sourceDataUrl: string } | null>
  loadFabricatorSlot: (slot: number) => Promise<FabricatorProject | null>
  saveFabricatorProject: (project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]) => Promise<void>
  loadFabricatorHistory: (slot: number) => Promise<FabricatorHistoryState>
  saveFabricatorHistory: (slot: number, history: FabricatorHistorySaveState, current: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorSlot: (slot: number) => Promise<void>
  listFabricatorPoseSlots: (modelSlot?: number) => Promise<FabricatorPoseSummary[]>
  loadFabricatorPose: (modelSlot: number, slot: number) => Promise<FabricatorPose | null>
  saveFabricatorPose: (modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorPose: (modelSlot: number, slot: number) => Promise<void>
  loadFabricatorPoseDraft: (modelSlot: number) => Promise<FabricatorPoseDraft | null>
  saveFabricatorPoseDraft: (modelSlot: number, draft: FabricatorPoseDraftSave, assets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorPoseDraft: (modelSlot: number) => Promise<void>
  listWardrobeSets: (modelSlot: number) => Promise<WardrobeSetSummary[]>
  loadWardrobeSet: (modelSlot: number, id: string) => Promise<WardrobeSet | null>
  saveWardrobeSet: (modelSlot: number, set: WardrobeSetSave, assets: WardrobeAssetSave[]) => Promise<void>
  deleteWardrobeSet: (modelSlot: number, id: string) => Promise<void>
}
