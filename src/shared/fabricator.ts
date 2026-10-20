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
  /** Dimensões antes de ajustar as proporções desta peça. */
  resizeBase?: { width: number; height: number }
  dataUrl: string
  /** Recorte original com uma pequena margem recuperável para reajustar o chroma. */
  chromaBaseDataUrl?: string
  chromaBaseSaved?: boolean
  rotation: number
  /** Pivô único da peça no canvas, em coordenadas da folha. */
  jointAnchor?: { x: number; y: number }
  /** Transformação imutável da peça na folha desmontada original. */
  sourceTransform?: { x: number; y: number; width?: number; height?: number; rotation: number; jointAnchor?: { x: number; y: number }; anchorVersion?: 1 }
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
export type WardrobeCategory = 'camisa' | 'jaqueta' | 'manga-superior' | 'manga-inferior' | 'luvas' | 'capa' | 'cinto' | 'oculos' | 'acessorio-cabeca' | 'saia' | 'calca-coxa' | 'calca-canela' | 'shorts' | 'meia' | 'sapato'
export type WardrobeEdition = 1 | 2
/** Encaixe da roupa expresso no referencial imutável do osso na folha original. */
export type WardrobeBinding = {
  version: 1
  boneId: string
  boneWidth: number
  boneHeight: number
  boneRotation: number
  localCenterX: number
  localCenterY: number
  widthRatio: number
  heightRatio: number
  relativeRotation: number
}
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
  /** Relação congelada com o osso, atualizada junto com os ajustes manuais. */
  binding?: WardrobeBinding
  /** Head accessories enabled here are composited above front and back hair. */
  renderAboveHair?: boolean
  dataUrl: string
}
export type WardrobeSet = {
  schemaVersion: 1
  /** Conjuntos antigos sem edição pertencem ao editor original. */
  edition?: WardrobeEdition
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
export type WardrobeSetSummary = Pick<WardrobeSet, 'id' | 'modelSlot' | 'modelName' | 'name' | 'updatedAt'> & { edition: WardrobeEdition; componentCount: number }
export type WardrobeAssetSave = { id: string; dataUrl: string }
export type FaceSheetKind = 'eyes' | 'eyebrows' | 'nose' | 'mouth-closed' | 'mouth-open'
export type FaceElementKind = 'eye-left' | 'eye-right' | 'brow-left' | 'brow-right' | 'nose' | 'mouth'
export type FaceTransform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipX?: boolean }
export type FaceCrop = { x: number; y: number; width: number; height: number }
export type FacePiece = { id: string; sheet: FaceSheetKind; index: number; side?: 'left' | 'right'; crop: FaceCrop; width: number; height: number; dataUrl: string }
export type FaceSheet = { kind: FaceSheetKind; name: string; width: number; height: number; tolerance: number; dataUrl: string }
export type FaceSet = {
  schemaVersion: 1
  id: string
  modelSlot: number
  name: string
  sheets: Partial<Record<FaceSheetKind, FaceSheet>>
  pieces: FacePiece[]
  transforms: Record<FaceElementKind, FaceTransform>
  eyeLinked: boolean
  browLinked: boolean
  selectedNose: number
  selectedExpression: number
  updatedAt: string
}
export type FaceSetSave = Omit<FaceSet, 'sheets' | 'pieces'> & {
  sheets: Partial<Record<FaceSheetKind, Omit<FaceSheet, 'dataUrl'>>>
  pieces: Array<Omit<FacePiece, 'dataUrl'>>
}
export type FaceSetSummary = Pick<FaceSet, 'id' | 'modelSlot' | 'name' | 'updatedAt'> & { pieceCount: number }
export type FaceAssetSave = { id: string; dataUrl: string }
export type FaceComponentKind = 'eye' | 'pupil' | 'eye-closed' | 'eyebrow'
export type FaceDetailKind = 'eye-highlight-left' | 'eye-highlight-right' | 'blush' | 'facial-shadow'
export type FaceAssetKind = FaceComponentKind | FaceDetailKind | 'head-extra'
export type FaceGuideProfile = 'eyes' | 'face'
export type FaceGuideSettings = { visible: boolean; verticalX: number; horizontalY: number; lowerHorizontalY: number; angle: number }
export type FaceComponentAsset = { schemaVersion: 1; id: string; modelSlot: number; kind: FaceAssetKind; name: string; width: number; height: number; defaultTransform: FaceTransform; rightSidePositioned?: boolean; pairId?: string; updatedAt: string; dataUrl: string }
export type FaceComponentAssetSave = Omit<FaceComponentAsset, 'dataUrl'>
export type FaceComponentAssetSummary = Omit<FaceComponentAsset, 'dataUrl' | 'defaultTransform'>
/** One imported facial sheet and its cropped variants, stored independently for the Customizer catalog. */
export type FaceCatalogItem = {
  schemaVersion: 1
  id: string
  modelSlot: number
  category: FaceSheetKind
  name: string
  sheet: FaceSheet
  pieces: FacePiece[]
  transforms: Partial<Record<FaceElementKind, FaceTransform>>
  eyeLinked: boolean
  browLinked: boolean
  /** Default opacity for this catalog nose, from 0 (transparent) to 1 (opaque). */
  opacity?: number
  selectedNose: number
  selectedExpression: number
  updatedAt: string
}
export type FaceCatalogItemSave = Omit<FaceCatalogItem, 'sheet' | 'pieces'> & {
  sheet: Omit<FaceSheet, 'dataUrl'>
  pieces: Array<Omit<FacePiece, 'dataUrl'>>
}
export type FaceCatalogItemSummary = Pick<FaceCatalogItem, 'id' | 'modelSlot' | 'category' | 'name' | 'updatedAt'> & { pieceCount: number }
export type FaceExpressionSelections = {
  eyes: Record<'left' | 'right', string | null>
  pupils: Record<'left' | 'right', string | null>
  eyebrows: Record<'left' | 'right', string | null>
  nose: { catalogId: string; index: number } | null
  mouth: { catalogId: string; kind: 'mouth-closed' | 'mouth-open'; index: number } | null
}
export type FaceExpressionTransforms = {
  eyeLeft: FaceTransform
  eyeRight: FaceTransform
  pupilLeft: FaceTransform
  pupilRight: FaceTransform
  browLeft: FaceTransform
  browRight: FaceTransform
  nose: FaceTransform
  mouth: FaceTransform
}
export type FaceExpressionEffect = { enabled: boolean; color: string; opacity: number; softness: number; size: number; offsetY: number; offsetX?: number; aspectRatio?: number; width?: number; height?: number; rotation?: number; style?: 'oval' | 'cheeks' | 'bands' | 'diagonal' | 'spot' }
export type FaceExpressionEffects = { shadow: FaceExpressionEffect; blush: FaceExpressionEffect; mouthBlush: FaceExpressionEffect }
/** A preset stores immutable references to shared face assets plus private transform snapshots. */
export type FaceExpressionPreset = {
  schemaVersion: 1
  id: string
  modelSlot: number
  name: string
  /** Optional collection coordinates keep older standalone presets readable. */
  collectionId?: string
  expressionIndex?: number
  selections: FaceExpressionSelections
  transforms: FaceExpressionTransforms
  /** Asset calibration at authoring time, used to transfer relative edits safely. */
  referenceTransforms?: FaceExpressionTransforms
  noseOpacity: number
  effects?: FaceExpressionEffects
  updatedAt: string
}
export type FaceExpressionPresetSummary = Pick<FaceExpressionPreset, 'id' | 'modelSlot' | 'name' | 'updatedAt' | 'collectionId' | 'expressionIndex'>
export type FaceExpressionCollection = { schemaVersion: 1; id: string; modelSlot: number; name: string; createdAt: string; updatedAt: string }
export type FaceExpressionWorkspaceEntry = {
  id: string
  selections: FaceExpressionSelections
  transforms: FaceExpressionTransforms
  noseOpacity: number
  effects: FaceExpressionEffects
}
/** Autosaved editor state, kept separate from the published expression preset library. */
export type FaceExpressionWorkspaceDraft = {
  schemaVersion: 1
  modelSlot: number
  selectedCollectionId: string
  selectedExpressionIndex: number
  current: FaceExpressionWorkspaceEntry
  workingCopies: Record<string, FaceExpressionWorkspaceEntry>
  customExpressionNames: Record<string, string>
  updatedAt: string
}
export type HairTransform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipX?: boolean }
export type HairWorkspace = {
  schemaVersion: 1
  modelSlot: number
  front: { dataUrl: string; width: number; height: number } | null
  back: { dataUrl: string; width: number; height: number } | null
  fringe?: { dataUrl: string; width: number; height: number } | null
  transforms: { front: HairTransform; back: HairTransform; fringe?: HairTransform }
  sourceImageDataUrl?: string
  sourceImageSaved?: boolean
  sourceAppliesToDraft?: boolean
  chromaTolerance?: number
  chromaMode?: 'auto' | 'green' | 'checker'
  categoryBySide?: Partial<Record<'front' | 'back' | 'fringe', import('./customizer').HairPartId>>
  updatedAt: string
}
export type HairWorkspaceSave = Omit<HairWorkspace, 'front' | 'back' | 'fringe' | 'sourceImageDataUrl'> & {
  front: Omit<NonNullable<HairWorkspace['front']>, 'dataUrl'> | null
  back: Omit<NonNullable<HairWorkspace['back']>, 'dataUrl'> | null
  fringe?: Omit<NonNullable<HairWorkspace['fringe']>, 'dataUrl'> | null
}
export type HairWorkspaceAsset = { id: 'front' | 'back' | 'fringe' | 'source'; dataUrl: string }
export type HairStyle = {
  schemaVersion: 1
  id: string
  modelSlot: number
  name: string
  /** Absent on legacy styles, which remain visible in every compatible category. */
  category?: import('./customizer').HairPartId
  front: { dataUrl: string; width: number; height: number } | null
  back: { dataUrl: string; width: number; height: number } | null
  fringe?: { dataUrl: string; width: number; height: number } | null
  transforms: { front: HairTransform; back: HairTransform; fringe?: HairTransform }
  createdAt: string
  updatedAt: string
}
export type HairStyleSave = Omit<HairStyle, 'front' | 'back' | 'fringe'> & {
  front: Omit<NonNullable<HairStyle['front']>, 'dataUrl'> | null
  back: Omit<NonNullable<HairStyle['back']>, 'dataUrl'> | null
  fringe?: Omit<NonNullable<HairStyle['fringe']>, 'dataUrl'> | null
}
export type HairStyleSummary = Omit<HairStyle, 'front' | 'back' | 'fringe'> & {
  front: Omit<NonNullable<HairStyle['front']>, 'dataUrl'> | null
  back: Omit<NonNullable<HairStyle['back']>, 'dataUrl'> | null
  fringe?: Omit<NonNullable<HairStyle['fringe']>, 'dataUrl'> | null
}
export type HairStyleAsset = { id: 'front' | 'back' | 'fringe'; dataUrl: string }
export type PoseWardrobeAttachment = { setId: string; category: WardrobeCategory; attachedPartId: string; referenceAnchor: { x: number; y: number }; referenceRotation: number }
export type WardrobePosePart = PosePart & { wardrobeAttachment?: PoseWardrobeAttachment }
export type FabricatorPose = {
  schemaVersion: 1
  slot: number
  name: string
  category?: string
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
export type FabricatorPoseSummary = { slot: number; sourceModelSlot: number; name: string; category?: string; sourceModelName: string; partCount: number; updatedAt: string } | null
export function resolvePoseCategory(pose: { category?: string; slot?: number; name: string }): string {
  const category = typeof pose.category === 'string' ? pose.category.trim() : ''
  return category || (pose.slot === 2 || /sentad/i.test(pose.name) ? 'Sentado' : 'Parado')
}
export type FabricatorPoseDraft = { editingSlot: number | null; project: Omit<FabricatorPose, 'slot'>; updatedAt: string }
export type FabricatorPoseDraftSave = { editingSlot: number | null; project: Omit<FabricatorPoseSave, 'slot'>; updatedAt: string }

export type AnimatorFrameTransform = { x: number; y: number; rotation: number; width?: number; height?: number; jointAnchor?: { x: number; y: number } }
export type AnimatorFrame = {
  id: string
  durationMs: number
  transforms: Record<string, AnimatorFrameTransform>
  joints: JointLink[]
  thumbnailDataUrl: string
}
export type AnimatorAnimation = {
  schemaVersion: 1
  slot: number
  name: string
  sourceModelSlot: number
  sourceModelName: string
  sourceModelUpdatedAt: string
  sourceModelPartCount: number
  basePoseSlot: number | null
  characterId: string | null
  width: number
  height: number
  parts: PosePart[]
  joints: JointLink[]
  layerOrder: string[]
  hiddenPartIds: string[]
  frames: AnimatorFrame[]
  interpolation: 'smooth' | 'stepped'
  loopMode: 'once' | 'loop' | 'pingpong'
  speed: number
  thumbnailDataUrl: string
  updatedAt: string
}
export type AnimatorAnimationSave = Omit<AnimatorAnimation, 'parts'> & { parts: Array<Omit<PosePart, 'dataUrl'>> }
export type AnimatorAnimationSummary = Pick<AnimatorAnimation, 'slot' | 'sourceModelSlot' | 'name' | 'sourceModelName' | 'sourceModelUpdatedAt' | 'sourceModelPartCount' | 'thumbnailDataUrl' | 'updatedAt'>
export type AnimatorAnimationDraft = {
  editingSlot: number | null
  animation: Omit<AnimatorAnimation, 'slot' | 'parts'> & { parts: Array<Omit<PosePart, 'dataUrl'>> }
  currentTransforms: Record<string, AnimatorFrameTransform>
  currentJoints: JointLink[]
  selectedFrameId: string
  dirtyFrame: boolean
  updatedAt: string
}
export type AnimatorAnimationAsset = { id: string; dataUrl: string }

export type FabricatorDesktopApi = {
  listFabricatorSlots: () => Promise<FabricatorSlotSummary[]>
  importFabricatorModel: (slot: number) => Promise<{ sourceName: string; sourceAssetName: string; sourceDataUrl: string } | null>
  loadFabricatorSlot: (slot: number) => Promise<FabricatorProject | null>
  saveFabricatorProject: (project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]) => Promise<void>
  loadFabricatorHistory: (slot: number) => Promise<FabricatorHistoryState>
  saveFabricatorHistory: (slot: number, history: FabricatorHistorySaveState, current: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorSlot: (slot: number) => Promise<void>
  listFabricatorPoseSlots: (modelSlot?: number) => Promise<FabricatorPoseSummary[]>
  getFabricatorExportPoseSlots: (modelSlot: number) => Promise<Array<number | null> | null>
  saveFabricatorExportPoseSlots: (modelSlot: number, slots: Array<number | null>) => Promise<void>
  loadFabricatorPose: (modelSlot: number, slot: number) => Promise<FabricatorPose | null>
  saveFabricatorPose: (modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorPose: (modelSlot: number, slot: number) => Promise<void>
  loadFabricatorPoseDraft: (modelSlot: number) => Promise<FabricatorPoseDraft | null>
  saveFabricatorPoseDraft: (modelSlot: number, draft: FabricatorPoseDraftSave, assets: FabricatorAssetSave[]) => Promise<void>
  deleteFabricatorPoseDraft: (modelSlot: number) => Promise<void>
  listAnimatorModelSlots: () => Promise<number[]>
  listAnimatorAnimations: (modelSlot: number) => Promise<AnimatorAnimationSummary[]>
  loadAnimatorAnimation: (modelSlot: number, slot: number) => Promise<AnimatorAnimation | null>
  saveAnimatorAnimation: (modelSlot: number, slot: number, animation: AnimatorAnimationSave, assets: AnimatorAnimationAsset[]) => Promise<void>
  deleteAnimatorAnimation: (modelSlot: number, slot: number) => Promise<void>
  loadAnimatorDraft: (modelSlot: number) => Promise<AnimatorAnimationDraft | null>
  saveAnimatorDraft: (modelSlot: number, draft: AnimatorAnimationDraft, assets: AnimatorAnimationAsset[]) => Promise<void>
  deleteAnimatorDraft: (modelSlot: number) => Promise<void>
  listWardrobeSets: (modelSlot: number) => Promise<WardrobeSetSummary[]>
  loadWardrobeSet: (modelSlot: number, id: string) => Promise<WardrobeSet | null>
  saveWardrobeSet: (modelSlot: number, set: WardrobeSetSave, assets: WardrobeAssetSave[]) => Promise<void>
  deleteWardrobeSet: (modelSlot: number, id: string) => Promise<void>
  listFaceSets: (modelSlot: number) => Promise<FaceSetSummary[]>
  loadFaceSet: (modelSlot: number, id: string) => Promise<FaceSet | null>
  saveFaceSet: (modelSlot: number, set: FaceSetSave, assets: FaceAssetSave[]) => Promise<void>
  deleteFaceSet: (modelSlot: number, id: string) => Promise<void>
  listFaceCatalog: (modelSlot: number) => Promise<FaceCatalogItemSummary[]>
  loadFaceCatalogItem: (modelSlot: number, id: string) => Promise<FaceCatalogItem | null>
  saveFaceCatalogItem: (modelSlot: number, item: FaceCatalogItemSave, assets: FaceAssetSave[]) => Promise<void>
  deleteFaceCatalogItem: (modelSlot: number, id: string) => Promise<void>
  listFaceExpressionPresets: (modelSlot: number) => Promise<FaceExpressionPresetSummary[]>
  listFaceExpressionCollections: (modelSlot: number) => Promise<FaceExpressionCollection[]>
  saveFaceExpressionCollection: (modelSlot: number, collection: FaceExpressionCollection) => Promise<void>
  loadFaceExpressionPreset: (modelSlot: number, id: string) => Promise<FaceExpressionPreset | null>
  saveFaceExpressionPreset: (modelSlot: number, preset: FaceExpressionPreset) => Promise<void>
  deleteFaceExpressionPreset: (modelSlot: number, id: string) => Promise<void>
  saveFaceAnimationExport: (modelSlot: number, data: Uint8Array) => Promise<boolean>
  loadFaceExpressionWorkspaceDraft: (modelSlot: number) => Promise<FaceExpressionWorkspaceDraft | null>
  saveFaceExpressionWorkspaceDraft: (modelSlot: number, draft: FaceExpressionWorkspaceDraft) => Promise<void>
  listFaceComponentAssets: (modelSlot: number, kind?: FaceAssetKind) => Promise<FaceComponentAssetSummary[]>
  loadFaceComponentAsset: (modelSlot: number, id: string) => Promise<FaceComponentAsset | null>
  saveFaceComponentAsset: (modelSlot: number, asset: FaceComponentAssetSave, dataUrl: string) => Promise<void>
  deleteFaceComponentAsset: (modelSlot: number, id: string) => Promise<void>
  loadFaceGuides: (profile: FaceGuideProfile) => Promise<Partial<Record<number, FaceGuideSettings>> | null>
  saveFaceGuides: (profile: FaceGuideProfile, guides: Partial<Record<number, FaceGuideSettings>>) => Promise<void>
  loadHairWorkspace: (modelSlot: number) => Promise<HairWorkspace | null>
  saveHairWorkspace: (modelSlot: number, workspace: HairWorkspaceSave, assets: HairWorkspaceAsset[]) => Promise<void>
  listHairStyles: (modelSlot: number) => Promise<HairStyleSummary[]>
  loadHairStyle: (modelSlot: number, id: string) => Promise<HairStyle | null>
  saveHairStyle: (modelSlot: number, style: HairStyleSave, assets: HairStyleAsset[]) => Promise<void>
  deleteHairStyle: (modelSlot: number, id: string) => Promise<void>
}
