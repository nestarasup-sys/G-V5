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
  rotation: number
  selected?: boolean
}

export type FabricatorProject = {
  schemaVersion: 1
  slot: number
  name: string
  sourceName: string
  sourceAssetName: string
  sourceDataUrl: string
  width: number
  height: number
  tolerance: number
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
  parts: Array<Omit<ModelPart, 'dataUrl'>>
}

export type FabricatorAssetSave = { id: string; dataUrl: string }

export type FabricatorDesktopApi = {
  listFabricatorSlots: () => Promise<FabricatorSlotSummary[]>
  importFabricatorModel: (slot: number) => Promise<{ sourceName: string; sourceAssetName: string; sourceDataUrl: string } | null>
  loadFabricatorSlot: (slot: number) => Promise<FabricatorProject | null>
  saveFabricatorProject: (project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]) => Promise<void>
}
