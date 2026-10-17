import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSummary, FaceExpressionPreset, FaceExpressionPresetSummary, FaceExpressionTransforms, FaceTransform, FabricatorProject } from '../../../../shared/fabricator'
import { Icon, type IconName } from '../../ui/components/Icon'
import { eyeInteriorMask } from './face/eyeInteriorMask'

type Side = 'left' | 'right'
type PickerCategory = 'eyes' | 'pupils' | 'eyebrows' | 'nose' | 'mouth'
type ComponentKind = 'eye' | 'pupil' | 'eyebrow'
type PairedLayerKind = ComponentKind
type ComponentOption = { key: string; kind: ComponentKind; name: string; leftId: string; rightId: string; ids: string[] }
type CatalogOption = { key: string; item: FaceCatalogItemSummary; ids: string[] }
type ExpressionWorkingCopy = { id: string; composition: ExpressionComposition; transforms: FaceExpressionTransforms; noseOpacity: number }
type ExpressionComposition = {
  eyes: Record<Side, string | null>
  pupils: Record<Side, string | null>
  eyebrows: Record<Side, string | null>
  nose: { catalogId: string; index: number } | null
  mouth: { catalogId: string; kind: 'mouth-closed' | 'mouth-open'; index: number } | null
}
type LayerKey = keyof FaceExpressionTransforms
type PreviewLayerMapping = { layer: LayerKey; startX: number; startY: number; mirroredX: boolean; rotation: number }
type PreviewLayerDrag = {
  pointerId: number
  clientX: number
  clientY: number
  modelPerPixelX: number
  modelPerPixelY: number
  mappings: PreviewLayerMapping[]
}
const presetLayerPairs: Array<{ kind: PairedLayerKind; label: string; keys: [LayerKey, LayerKey]; labels: [string, string] }> = [
  { kind: 'eye', label: 'Olhos', keys: ['eyeLeft', 'eyeRight'], labels: ['Olho esquerdo', 'Olho direito'] },
  { kind: 'pupil', label: 'Pupilas', keys: ['pupilLeft', 'pupilRight'], labels: ['Pupila esquerda', 'Pupila direita'] },
  { kind: 'eyebrow', label: 'Sobrancelhas', keys: ['browLeft', 'browRight'], labels: ['Sobrancelha esquerda', 'Sobrancelha direita'] }
]
const presetSingleLayers: Array<{ key: LayerKey; label: string; icon: IconName }> = [
  { key: 'nose', label: 'Nariz', icon: 'face' }, { key: 'mouth', label: 'Boca', icon: 'message' }
]
const EXPRESSION_COLLECTION_ID = 'standard'
const STANDARD_EXPRESSIONS = [
  'Aliviada', 'Animada', 'Apaixonada', 'Cansada', 'Ciumenta', 'Confusa', 'Decepcionada',
  'Desconfiada', 'Envergonhada', 'Impressionada', 'Indignada', 'Irritada', 'Nojo', 'Normal',
  'Orgulhosa', 'Preocupada', 'Séria', 'Sorrindo de canto', 'Sorriso maligno', 'Surpresa', 'Triste/magoada'
] as const
const identityTransform = (): FaceTransform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
const emptyTransforms = (): FaceExpressionTransforms => ({ eyeLeft: identityTransform(), eyeRight: identityTransform(), pupilLeft: identityTransform(), pupilRight: identityTransform(), browLeft: identityTransform(), browRight: identityTransform(), nose: identityTransform(), mouth: identityTransform() })
const cloneTransforms = (transforms: FaceExpressionTransforms): FaceExpressionTransforms => structuredClone(transforms)
const layerKey = (kind: 'eye' | 'pupil' | 'eyebrow', side: Side): LayerKey => kind === 'eye' ? side === 'left' ? 'eyeLeft' : 'eyeRight' : kind === 'pupil' ? side === 'left' ? 'pupilLeft' : 'pupilRight' : side === 'left' ? 'browLeft' : 'browRight'

function defaultTransforms(composition: ExpressionComposition, components: Record<string, FaceComponentAsset>, catalogs: Record<string, FaceCatalogItem>): FaceExpressionTransforms {
  const transforms = emptyTransforms()
  for (const side of ['left', 'right'] as const) {
    const eye = composition.eyes[side] ? components[composition.eyes[side]!] : undefined
    const pupil = composition.pupils[side] ? components[composition.pupils[side]!] : undefined
    const brow = composition.eyebrows[side] ? components[composition.eyebrows[side]!] : undefined
    if (eye) transforms[layerKey('eye', side)] = { ...eye.defaultTransform }
    if (pupil) transforms[layerKey('pupil', side)] = { ...pupil.defaultTransform }
    if (brow) transforms[layerKey('eyebrow', side)] = { ...brow.defaultTransform }
  }
  const nose = composition.nose ? catalogs[composition.nose.catalogId] : undefined
  const mouth = composition.mouth ? catalogs[composition.mouth.catalogId] : undefined
  if (nose?.transforms.nose) transforms.nose = { ...nose.transforms.nose }
  if (mouth?.transforms.mouth) transforms.mouth = { ...mouth.transforms.mouth }
  return transforms
}

const emptyComposition: ExpressionComposition = {
  eyes: { left: null, right: null }, pupils: { left: null, right: null }, eyebrows: { left: null, right: null }, nose: null, mouth: null
}

function componentSide(asset: FaceComponentAssetSummary): Side {
  return asset.rightSidePositioned || /direit[oa]$/i.test(asset.name) ? 'right' : 'left'
}

function findPairedAsset(asset: FaceComponentAssetSummary, assets: FaceComponentAssetSummary[]): FaceComponentAssetSummary | undefined {
  return assets.find((candidate) => candidate.id !== asset.id && candidate.kind === asset.kind && componentSide(candidate) === 'right'
    && Boolean(asset.pairId && candidate.pairId === asset.pairId))
    ?? assets.find((candidate) => candidate.id !== asset.id && candidate.kind === asset.kind && componentSide(candidate) === 'right'
    && candidate.name.replace(/\s*[·-]\s*(?:Olho|Pupila|Sobrancelha)\s*(?:esquerd[oa]|direit[oa])$/i, '') === asset.name.replace(/\s*[·-]\s*(?:Olho|Pupila|Sobrancelha)\s*(?:esquerd[oa]|direit[oa])$/i, ''))
}

function componentBaseName(name: string): string {
  return name.replace(/\s*[·-]\s*(?:Olho(?: aberto| fechado)?|Pupila|Sobrancelha)\s*(?:esquerd[oa]|direit[oa])$/i, '').trim()
}

function buildComponentOptions(kind: ComponentKind, summaries: FaceComponentAssetSummary[], details: Record<string, FaceComponentAsset>): ComponentOption[] {
  const remaining = summaries.filter((asset) => asset.kind === kind)
  const groups: FaceComponentAssetSummary[][] = []
  while (remaining.length) {
    const group = [remaining.shift()!]
    let expanded = true
    while (expanded) {
      expanded = false
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index]
        const connected = group.some((member) => {
          const memberDetail = details[member.id]
          const candidateDetail = details[candidate.id]
          const sharedPair = Boolean(member.pairId && candidate.pairId && member.pairId === candidate.pairId)
          const sameImage = Boolean(memberDetail?.dataUrl && candidateDetail?.dataUrl && memberDetail.dataUrl === candidateDetail.dataUrl)
          const pairedNames = componentSide(member) !== componentSide(candidate) && componentBaseName(member.name) === componentBaseName(candidate.name)
          return sharedPair || sameImage || pairedNames
        })
        if (connected) { group.push(remaining.splice(index, 1)[0]); expanded = true }
      }
    }
    groups.push(group)
  }

  return groups.map((group) => {
    const right = group.find((asset) => componentSide(asset) === 'right')
    const left = group.find((asset) => componentSide(asset) === 'left') ?? group.find((asset) => asset.id !== right?.id) ?? right!
    const rightAsset = right ?? left
    const uniqueName = componentBaseName(left.name) || componentBaseName(rightAsset.name) || left.name
    return { key: group.map((asset) => asset.id).sort().join(':'), kind, name: uniqueName, leftId: left.id, rightId: rightAsset.id, ids: group.map((asset) => asset.id) }
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

function buildCatalogOptions(summaries: FaceCatalogItemSummary[], items: Record<string, FaceCatalogItem>): CatalogOption[] {
  const groups: Array<{ key: string; item: FaceCatalogItemSummary; ids: string[]; detail?: FaceCatalogItem }> = []
  for (const summary of summaries) {
    const item = items[summary.id]
    const sortedPieces = item?.pieces.slice().sort((a, b) => a.index - b.index)
    const duplicate = item && sortedPieces ? groups.find((group) => {
      const otherPieces = group.detail?.pieces.slice().sort((a, b) => a.index - b.index)
      return group.detail?.category === item.category && Boolean(otherPieces && otherPieces.length === sortedPieces.length
        && otherPieces.every((piece, index) => piece.dataUrl === sortedPieces[index].dataUrl))
    }) : undefined
    const key = `${summary.category}:${summary.id}`
    if (duplicate) duplicate.ids.push(summary.id)
    else groups.push({ key, item: summary, ids: [summary.id], detail: item })
  }
  return groups.map(({ key, item, ids }) => ({ key, item, ids })).sort((a, b) => a.item.name.localeCompare(b.item.name, 'pt-BR'))
}

export function ExpressionPresetWorkspace({ modelSlot }: { modelSlot: number }) {
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [componentSummaries, setComponentSummaries] = useState<FaceComponentAssetSummary[]>([])
  const [componentAssets, setComponentAssets] = useState<Record<string, FaceComponentAsset>>({})
  const [catalogSummaries, setCatalogSummaries] = useState<FaceCatalogItemSummary[]>([])
  const [catalogItems, setCatalogItems] = useState<Record<string, FaceCatalogItem>>({})
  const [eyeMasks, setEyeMasks] = useState<Record<string, string>>({})
  const [composition, setComposition] = useState<ExpressionComposition>(emptyComposition)
  const [draft, setDraft] = useState<ExpressionComposition>(emptyComposition)
  const [transforms, setTransforms] = useState<FaceExpressionTransforms>(emptyTransforms())
  const [draftTransforms, setDraftTransforms] = useState<FaceExpressionTransforms>(emptyTransforms())
  const [baseComposition, setBaseComposition] = useState<ExpressionComposition>(emptyComposition)
  const [baseTransforms, setBaseTransforms] = useState<FaceExpressionTransforms>(emptyTransforms())
  const [noseOpacity, setNoseOpacity] = useState(1)
  const [draftNoseOpacity, setDraftNoseOpacity] = useState(1)
  const [baseNoseOpacity, setBaseNoseOpacity] = useState(1)
  const [presets, setPresets] = useState<FaceExpressionPresetSummary[]>([])
  const [presetId, setPresetId] = useState<string>(() => crypto.randomUUID())
  const [selectedExpressionIndex, setSelectedExpressionIndex] = useState(0)
  const [workingCopies, setWorkingCopies] = useState<Record<number, ExpressionWorkingCopy>>({})
  const [switchingExpression, setSwitchingExpression] = useState(false)
  const [selectedLayer, setSelectedLayer] = useState<LayerKey>('eyeLeft')
  const [linkedLayerPairs, setLinkedLayerPairs] = useState<Record<PairedLayerKind, boolean>>({ eye: false, pupil: false, eyebrow: false })
  const previewLayerDrag = useRef<PreviewLayerDrag | null>(null)
  const previewCanvas = useRef<HTMLDivElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<PickerCategory>('eyes')
  const [mouthKind, setMouthKind] = useState<'mouth-closed' | 'mouth-open'>('mouth-closed')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProject(null)
    setComponentAssets({})
    setCatalogItems({})
    setComposition(emptyComposition)
    setPresets([])
    setSelectedExpressionIndex(0)
    setWorkingCopies({})
    setSwitchingExpression(false)
    setPresetId(crypto.randomUUID())
    void Promise.all([
      window.desktop.loadFabricatorSlot(modelSlot),
      Promise.all([window.desktop.listFaceComponentAssets(modelSlot, 'eye'), window.desktop.listFaceComponentAssets(modelSlot, 'pupil'), window.desktop.listFaceComponentAssets(modelSlot, 'eyebrow')]).then((lists) => lists.flat()),
      window.desktop.listFaceCatalog(modelSlot),
      window.desktop.listFaceExpressionPresets(modelSlot)
    ]).then(async ([model, components, catalogs, savedPresets]) => {
      const facialCatalogs = catalogs.filter((item) => item.category === 'nose' || item.category === 'mouth-closed' || item.category === 'mouth-open')
      const [loadedComponents, loadedCatalogs] = await Promise.all([
        Promise.all(components.map((asset) => window.desktop.loadFaceComponentAsset(modelSlot, asset.id))),
        Promise.all(facialCatalogs.map((item) => window.desktop.loadFaceCatalogItem(modelSlot, item.id)))
      ])
      if (cancelled) return
      const readyComponents = loadedComponents.filter((asset): asset is FaceComponentAsset => Boolean(asset))
      const readyCatalogs = loadedCatalogs.filter((item): item is FaceCatalogItem => Boolean(item))
      setProject(model)
      setComponentSummaries(components)
      setComponentAssets(Object.fromEntries(readyComponents.map((asset) => [asset.id, asset])))
      setCatalogSummaries(facialCatalogs)
      setCatalogItems(Object.fromEntries(readyCatalogs.map((item) => [item.id, item])))
      setPresets(savedPresets)

      const leftEye = readyComponents.find((asset) => asset.kind === 'eye' && componentSide(asset) === 'left')
      const leftPupil = readyComponents.find((asset) => asset.kind === 'pupil' && componentSide(asset) === 'left')
      const leftBrow = readyComponents.find((asset) => asset.kind === 'eyebrow' && componentSide(asset) === 'left')
      const rightEye = leftEye ? findPairedAsset(leftEye, components) : readyComponents.find((asset) => asset.kind === 'eye' && componentSide(asset) === 'right')
      const rightPupil = leftPupil ? findPairedAsset(leftPupil, components) : readyComponents.find((asset) => asset.kind === 'pupil' && componentSide(asset) === 'right')
      const rightBrow = leftBrow ? findPairedAsset(leftBrow, components) : readyComponents.find((asset) => asset.kind === 'eyebrow' && componentSide(asset) === 'right')
      const nose = readyCatalogs.find((item) => item.category === 'nose')
      const mouth = readyCatalogs.find((item) => item.category === 'mouth-closed') ?? readyCatalogs.find((item) => item.category === 'mouth-open')
      const initial: ExpressionComposition = {
        eyes: { left: leftEye?.id ?? null, right: rightEye?.id ?? leftEye?.id ?? null },
        pupils: { left: leftPupil?.id ?? null, right: rightPupil?.id ?? leftPupil?.id ?? null },
        eyebrows: { left: leftBrow?.id ?? null, right: rightBrow?.id ?? leftBrow?.id ?? null },
        nose: nose ? { catalogId: nose.id, index: nose.pieces[0]?.index ?? 0 } : null,
        mouth: mouth ? { catalogId: mouth.id, kind: mouth.category as 'mouth-closed' | 'mouth-open', index: mouth.pieces[0]?.index ?? 0 } : null
      }
      const initialTransforms = defaultTransforms(initial, Object.fromEntries(readyComponents.map((asset) => [asset.id, asset])), Object.fromEntries(readyCatalogs.map((item) => [item.id, item])))
      const firstPresetSummary = savedPresets.find((preset) => preset.collectionId === EXPRESSION_COLLECTION_ID && preset.expressionIndex === 0)
      const selectedPreset = firstPresetSummary ? await window.desktop.loadFaceExpressionPreset(modelSlot, firstPresetSummary.id) : null
      if (cancelled) return
      setBaseComposition(initial)
      setBaseTransforms(initialTransforms)
      setBaseNoseOpacity(nose?.opacity ?? 1)
      if (selectedPreset) {
        setPresetId(selectedPreset.id); setComposition(selectedPreset.selections); setTransforms(selectedPreset.transforms); setNoseOpacity(selectedPreset.noseOpacity)
      } else {
        setPresetId(crypto.randomUUID()); setComposition(initial); setTransforms(initialTransforms); setNoseOpacity(nose?.opacity ?? 1)
      }
      setError(null)
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os itens faciais deste modelo.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [modelSlot])

  useEffect(() => {
    let cancelled = false
    const eyes = Object.values(componentAssets).filter((asset) => asset.kind === 'eye')
    void Promise.all(eyes.map(async (asset) => [asset.id, await eyeInteriorMask(asset.dataUrl)] as const)).then((entries) => {
      if (cancelled) return
      setEyeMasks((current) => ({ ...current, ...Object.fromEntries(entries) }))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [componentAssets])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDraft(composition); setDraftTransforms(cloneTransforms(transforms)); setDraftNoseOpacity(noseOpacity); setOpen(false) } }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, composition, transforms, noseOpacity])

  const head = useMemo(() => project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [project])
  const visibleComposition = open ? draft : composition
  const visibleTransforms = open ? draftTransforms : transforms
  const visibleNoseOpacity = open ? draftNoseOpacity : noseOpacity
  const activeExpressionName = STANDARD_EXPRESSIONS[selectedExpressionIndex]
  const expressionPresetByIndex = useMemo(() => new Map(presets
    .filter((preset) => preset.collectionId === EXPRESSION_COLLECTION_ID && Number.isInteger(preset.expressionIndex))
    .map((preset) => [preset.expressionIndex!, preset])), [presets])
  const selectedCatalog = category === 'nose'
    ? catalogItems[draft.nose?.catalogId ?? '']
    : category === 'mouth' && draft.mouth?.kind === mouthKind ? catalogItems[draft.mouth.catalogId] : undefined
  const filteredCatalogOptions = useMemo(() => buildCatalogOptions(
    catalogSummaries.filter((item) => category === 'nose' ? item.category === 'nose' : item.category === mouthKind),
    catalogItems
  ), [catalogSummaries, catalogItems, category, mouthKind])
  const componentOptions = useMemo(() => ({
    eye: buildComponentOptions('eye', componentSummaries, componentAssets),
    pupil: buildComponentOptions('pupil', componentSummaries, componentAssets),
    eyebrow: buildComponentOptions('eyebrow', componentSummaries, componentAssets)
  }), [componentSummaries, componentAssets])
  const selectedOptionKind: ComponentKind | null = category === 'eyes' ? 'eye' : category === 'pupils' ? 'pupil' : category === 'eyebrows' ? 'eyebrow' : null
  const selectedOptionKey = selectedOptionKind ? componentOptions[selectedOptionKind].find((option) => {
    const field = selectedOptionKind === 'eye' ? draft.eyes : selectedOptionKind === 'pupil' ? draft.pupils : draft.eyebrows
    return Boolean(field.left && field.right && option.ids.includes(field.left) && option.ids.includes(field.right))
  })?.key : undefined
  const visibleComponentOptions = selectedOptionKind ? componentOptions[selectedOptionKind] : []
  const setComponentChoice = (option: ComponentOption) => {
    const field = option.kind === 'eye' ? 'eyes' : option.kind === 'pupil' ? 'pupils' : 'eyebrows'
    const leftKey = layerKey(option.kind, 'left')
    const rightKey = layerKey(option.kind, 'right')
    const leftAsset = componentAssets[option.leftId]
    const rightAsset = componentAssets[option.rightId]
    setDraft((current) => ({ ...current, [field]: { left: option.leftId, right: option.rightId } }))
    setDraftTransforms((current) => ({ ...current,
      ...(leftAsset ? { [leftKey]: { ...leftAsset.defaultTransform } } : {}),
      ...(rightAsset ? { [rightKey]: { ...rightAsset.defaultTransform } } : {})
    }))
  }

  const chooseCatalog = (summary: FaceCatalogItemSummary) => {
    const item = catalogItems[summary.id]
    if (!item) return
    if (category === 'nose') {
      setDraft((current) => ({ ...current, nose: { catalogId: item.id, index: item.pieces[0]?.index ?? 0 } }))
      if (item.transforms.nose) setDraftTransforms((current) => ({ ...current, nose: { ...item.transforms.nose! } }))
      setDraftNoseOpacity(item.opacity ?? 1)
    } else {
      const expressionPiece = item.pieces.find((piece) => piece.index === selectedExpressionIndex) ?? item.pieces[0]
      setDraft((current) => ({ ...current, mouth: { catalogId: item.id, kind: item.category as 'mouth-closed' | 'mouth-open', index: expressionPiece?.index ?? 0 } }))
      if (item.transforms.mouth) setDraftTransforms((current) => ({ ...current, mouth: { ...item.transforms.mouth! } }))
    }
  }

  const beginChoosing = () => { setDraft(composition); setDraftTransforms(cloneTransforms(transforms)); setDraftNoseOpacity(noseOpacity); setCategory('eyes'); setOpen(true) }
  const applyComposition = () => {
    const nextTransforms = cloneTransforms(draftTransforms)
    setComposition(draft); setTransforms(nextTransforms); setNoseOpacity(draftNoseOpacity)
    setBaseComposition(draft); setBaseTransforms(nextTransforms); setBaseNoseOpacity(draftNoseOpacity)
    setOpen(false); setError(null)
  }
  const cancelChoosing = () => { setDraft(composition); setDraftTransforms(cloneTransforms(transforms)); setDraftNoseOpacity(noseOpacity); setOpen(false) }
  const updateLayerTransform = (key: LayerKey, patch: Partial<FaceTransform>) => setTransforms((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  const beginPreviewLayerDrag = (event: ReactPointerEvent<HTMLElement>, requestedMappings: Array<Omit<PreviewLayerMapping, 'startX' | 'startY'>>) => {
    if (!requestedMappings.some(({ layer }) => layer === selectedLayer) || !head || event.button !== 0 && event.pointerType === 'mouse') return
    const bounds = previewCanvas.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const mappings: PreviewLayerMapping[] = requestedMappings.map((mapping) => ({
      ...mapping, startX: transforms[mapping.layer].x, startY: transforms[mapping.layer].y
    }))
    previewLayerDrag.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      modelPerPixelX: head.width / bounds.width, modelPerPixelY: head.height / bounds.height,
      mappings
    }
  }
  const movePreviewLayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = previewLayerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const screenX = (event.clientX - drag.clientX) * drag.modelPerPixelX
    const screenY = (event.clientY - drag.clientY) * drag.modelPerPixelY
    setTransforms((current) => {
      const next = { ...current }
      for (const mapping of drag.mappings) {
        const rotatedPupil = mapping.layer === 'pupilLeft' || mapping.layer === 'pupilRight'
        const radians = rotatedPupil ? mapping.rotation * Math.PI / 180 : 0
        const localX = screenX * Math.cos(radians) + screenY * Math.sin(radians)
        const localY = -screenX * Math.sin(radians) + screenY * Math.cos(radians)
        next[mapping.layer] = {
          ...current[mapping.layer],
          x: mapping.startX + localX * (mapping.mirroredX ? -1 : 1),
          y: mapping.startY + localY
        }
      }
      return next
    })
  }
  const endPreviewLayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (previewLayerDrag.current?.pointerId !== event.pointerId) return
    previewLayerDrag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resetSelectedLayer = () => {
    const assetId = selectedLayer === 'eyeLeft' ? composition.eyes.left : selectedLayer === 'eyeRight' ? composition.eyes.right
      : selectedLayer === 'pupilLeft' ? composition.pupils.left : selectedLayer === 'pupilRight' ? composition.pupils.right
        : selectedLayer === 'browLeft' ? composition.eyebrows.left : selectedLayer === 'browRight' ? composition.eyebrows.right : null
    const assetTransform = assetId ? componentAssets[assetId]?.defaultTransform : undefined
    const catalog = selectedLayer === 'nose' && composition.nose ? catalogItems[composition.nose.catalogId]
      : selectedLayer === 'mouth' && composition.mouth ? catalogItems[composition.mouth.catalogId] : undefined
    const catalogTransform = selectedLayer === 'nose' ? catalog?.transforms.nose : selectedLayer === 'mouth' ? catalog?.transforms.mouth : undefined
    setTransforms((current) => ({ ...current, [selectedLayer]: { ...(assetTransform ?? catalogTransform ?? identityTransform()) } }))
    if (selectedLayer === 'nose') setNoseOpacity(catalog?.opacity ?? 1)
  }
  const selectExpression = async (index: number) => {
    if (index === selectedExpressionIndex || switchingExpression || saving) return
    setSwitchingExpression(true)
    setError(null)
    setWorkingCopies((current) => ({ ...current, [selectedExpressionIndex]: {
      id: presetId, composition: structuredClone(composition), transforms: cloneTransforms(transforms), noseOpacity
    } }))
    setSelectedExpressionIndex(index)
    try {
      const workingCopy = workingCopies[index]
      if (workingCopy) {
        setPresetId(workingCopy.id); setComposition(workingCopy.composition); setTransforms(cloneTransforms(workingCopy.transforms)); setNoseOpacity(workingCopy.noseOpacity)
        return
      }
      const summary = expressionPresetByIndex.get(index)
      const saved = summary ? await window.desktop.loadFaceExpressionPreset(modelSlot, summary.id) : null
      if (saved) {
        setPresetId(saved.id); setComposition(saved.selections); setTransforms(saved.transforms); setNoseOpacity(saved.noseOpacity)
        return
      }
      const nextComposition = structuredClone(baseComposition)
      if (nextComposition.mouth) {
        const mouth = catalogItems[nextComposition.mouth.catalogId]
        if (mouth?.pieces.some((piece) => piece.index === index)) nextComposition.mouth.index = index
      }
      setPresetId(crypto.randomUUID()); setComposition(nextComposition); setTransforms(cloneTransforms(baseTransforms)); setNoseOpacity(baseNoseOpacity)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta expressão.')
    } finally {
      setSwitchingExpression(false)
    }
  }
  const saveCurrentPreset = async () => {
    setSaving(true); setError(null)
    const saved: FaceExpressionPreset = {
      schemaVersion: 1, id: presetId, modelSlot, name: activeExpressionName,
      collectionId: EXPRESSION_COLLECTION_ID, expressionIndex: selectedExpressionIndex,
      selections: structuredClone(composition), transforms: cloneTransforms(transforms), noseOpacity, updatedAt: new Date().toISOString()
    }
    try {
      await window.desktop.saveFaceExpressionPreset(modelSlot, saved)
      setPresetId(saved.id)
      setWorkingCopies((current) => ({ ...current, [selectedExpressionIndex]: { id: saved.id, composition: saved.selections, transforms: saved.transforms, noseOpacity: saved.noseOpacity } }))
      setPresets(await window.desktop.listFaceExpressionPresets(modelSlot))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar este preset.') }
    finally { setSaving(false) }
  }

  const renderComponent = (assetId: string | null, kind: 'eye' | 'pupil' | 'eyebrow', currentSide: Side, transform: FaceTransform, eyeAsset?: FaceComponentAsset, eyeTransformOverride?: FaceTransform): ReactNode => {
    if (!head || !assetId) return null
    const asset = componentAssets[assetId]
    if (!asset || asset.kind !== kind) return null
    const right = currentSide === 'right'
    // A name such as "Olho direito" identifies the library slot; it does not
    // prove that the pixels are already positioned as a right-side asset.
    // Olhos Dev uses this metadata alone to decide whether the image needs mirroring.
    const physicallyRight = asset.rightSidePositioned === true
    if (kind !== 'pupil') {
      const mirrored = right && !physicallyRight
      const layer = layerKey(kind, currentSide)
      const pairedSide = right ? 'left' : 'right'
      const pairedLayer = layerKey(kind, pairedSide)
      const movePair = linkedLayerPairs[kind]
      const canDrag = selectedLayer === layer || movePair && selectedLayer === pairedLayer
      const pairedAssetId = kind === 'eye' ? visibleComposition.eyes[pairedSide] : visibleComposition.eyebrows[pairedSide]
      const pairedAsset = pairedAssetId ? componentAssets[pairedAssetId] : undefined
      const dragMappings: Array<Omit<PreviewLayerMapping, 'startX' | 'startY'>> = [{ layer, mirroredX: mirrored, rotation: 0 }]
      if (movePair && pairedAsset) dragMappings.push({ layer: pairedLayer, mirroredX: pairedSide === 'right' && pairedAsset.rightSidePositioned !== true, rotation: 0 })
      const x = mirrored ? head.width - transform.x : transform.x
      const rotation = mirrored ? -transform.rotation : transform.rotation
      const imageStyle: CSSProperties = {
        left: `${x / head.width * 100}%`, top: `${transform.y / head.height * 100}%`,
        width: `${asset.width * transform.scaleX / head.width * 100}%`, height: `${asset.height * transform.scaleY / head.height * 100}%`,
        zIndex: kind === 'eyebrow' ? 4 : 2,
        transform: `translate(-50%,-50%) rotate(${rotation}deg) scaleX(${Boolean(transform.flipX) !== mirrored ? -1 : 1})`,
        pointerEvents: canDrag ? 'auto' : 'none', cursor: canDrag ? 'grab' : undefined, touchAction: canDrag ? 'none' : undefined
      }
      return <img key={`${kind}-${asset.id}-${right}`} className="expression-head-piece" src={asset.dataUrl} alt={canDrag ? `Arraste para mover ${layer === 'browLeft' || layer === 'browRight' ? 'a sobrancelha' : 'o olho'}` : ''} style={imageStyle}
        onPointerDown={canDrag ? (event) => beginPreviewLayerDrag(event, dragMappings) : undefined}
        onPointerMove={canDrag ? movePreviewLayerDrag : undefined} onPointerUp={canDrag ? endPreviewLayerDrag : undefined}
        onPointerCancel={canDrag ? endPreviewLayerDrag : undefined} onLostPointerCapture={canDrag ? endPreviewLayerDrag : undefined} />
    }
    if (!eyeAsset) return null
    const eyeTransform = eyeTransformOverride ?? eyeAsset.defaultTransform
    const eyePhysicallyRight = eyeAsset.rightSidePositioned === true
    const eyeMirrored = right && !eyePhysicallyRight
    const eyeX = eyeMirrored ? head.width - eyeTransform.x : eyeTransform.x
    const eyeRotation = eyeMirrored ? -eyeTransform.rotation : eyeTransform.rotation
    const pupilTransform = transform
    const mirroredPupilX = right && !physicallyRight
    const pupilX = mirroredPupilX ? -pupilTransform.x : pupilTransform.x
    const eyeFlip = Boolean(eyeTransform.flipX) !== eyeMirrored
    const eyeFlipDirection = eyeFlip ? -1 : 1
    const maskStyle: CSSProperties = {
      left: `${eyeX / head.width * 100}%`, top: `${eyeTransform.y / head.height * 100}%`,
      width: `${eyeAsset.width * eyeTransform.scaleX / head.width * 100}%`, height: `${eyeAsset.height * eyeTransform.scaleY / head.height * 100}%`,
      transform: `translate(-50%,-50%) rotate(${eyeRotation}deg) scaleX(${eyeFlipDirection})`,
      // Match Olhos Dev: keep the source alpha mask until its sclera-only mask
      // finishes generating, so the pupil never flashes outside the eye.
      maskImage: `url(${eyeMasks[eyeAsset.id] ?? eyeAsset.dataUrl})`,
      WebkitMaskImage: `url(${eyeMasks[eyeAsset.id] ?? eyeAsset.dataUrl})`
    }
    const pupilStyle: CSSProperties = {
      left: `${50 + pupilX / (eyeFlipDirection * eyeTransform.scaleX * eyeAsset.width) * 100}%`,
      top: `${50 + pupilTransform.y / (eyeAsset.height * eyeTransform.scaleY) * 100}%`,
      width: `${pupilTransform.scaleX * 100}%`, height: `${pupilTransform.scaleY * 100}%`,
      transform: `translate(-50%,-50%) rotate(${pupilTransform.rotation * (right && !physicallyRight ? -1 : 1) * eyeFlipDirection}deg) scaleX(${Boolean(pupilTransform.flipX) !== eyeFlip ? -1 : 1})`
    }
    const pupilLayer = layerKey('pupil', currentSide)
    const pairedSide = right ? 'left' : 'right'
    const pairedPupilLayer = layerKey('pupil', pairedSide)
    const movePair = linkedLayerPairs.pupil
    const canDrag = selectedLayer === pupilLayer || movePair && selectedLayer === pairedPupilLayer
    const pairedPupilId = visibleComposition.pupils[pairedSide]
    const pairedEyeId = visibleComposition.eyes[pairedSide]
    const pairedPupilAsset = pairedPupilId ? componentAssets[pairedPupilId] : undefined
    const pairedEyeAsset = pairedEyeId ? componentAssets[pairedEyeId] : undefined
    const pairedEyeTransform = visibleTransforms[layerKey('eye', pairedSide)]
    const pairedEyeMirrored = pairedSide === 'right' && pairedEyeAsset?.rightSidePositioned !== true
    const pairedEyeRotation = pairedEyeMirrored ? -pairedEyeTransform.rotation : pairedEyeTransform.rotation
    const dragMappings: Array<Omit<PreviewLayerMapping, 'startX' | 'startY'>> = [{ layer: pupilLayer, mirroredX: mirroredPupilX, rotation: eyeRotation }]
    if (movePair && pairedPupilAsset && pairedEyeAsset) dragMappings.push({
      layer: layerKey('pupil', pairedSide), mirroredX: pairedSide === 'right' && pairedPupilAsset.rightSidePositioned !== true, rotation: pairedEyeRotation
    })
    return <span key={`${kind}-${asset.id}-${right}`} className="expression-head-pupil-mask" style={{ ...maskStyle, pointerEvents: canDrag ? 'auto' : 'none', cursor: canDrag ? 'grab' : undefined, touchAction: canDrag ? 'none' : undefined }}
      onPointerDown={canDrag ? (event) => beginPreviewLayerDrag(event, dragMappings) : undefined}
      onPointerMove={canDrag ? movePreviewLayerDrag : undefined} onPointerUp={canDrag ? endPreviewLayerDrag : undefined}
      onPointerCancel={canDrag ? endPreviewLayerDrag : undefined} onLostPointerCapture={canDrag ? endPreviewLayerDrag : undefined}>
      <img src={asset.dataUrl} alt={canDrag ? `Arraste para mover a pupila ${right ? 'direita' : 'esquerda'}` : ''} style={pupilStyle} />
    </span>
  }

  const renderCatalogPiece = (choice: ExpressionComposition['nose'] | NonNullable<ExpressionComposition['mouth']>, type: 'nose' | 'mouth'): ReactNode => {
    if (!head || !choice) return null
    const item = catalogItems[choice.catalogId]
    const piece = item?.pieces.find((entry) => entry.index === choice.index)
    const transform = visibleTransforms[type]
    if (!item || !piece || !transform) return null
    const style: CSSProperties = {
      left: `${transform.x / head.width * 100}%`, top: `${transform.y / head.height * 100}%`,
      width: `${piece.width * transform.scaleX / head.width * 100}%`, height: `${piece.height * transform.scaleY / head.height * 100}%`,
      opacity: type === 'nose' ? visibleNoseOpacity : 1,
      transform: `translate(-50%,-50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`,
      pointerEvents: selectedLayer === type ? 'auto' : 'none', cursor: selectedLayer === type ? 'grab' : undefined, touchAction: selectedLayer === type ? 'none' : undefined
    }
    const canDrag = selectedLayer === type
    return <img key={`${type}-${item.id}-${piece.id}`} className="expression-head-piece" src={piece.dataUrl} alt={canDrag ? `Arraste para mover ${type === 'nose' ? 'o nariz' : 'a boca'}` : ''} style={style}
      onPointerDown={canDrag ? (event) => beginPreviewLayerDrag(event, [{ layer: type, mirroredX: false, rotation: 0 }]) : undefined}
      onPointerMove={canDrag ? movePreviewLayerDrag : undefined} onPointerUp={canDrag ? endPreviewLayerDrag : undefined}
      onPointerCancel={canDrag ? endPreviewLayerDrag : undefined} onLostPointerCapture={canDrag ? endPreviewLayerDrag : undefined} />
  }

  return <section className="fabricator-workspace expression-preset-workspace" aria-label="Preset Expressão Dev">
    <header className="expression-preset-toolbar">
      <button className="expression-choose-set-button" onClick={beginChoosing} disabled={loading || !head} type="button"><Icon name="face" />Escolher conjunto</button>
      <span className="model-slot-logo"><Icon name="face" /></span>
      <strong>Preset Expressão Dev</strong>
      <span className="expression-current-title"><b>{String(selectedExpressionIndex + 1).padStart(2, '0')}</b>{activeExpressionName}</span>
      <span className="expression-preset-toolbar-spacer" />
      <span className="expression-preset-model-label">Modelo {String(modelSlot).padStart(2, '0')} · {project?.name ?? 'sem modelo'}</span>
      <button className="expression-save-button" onClick={() => void saveCurrentPreset()} disabled={loading || saving || switchingExpression} type="button"><Icon name="save" />{saving ? 'Salvando…' : `Salvar ${activeExpressionName}`}</button>
    </header>
    {error && <div className="expression-preset-error" role="alert">{error}</div>}
    <div className="expression-preset-body">
    <aside className="expression-collection-panel" aria-label="Conjuntos de expressão">
      <header><strong>Conjuntos</strong><small>1 conjunto</small></header>
      <button className="expression-collection-card active" type="button" aria-pressed="true">
        <span className="expression-collection-icon"><Icon name="face" /></span>
        <span><strong>Padrão</strong><small>21 expressões</small></span>
        <b>›</b>
      </button>
    </aside>
    <aside className="expression-sequence-panel" aria-label="Sequência do conjunto Padrão">
      <header><strong>Padrão</strong><small>Ordem da folha de bocas</small></header>
      <nav className="expression-sequence-list" aria-label="21 expressões padrão">
        {STANDARD_EXPRESSIONS.map((name, index) => {
          const saved = expressionPresetByIndex.has(index)
          const cached = workingCopies[index]
          const isActive = selectedExpressionIndex === index
          return <button key={name} type="button" className={`expression-sequence-item${isActive ? ' active' : ''}`} aria-pressed={isActive} disabled={loading || switchingExpression || saving} onClick={() => void selectExpression(index)}>
            <b>{String(index + 1).padStart(2, '0')}</b><span>{name}</span><small>{isActive ? 'Editando' : saved ? 'Salvo' : cached ? 'Rascunho' : 'Vazio'}</small>
          </button>
        })}
      </nav>
    </aside>
    <main className="expression-head-stage" aria-label="Prévia da cabeça">
      {loading ? <span>Carregando cabeça e biblioteca facial…</span> : head ? <div ref={previewCanvas} className="expression-head-canvas" style={{ aspectRatio: `${head.width} / ${head.height}` }}>
        <img className="expression-head-base" src={head.dataUrl} alt="Cabeça do modelo" />
        {(['left', 'right'] as const).map((currentSide) => {
          const eye = componentAssets[visibleComposition.eyes[currentSide] ?? '']
          const pupil = componentAssets[visibleComposition.pupils[currentSide] ?? '']
          const brow = componentAssets[visibleComposition.eyebrows[currentSide] ?? '']
          return <span className="expression-head-side-layer" key={currentSide} data-side={currentSide}>
            {eye && renderComponent(eye.id, 'eye', currentSide, visibleTransforms[layerKey('eye', currentSide)])}
            {pupil && eye && renderComponent(pupil.id, 'pupil', currentSide, visibleTransforms[layerKey('pupil', currentSide)], eye, visibleTransforms[layerKey('eye', currentSide)])}
            {brow && renderComponent(brow.id, 'eyebrow', currentSide, visibleTransforms[layerKey('eyebrow', currentSide)])}
          </span>
        })}
        {renderCatalogPiece(visibleComposition.nose, 'nose')}
        {renderCatalogPiece(visibleComposition.mouth, 'mouth')}
      </div> : <div className="expression-head-empty"><Icon name="face" /><strong>Este slot ainda não tem uma cabeça</strong><span>Importe um modelo no slot {modelSlot} para montar a prévia da expressão.</span></div>}
      {head && <span className="expression-head-caption">Prévia da cabeça · escolha os assets para ver a composição</span>}
    </main>
    <aside className="expression-preset-inspector">
      <header><strong>Ajustes deste preset</strong><small>Salvos separados de Olhos Dev e Rosto Dev</small></header>
      <section className="expression-layer-picker" aria-label="Peça do preset">
        <strong>Peça</strong>
        <div className="expression-layer-picker-grid">
          {presetLayerPairs.map(({ kind, label, keys, labels }) => <section className="expression-layer-pair" key={kind} aria-label={label}>
            <div role="group" aria-label={`Escolher ${label.toLowerCase()} para ajustar`}>
              {keys.map((key, index) => <button key={key} type="button" aria-pressed={selectedLayer === key} className={selectedLayer === key ? 'active' : ''} onClick={() => setSelectedLayer(key)}>
                <Icon name="eye" /><span>{labels[index]}</span>
              </button>)}
            </div>
            <label><input type="checkbox" checked={linkedLayerPairs[kind]} onChange={(event) => setLinkedLayerPairs((current) => ({ ...current, [kind]: event.target.checked }))} /><span>Mover os dois lados juntos</span></label>
          </section>)}
          <div className="expression-layer-singles" role="group" aria-label="Escolher nariz ou boca para ajustar">
            {presetSingleLayers.map(({ key, label, icon }) => <button key={key} type="button" aria-pressed={selectedLayer === key} className={selectedLayer === key ? 'active' : ''} onClick={() => setSelectedLayer(key)}>
              <Icon name={icon} /><span>{label}</span>
            </button>)}
          </div>
        </div>
      </section>
      {(['x', 'y'] as const).map((field) => <label className="expression-transform-control" key={field}>{field === 'x' ? 'Posição horizontal' : 'Posição vertical'}<input type="range" min={-100} max={Math.max(100, (field === 'x' ? head?.width : head?.height) ?? 100)} step="1" value={transforms[selectedLayer][field]} onChange={(event) => updateLayerTransform(selectedLayer, { [field]: Number(event.target.value) })} /><output>{Math.round(transforms[selectedLayer][field])} px</output></label>)}
      {(['scaleX', 'scaleY'] as const).map((field) => <label className="expression-transform-control" key={field}>{field === 'scaleX' ? 'Largura' : 'Altura'}<input type="range" min="0.02" max="4" step="0.01" value={transforms[selectedLayer][field]} onChange={(event) => updateLayerTransform(selectedLayer, { [field]: Number(event.target.value) })} /><output>{Math.round(transforms[selectedLayer][field] * 100)}%</output></label>)}
      <label className="expression-transform-control">Rotação<input type="range" min="-180" max="180" step="1" value={transforms[selectedLayer].rotation} onChange={(event) => updateLayerTransform(selectedLayer, { rotation: Number(event.target.value) })} /><output>{Math.round(transforms[selectedLayer].rotation)}°</output></label>
      <button className="expression-flip-button" type="button" onClick={() => updateLayerTransform(selectedLayer, { flipX: !transforms[selectedLayer].flipX })}><Icon name="flipHorizontal" />{transforms[selectedLayer].flipX ? 'Desespelhar peça' : 'Espelhar peça'}</button>
      {selectedLayer === 'nose' && <label className="expression-transform-control">Transparência<input type="range" min="0" max="1" step="0.01" value={noseOpacity} onChange={(event) => setNoseOpacity(Number(event.target.value))} /><output>{Math.round((1 - noseOpacity) * 100)}%</output></label>}
      <button className="expression-flip-button" type="button" onClick={resetSelectedLayer}><Icon name="reset" />Restaurar valores emprestados</button>
      <small>Esses valores pertencem apenas ao preset atual. Eles não alteram os assets de origem.</small>
    </aside>
    </div>
    {open && <div className="expression-picker-backdrop" role="presentation" onClick={cancelChoosing}>
      <section className="expression-picker-modal" role="dialog" aria-modal="true" aria-labelledby="expression-picker-title" onClick={(event) => event.stopPropagation()}>
        <header><span><small>MODELO {String(modelSlot).padStart(2, '0')}</small><h2 id="expression-picker-title">Escolher conjunto</h2></span><button aria-label="Fechar" onClick={cancelChoosing} type="button">×</button></header>
        <nav className="expression-picker-categories" aria-label="Categorias faciais">
          {([['eyes', 'Olhos'], ['pupils', 'Pupilas'], ['eyebrows', 'Sobrancelhas'], ['nose', 'Nariz'], ['mouth', 'Boca']] as const).map(([id, label]) => <button key={id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)} type="button">{label}</button>)}
        </nav>
        <div className="expression-picker-content">
          {(category === 'eyes' || category === 'pupils' || category === 'eyebrows') && <>
            <h3>Escolha {category === 'eyes' ? 'um par de olhos' : category === 'pupils' ? 'um par de pupilas' : 'um par de sobrancelhas'}</h3>
            <div className="expression-picker-assets expression-picker-pairs">{visibleComponentOptions.map((option) => {
              const leftAsset = componentAssets[option.leftId]
              const rightAsset = componentAssets[option.rightId]
              return <button key={option.key} className={selectedOptionKey === option.key ? 'selected' : ''} onClick={() => setComponentChoice(option)} type="button">
                <span className="expression-component-option-preview"><img src={leftAsset?.dataUrl} alt="" /><img className={option.leftId === option.rightId ? 'mirrored' : ''} src={rightAsset?.dataUrl} alt="" /></span>
                <span>{option.name}</span><small>Esquerda + direita</small>
              </button>
            })}{!visibleComponentOptions.length && <p className="expression-picker-empty">Nenhuma peça salva nesta categoria.</p>}</div>
          </>}
          {(category === 'nose' || category === 'mouth') && <>
            {category === 'mouth' && <div className="expression-picker-sides"><button className={mouthKind === 'mouth-closed' ? 'active' : ''} onClick={() => setMouthKind('mouth-closed')} type="button">Fechadas</button><button className={mouthKind === 'mouth-open' ? 'active' : ''} onClick={() => setMouthKind('mouth-open')} type="button">Abertas</button></div>}
            <h3>{category === 'nose' ? 'Escolha o nariz' : 'Escolha a folha de bocas'}</h3>
            <div className="expression-picker-assets expression-picker-catalog-assets">{filteredCatalogOptions.map((option) => {
              const item = option.item
              const detail = catalogItems[item.id]
              const selectedId = category === 'nose' ? draft.nose?.catalogId : draft.mouth?.catalogId
              const selected = Boolean(selectedId && option.ids.includes(selectedId))
              const preview = detail?.pieces[0]
              return <button key={option.key} className={selected ? 'selected' : ''} onClick={() => chooseCatalog(item)} type="button"><img src={preview?.dataUrl} alt="" /><span>{item.name}</span><small>{item.pieceCount} peça(s)</small></button>
            })}{!filteredCatalogOptions.length && <p className="expression-picker-empty">Nenhum asset salvo nesta categoria.</p>}</div>
            {selectedCatalog && <><h3>{category === 'nose' ? 'Variante do nariz' : 'Expressão da boca'}{category === 'mouth' ? ' · primeira peça = canto superior esquerdo' : ''}</h3><div className="expression-picker-variants">{selectedCatalog.pieces.map((piece) => {
              const selected = category === 'nose' ? draft.nose?.index === piece.index : draft.mouth?.index === piece.index
              return <button className={selected ? 'selected' : ''} key={piece.id} onClick={() => category === 'nose' ? setDraft((current) => current.nose ? { ...current, nose: { ...current.nose, index: piece.index } } : current) : setDraft((current) => current.mouth ? { ...current, mouth: { ...current.mouth, index: piece.index } } : current)} type="button"><img src={piece.dataUrl} alt="" /><b>{String(piece.index + 1).padStart(2, '0')}</b></button>
            })}</div></>}
          </>}
        </div>
        <footer><span>{draft.eyes.left || draft.eyes.right ? 'Olhos' : 'Sem olhos'} · {draft.pupils.left || draft.pupils.right ? 'pupilas' : 'sem pupilas'} · {draft.nose ? 'nariz' : 'sem nariz'} · {draft.mouth ? 'boca' : 'sem boca'}</span><button className="expression-picker-apply" onClick={applyComposition} type="button"><Icon name="check" />Usar composição</button></footer>
      </section>
    </div>}
  </section>
}
