import { useEffect, useRef, useState } from 'react'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { Icon, type IconName } from '../../ui/components/Icon'
import type { FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, WardrobeCategory, WardrobeSet, WardrobeSetSummary } from '../../../../shared/fabricator'
import type { CustomizerCharacter, CustomizerWardrobeCategory, CustomizerWardrobeGroup } from '../../../../shared/customizer'
import { usePreviewBackground } from '../fabricator/usePreviewBackground'
import { mapWardrobeComponentToPose } from '../fabricator/wardrobe/poseTransform'

type CatalogArtwork = Pick<FabricatorProject, 'width' | 'height' | 'parts' | 'layerOrder' | 'hiddenPartIds'>
const wardrobeImageCache = new Map<string, Promise<HTMLImageElement>>()

function loadCachedImage(source: string): Promise<HTMLImageElement> {
  const cached = wardrobeImageCache.get(source)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem da roupa.'))
    image.src = source
  })
  wardrobeImageCache.set(source, promise)
  void promise.catch(() => wardrobeImageCache.delete(source))
  return promise
}

type ClothingGroupCategory = CustomizerWardrobeCategory
const clothingCategories: Record<'Superior' | 'Inferior', Array<{ id: ClothingGroupCategory; label: string; source: WardrobeCategory[] }>> = {
  Superior: [
    { id: 'camisa', label: 'Camisas', source: ['camisa'] },
    { id: 'manga-superior', label: 'Mangas superiores', source: ['manga-superior'] },
    { id: 'manga-inferior', label: 'Mangas inferiores', source: ['manga-inferior'] }
  ],
  Inferior: [
    { id: 'calca', label: 'Calças', source: ['calca-coxa', 'calca-canela'] },
    { id: 'shorts', label: 'Shorts', source: ['shorts'] }
  ]
}

async function renderWardrobeThumbnail(set: WardrobeSet, categories: WardrobeCategory[]): Promise<string | null> {
  const pieces = set.components.filter((component) => categories.includes(component.category))
  if (!pieces.length) return null
  const left = Math.min(...pieces.map((piece) => piece.x))
  const top = Math.min(...pieces.map((piece) => piece.y))
  const right = Math.max(...pieces.map((piece) => piece.x + piece.width))
  const bottom = Math.max(...pieces.map((piece) => piece.y + piece.height))
  const scale = Math.min(112 / Math.max(1, right - left), 112 / Math.max(1, bottom - top))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((right - left) * scale))
  canvas.height = Math.max(1, Math.ceil((bottom - top) * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const piece of pieces) {
    try {
      const image = await loadCachedImage(piece.dataUrl)
      context.save()
      context.translate((piece.x - left + piece.width / 2) * scale, (piece.y - top + piece.height / 2) * scale)
      context.rotate(piece.rotation * Math.PI / 180)
      context.drawImage(image, -piece.width * scale / 2, -piece.height * scale / 2, piece.width * scale, piece.height * scale)
      context.restore()
    } catch { continue }
  }
  return canvas.toDataURL('image/png')
}

async function renderWardrobeOverlay(
  groups: CustomizerWardrobeGroup[],
  details: Record<string, WardrobeSet>,
  artwork: CatalogArtwork,
  modelSlot: number | null,
  source: FabricatorProject | null
): Promise<string | null> {
  if (!groups.length || modelSlot === null || !source) return null
  const output = document.createElement('canvas')
  output.width = Math.max(1, artwork.width)
  output.height = Math.max(1, artwork.height)
  const outputContext = output.getContext('2d')
  if (!outputContext) return null
  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const bodyOrder = (artwork.layerOrder ?? []).filter((id, index, order) => artwork.parts.some((part) => part.id === id) && order.indexOf(id) === index)
  for (const part of artwork.parts) if (!bodyOrder.includes(part.id)) bodyOrder.push(part.id)
  const garmentLayers = new Map<string, Array<{ group: CustomizerWardrobeGroup; component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }>>()
  let sequence = 0

  // Match the wardrobe pose test: each garment is inserted immediately above
  // the model layer it is attached to, before the next body layer is drawn.
  for (const group of groups) {
    const set = details[`${group.modelSlot}:${group.setId}`]
    if (!set || group.modelSlot !== modelSlot) continue
    const accepted = clothingCategories[group.category === 'calca' || group.category === 'shorts' ? 'Inferior' : 'Superior']
      .find((category) => category.id === group.category)?.source
    if (!accepted) continue
    const components = set.components.filter((component) => accepted.includes(component.category))
    if (!components.length) continue
    const mapped: Array<{ component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }> = []
    for (const component of components) {
      const sourceBone = source.parts.find((part) => part.id === component.attachedPartId)
      const targetBone = artwork.parts.find((part) => part.id === component.attachedPartId)
      if (!sourceBone || !targetBone) continue
      const hasThighAndCalf = components.some((piece) => piece.category === 'calca-coxa') && components.some((piece) => piece.category === 'calca-canela')
      const kneeOverlap = hasThighAndCalf && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
      const sleeveEdgePadding = component.category === 'manga-superior' || component.category === 'manga-inferior'
        ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06)))
        : 0
      const transform = mapWardrobeComponentToPose(component, sourceBone, targetBone, kneeOverlap, sleeveEdgePadding)
      mapped.push({ component, transform, center: transform.origin, sequence: sequence++ })
    }
    if (!mapped.length) continue
    const center = mapped.reduce((sum, item) => ({ x: sum.x + item.center.x / mapped.length, y: sum.y + item.center.y / mapped.length }), { x: 0, y: 0 })
    for (const item of mapped) {
      const layer = garmentLayers.get(item.component.attachedPartId) ?? []
      layer.push({ group, ...item, center })
      garmentLayers.set(item.component.attachedPartId, layer)
    }
  }

  for (const partId of bodyOrder) {
    const part = artwork.parts.find((item) => item.id === partId)
    if (!part) continue
    if (!hidden.has(part.id)) {
      try {
        const image = await loadCachedImage(part.dataUrl)
        outputContext.save()
        outputContext.translate(part.x + part.width / 2, part.y + part.height / 2)
        outputContext.rotate(part.rotation * Math.PI / 180)
        outputContext.drawImage(image, -part.width / 2, -part.height / 2, part.width, part.height)
        outputContext.restore()
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
    const garments = (garmentLayers.get(part.id) ?? []).sort((a, b) => a.sequence - b.sequence)
    for (const garment of garments) {
      try {
        const image = await loadCachedImage(garment.component.dataUrl)
        const matrix = /^matrix\(([^)]+)\)$/.exec(garment.transform.matrix)?.[1].split(',').map(Number) ?? [1, 0, 0, 1, 0, 0]
        outputContext.save()
        outputContext.translate(garment.center.x + garment.group.offsetX, garment.center.y + garment.group.offsetY)
        outputContext.rotate(garment.group.rotation * Math.PI / 180)
        outputContext.scale(garment.group.scaleX, garment.group.scaleY)
        outputContext.translate(-garment.center.x, -garment.center.y)
        outputContext.translate(garment.transform.origin.x, garment.transform.origin.y)
        outputContext.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
        outputContext.translate(garment.transform.localLeft + garment.transform.renderWidth / 2, garment.transform.localTop + garment.transform.renderHeight / 2)
        outputContext.rotate(garment.transform.localRotation * Math.PI / 180)
        outputContext.drawImage(image, -garment.transform.renderWidth / 2, -garment.transform.renderHeight / 2, garment.transform.renderWidth, garment.transform.renderHeight)
        outputContext.restore()
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
  }
  return output.toDataURL('image/png')
}

async function renderArtwork(artwork: CatalogArtwork, maxSize: number): Promise<string | null> {
  if (artwork.width <= 0 || artwork.height <= 0) return null
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale))
  canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null

  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const layerIndex = new Map((artwork.layerOrder ?? []).map((id, index) => [id, index]))
  const parts = artwork.parts
    .filter((part) => !hidden.has(part.id))
    .map((part, index) => ({ part, index }))
    .sort((a, b) => (layerIndex.get(a.part.id) ?? a.index) - (layerIndex.get(b.part.id) ?? b.index))

  for (const { part } of parts) {
    try {
      const image = new Image()
      image.src = part.dataUrl
      if (image.decode) await image.decode()
      else await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Não foi possível carregar uma parte da prévia.'))
      })
      context.save()
      try {
        context.translate((part.x + part.width / 2) * scale, (part.y + part.height / 2) * scale)
        context.rotate(part.rotation * Math.PI / 180)
        context.drawImage(image, -part.width * scale / 2, -part.height * scale / 2, part.width * scale, part.height * scale)
      } finally {
        context.restore()
      }
    } catch {
      continue
    }
  }

  return canvas.toDataURL('image/png')
}

const modules: { name: string; icon: IconName; detail: string }[] = [
  { name: 'Modelos', icon: 'sparkles', detail: 'Looks prontos para começar' },
  { name: 'Poses', icon: 'body', detail: 'Pose, proporções e detalhes' },
  { name: 'Cabeça', icon: 'face', detail: 'Rosto, cabelo e expressões' },
  { name: 'Roupas', icon: 'shirt', detail: 'Monte um visual único' },
  { name: 'Acessórios', icon: 'flower', detail: 'Peças e objetos de cena' },
  { name: 'Diálogos', icon: 'message', detail: 'Balões e falas' },
  { name: 'Mascotes', icon: 'paw', detail: 'Seus companheiros' },
  { name: 'Objetos', icon: 'box', detail: 'Itens para compor a cena' },
  { name: 'Perfil', icon: 'user', detail: 'Identidade do personagem' }
]

export function CustomizerPage() {
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [charactersLoading, setCharactersLoading] = useState(true)
  const [charactersError, setCharactersError] = useState('')
  const [characterSaveState, setCharacterSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [savingCharacter, setSavingCharacter] = useState(false)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [previewBackground, setPreviewBackground] = usePreviewBackground()
  const [rosterQuery, setRosterQuery] = useState('')
  const [catalogModels, setCatalogModels] = useState<FabricatorSlotSummary[]>([])
  const [catalogPoses, setCatalogPoses] = useState<FabricatorPoseSummary[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCatalogModelSlot, setSelectedCatalogModelSlot] = useState<number | null>(null)
  const [selectedCatalogPoseSlot, setSelectedCatalogPoseSlot] = useState<number | null>(null)
  const [modelThumbnails, setModelThumbnails] = useState<Record<number, string>>({})
  const [poseThumbnails, setPoseThumbnails] = useState<Record<string, string>>({})
  const [clothingSection, setClothingSection] = useState<'Superior' | 'Inferior'>('Superior')
  const [wardrobeSets, setWardrobeSets] = useState<WardrobeSetSummary[]>([])
  const [wardrobeLoading, setWardrobeLoading] = useState(false)
  const [wardrobeDetails, setWardrobeDetails] = useState<Record<string, WardrobeSet>>({})
  const [wardrobeThumbnails, setWardrobeThumbnails] = useState<Record<string, string>>({})
  const [selectedClothing, setSelectedClothing] = useState<{ setId: string; category: ClothingGroupCategory } | null>(null)
  const [selectedWardrobeUrl, setSelectedWardrobeUrl] = useState<string | null>(null)
  const [selectedArtworkProject, setSelectedArtworkProject] = useState<CatalogArtwork | null>(null)
  const [selectedSourceModelProject, setSelectedSourceModelProject] = useState<FabricatorProject | null>(null)
  const [selectedArtworkUrl, setSelectedArtworkUrl] = useState<string | null>(null)
  const [selectedArtworkLabel, setSelectedArtworkLabel] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const thumbnailCache = useRef(new Set<string>())
  const previewLoadRequest = useRef(0)
  const clothingDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; scale: number; startX: number; startY: number; groupKey: string; characterId: string; latest: CustomizerCharacter | null } | null>(null)
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0] ?? null
  const visibleCharacters = characters
    .filter((character) => character.name.toLowerCase().includes(rosterQuery.trim().toLowerCase()))

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((loaded) => {
      if (cancelled) return
      setCharacters(loaded)
      let remembered = ''
      try { remembered = localStorage.getItem('nymi.customizer.activeCharacter') ?? '' } catch { /* Storage preferences are optional. */ }
      setSelectedCharacterId(loaded.some((character) => character.id === remembered) ? remembered : loaded[0]?.id ?? '')
    }).catch((reason: unknown) => {
      if (!cancelled) setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível carregar os personagens.')
    }).finally(() => { if (!cancelled) setCharactersLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try {
      if (selectedCharacterId) localStorage.setItem('nymi.customizer.activeCharacter', selectedCharacterId)
      else localStorage.removeItem('nymi.customizer.activeCharacter')
    } catch { /* Selection persistence is best-effort; character data is stored by Electron. */ }
  }, [selectedCharacterId])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listFabricatorPoseSlots()])
      .then(async ([models, poses]) => {
        if (cancelled) return
        setCatalogModels(models)
        setCatalogPoses(poses)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo.')
          setPreviewLoading(false)
        }
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => {
      cancelled = true
      previewLoadRequest.current += 1
    }
  }, [])

  useEffect(() => {
    if (catalogLoading) return
    if (!selectedCharacter) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const model = catalogModels.find((item) => item?.slot === selectedCharacter.customization.modelSlot)
      ?? catalogModels.find((item) => item?.slot === 1)
      ?? catalogModels.find((item) => item !== null)
    if (!model) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const requestedPose = selectedCharacter.customization.poseSlot
    const pose = requestedPose === null ? null : catalogPoses.find((item) => item?.sourceModelSlot === model.slot && item.slot === requestedPose)
    const requestId = ++previewLoadRequest.current
    let cancelled = false
    setSelectedCatalogModelSlot(model.slot)
    setSelectedCatalogPoseSlot(pose?.slot ?? null)
    setSelectedArtworkLabel(pose?.name ?? model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    void (async () => {
      try {
        const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
        if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
        const artwork = pose ? await window.desktop.loadFabricatorPose(model.slot, pose.slot) : sourceProject
        if (!artwork) throw new Error('Não foi possível carregar a prévia deste personagem.')
        if (!cancelled && previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject) }
        const artworkUrl = await renderArtwork(artwork, 720)
        if (!cancelled && previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
      } catch (reason) {
        if (!cancelled && previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar a prévia.')
      } finally {
        if (!cancelled && previewLoadRequest.current === requestId) setPreviewLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [catalogLoading, catalogModels, catalogPoses, selectedCharacter?.id])

  useEffect(() => {
    const firstGroup = selectedCharacter?.customization.wardrobeGroups?.[0]
    setSelectedClothing(firstGroup ? { setId: firstGroup.setId, category: firstGroup.category } : null)
  }, [selectedCharacter?.id])

  useEffect(() => {
    if (activeModule !== 'Modelos' || catalogLoading) return
    let cancelled = false
    void (async () => {
      for (const model of catalogModels) {
        if (!model || thumbnailCache.current.has(`model:${model.slot}`)) continue
        let artwork: CatalogArtwork | null = null
        const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
        try {
          if (firstPose) artwork = await window.desktop.loadFabricatorPose(model.slot, 1)
          if (!artwork) artwork = await window.desktop.loadFabricatorSlot(model.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 144)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(`model:${model.slot}`)
            setModelThumbnails((current) => ({ ...current, [model.slot]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura do modelo.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogModels, catalogPoses])

  useEffect(() => {
    if (activeModule !== 'Poses' || selectedCatalogModelSlot === null || catalogLoading) return
    let cancelled = false
    const modelPoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
    void (async () => {
      for (const pose of modelPoses) {
        const key = `${pose.sourceModelSlot}:${pose.slot}`
        if (thumbnailCache.current.has(`pose:${key}`)) continue
        try {
          const artwork: FabricatorPose | null = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 144)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(`pose:${key}`)
            setPoseThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura da pose.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogPoses, selectedCatalogModelSlot])

  useEffect(() => {
    if (activeModule !== 'Roupas' || selectedCatalogModelSlot === null) return
    let cancelled = false
    setWardrobeLoading(true)
    void window.desktop.listWardrobeSets(selectedCatalogModelSlot).then((sets) => {
      if (!cancelled) setWardrobeSets(sets)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de roupas.')
    }).finally(() => { if (!cancelled) setWardrobeLoading(false) })
    return () => { cancelled = true }
  }, [activeModule, selectedCatalogModelSlot])

  useEffect(() => {
    if (activeModule !== 'Roupas' || !wardrobeSets.length) return
    let cancelled = false
    void (async () => {
      for (const summary of wardrobeSets) {
        let set: WardrobeSet | null = null
        try {
          set = await window.desktop.loadWardrobeSet(summary.modelSlot, summary.id)
          if (!set || cancelled) continue
          setWardrobeDetails((current) => ({ ...current, [`${summary.modelSlot}:${summary.id}`]: set! }))
          for (const group of Object.values(clothingCategories).flat()) {
            if (!set.components.some((component) => group.source.includes(component.category))) continue
            const key = `${summary.modelSlot}:${summary.id}:${group.id}`
            if (wardrobeThumbnails[key]) continue
            const thumbnail = await renderWardrobeThumbnail(set, group.source)
            if (cancelled) return
            if (thumbnail) setWardrobeThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar a miniatura da roupa.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, wardrobeSets])

  useEffect(() => {
    let cancelled = false
    const groups = selectedCharacter?.customization.wardrobeGroups ?? []
    if (!selectedArtworkProject || !groups.length) {
      setSelectedWardrobeUrl(null)
      return
    }
    void renderWardrobeOverlay(groups, wardrobeDetails, selectedArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject).then((url) => {
      if (!cancelled) setSelectedWardrobeUrl(url)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível compor as roupas do personagem.')
    })
    return () => { cancelled = true }
  }, [selectedCharacter?.id, selectedCharacter?.customization.wardrobeGroups, wardrobeDetails, selectedArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject])

  function selectCharacter(id: string) {
    setSelectedCharacterId(id)
    setActiveModule(null)
  }

  async function saveCharacter(next: CustomizerCharacter) {
    setCharactersError('')
    setCharacterSaveState('saving')
    setCharacters((current) => current.map((character) => character.id === next.id ? next : character))
    try {
      await window.desktop.saveCustomizerCharacter(next)
      setCharacterSaveState('saved')
    } catch (reason) {
      setCharacterSaveState('error')
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
      const latest = await window.desktop.listCustomizerCharacters().catch(() => null)
      if (latest) setCharacters(latest)
    }
  }

  async function saveCharacterCustomization(patch: Partial<CustomizerCharacter['customization']>) {
    if (!selectedCharacter) return
    await saveCharacter({ ...selectedCharacter, customization: { ...selectedCharacter.customization, ...patch }, updatedAt: new Date().toISOString() })
  }

  function wardrobeGroupKey(group: Pick<CustomizerWardrobeGroup, 'modelSlot' | 'setId' | 'category'>) {
    return `${group.modelSlot}:${group.setId}:${group.category}`
  }

  async function applyWardrobeGroup(set: WardrobeSetSummary, category: ClothingGroupCategory) {
    if (!selectedCharacter) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    const existing = groups.find((group) => group.modelSlot === set.modelSlot && group.setId === set.id && group.category === category)
    if (existing) {
      setSelectedClothing({ setId: set.id, category })
      return
    }
    const nextGroup: CustomizerWardrobeGroup = { modelSlot: set.modelSlot, setId: set.id, category, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 }
    setSelectedClothing({ setId: set.id, category })
    await saveCharacterCustomization({ wardrobeGroups: [...groups.filter((group) => group.category !== category || group.modelSlot !== set.modelSlot), nextGroup] })
  }

  async function removeWardrobeGroup(setId: string, category: ClothingGroupCategory) {
    if (!selectedCharacter) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    await saveCharacterCustomization({ wardrobeGroups: groups.filter((group) => !(group.setId === setId && group.category === category)) })
    if (selectedClothing?.setId === setId && selectedClothing.category === category) setSelectedClothing(null)
  }

  async function adjustWardrobeGroup(patch: Partial<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>>) {
    if (!selectedCharacter || !selectedClothing) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    const nextGroups = groups.map((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category ? { ...group, ...patch } : group)
    await saveCharacterCustomization({ wardrobeGroups: nextGroups })
  }

  function beginWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    if (!selectedCharacter || !selectedClothing || !selectedArtworkProject) return
    const group = (selectedCharacter.customization.wardrobeGroups ?? []).find((item) => item.setId === selectedClothing.setId && item.category === selectedClothing.category)
    if (!group) return
    const scene = event.currentTarget.closest('.stage-scene')
    const rect = scene?.getBoundingClientRect()
    if (!rect) return
    const previewScale = Math.min((rect.width - 136) / selectedArtworkProject.width, (rect.height - 130) / selectedArtworkProject.height)
    clothingDragRef.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scale: Math.max(.01, previewScale),
      startX: group.offsetX, startY: group.offsetY, groupKey: wardrobeGroupKey(group), characterId: selectedCharacter.id, latest: null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !selectedCharacter || selectedCharacter.id !== drag.characterId) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    const nextGroups = groups.map((group) => wardrobeGroupKey(group) === drag.groupKey ? {
      ...group,
      offsetX: drag.startX + (event.clientX - drag.clientX) / drag.scale,
      offsetY: drag.startY + (event.clientY - drag.clientY) / drag.scale
    } : group)
    const nextCharacter = { ...selectedCharacter, customization: { ...selectedCharacter.customization, wardrobeGroups: nextGroups }, updatedAt: new Date().toISOString() }
    drag.latest = nextCharacter
    setCharacters((current) => current.map((character) => character.id === nextCharacter.id ? nextCharacter : character))
  }

  function finishWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clothingDragRef.current = null
    if (drag.latest) void saveCharacter(drag.latest)
  }

  async function submitCharacterDialog(event: import('react').FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = nameDraft.trim()
    if (!name || savingCharacter) return
    setSavingCharacter(true)
    setCharactersError('')
    try {
      if (dialogMode === 'create') {
        const character = await window.desktop.createCustomizerCharacter(name)
        setCharacters((current) => [...current, character])
        setSelectedCharacterId(character.id)
        setActiveModule(null)
      } else if (dialogMode === 'rename' && selectedCharacter) {
        await saveCharacter({ ...selectedCharacter, name, updatedAt: new Date().toISOString() })
      }
      setDialogMode(null)
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
    } finally {
      setSavingCharacter(false)
    }
  }

  async function deleteSelectedCharacter() {
    if (!selectedCharacter || !window.confirm(`Excluir ${selectedCharacter.name}? Esta ação não remove modelos nem poses do Fabricador Dev.`)) return
    try {
      await window.desktop.deleteCustomizerCharacter(selectedCharacter.id)
      const remaining = characters.filter((character) => character.id !== selectedCharacter.id)
      setCharacters(remaining)
      setSelectedCharacterId(remaining[0]?.id ?? '')
      setActiveModule(null)
      setCharactersError('')
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível excluir o personagem.')
    }
  }

  async function selectCatalogModel(model: NonNullable<FabricatorSlotSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogModelSlot(model.slot)
    setSelectedArtworkLabel(model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
      setSelectedCatalogPoseSlot(firstPose?.slot ?? null)
      await saveCharacterCustomization({ modelSlot: model.slot, poseSlot: firstPose?.slot ?? null })
      const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
      if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
      let artwork: CatalogArtwork | null = firstPose ? await window.desktop.loadFabricatorPose(model.slot, 1) : null
      if (!artwork) artwork = sourceProject
      if (!artwork) throw new Error('Não foi possível abrir este modelo.')
      const artworkUrl = await renderArtwork(artwork, 720)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  async function selectCatalogPose(pose: NonNullable<FabricatorPoseSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogPoseSlot(pose.slot)
    setSelectedArtworkLabel(pose.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      await saveCharacterCustomization({ modelSlot: pose.sourceModelSlot, poseSlot: pose.slot })
      const sourceProject = selectedSourceModelProject?.slot === pose.sourceModelSlot ? selectedSourceModelProject : await window.desktop.loadFabricatorSlot(pose.sourceModelSlot)
      if (!sourceProject) throw new Error('O modelo de referência desta pose não está disponível.')
      const artwork = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
      if (!artwork) throw new Error('Não foi possível abrir esta pose.')
      const artworkUrl = await renderArtwork(artwork, 720)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  const availableModels = catalogModels.filter((model): model is NonNullable<typeof model> => model !== null)
  const availablePoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
  const selectedModelName = availableModels.find((model) => model.slot === selectedCatalogModelSlot)?.name
  const wardrobeGroupDefinitions = clothingCategories[clothingSection]
  const activeWardrobeGroup = selectedClothing ? (selectedCharacter?.customization.wardrobeGroups ?? []).find((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category) : undefined

  if (activeModule !== null && modules.some((module) => module.name === activeModule)) {
    return (
      <div className="customizer-models-view">
        <div className="customizer-models-columns">
          <section className="customizer-model-preview" aria-label="Prévia do personagem">
            <div className="stage-wrap">
              <div className="stage-scene" style={{ '--preview-background': previewBackground } as import('react').CSSProperties}>
                <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
                <button className="customizer-back-button customizer-preview-back" onClick={() => setActiveModule(null)} type="button"><span aria-hidden="true">←</span> Customizar</button>
                <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                  <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                  <span className="preview-color-label">Fundo da prévia</span>
                  <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
                </label>
                <div className="stage-tools" aria-label="Controles do preview">
                  <button aria-label="Ajustar enquadramento" type="button"><Icon name="frame" /></button>
                  <button aria-label="Aproximar" type="button"><Icon name="zoomIn" /></button>
                  <button aria-label="Afastar" type="button"><Icon name="zoomOut" /></button>
                </div>
                {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>Nenhum modelo salvo para mostrar.</span></div>}
                {selectedWardrobeUrl && selectedArtworkUrl && <img className="customizer-wardrobe-overlay" src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={beginWardrobeDrag} onPointerMove={moveWardrobeDrag} onPointerUp={finishWardrobeDrag} onPointerCancel={finishWardrobeDrag} />}
                {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
                <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'DO CATÁLOGO' : 'PERSONAGEM ATIVO'}</small></div>
              </div>
            </div>
          </section>
          <section className="customizer-models-sidebar" aria-label="Opções e catálogo de personalização">
            <div className="customizer-models-options-grid">
              {modules.map((module, index) => (
                <button
                  className={`customizer-model-option${activeModule === module.name ? ' selected' : ''}`}
                  key={module.name}
                  onClick={() => {
                    setActiveModule(module.name)
                    if (module.name === 'Modelos' && selectedCatalogModelSlot !== null) {
                      const selectedModel = availableModels.find((model) => model.slot === selectedCatalogModelSlot)
                      if (selectedModel) void selectCatalogModel(selectedModel)
                    }
                  }}
                  aria-pressed={activeModule === module.name}
                  title={module.detail}
                  type="button"
                >
                  <span className="customizer-model-option-icon"><Icon name={module.icon} /></span>
                  <span className="customizer-model-option-name">{module.name}</span>
                  {index === 0 && <span className="customizer-model-option-new">NOVO</span>}
                </button>
              ))}
            </div>
            <section className="customizer-catalog-panel" aria-label={'Catálogo de ' + activeModule}>
              <header className="customizer-catalog-heading">
                <div><p className="eyebrow">CATÁLOGO</p><h2>{activeModule === 'Poses' ? selectedModelName ?? 'Escolha um modelo' : activeModule}</h2></div>
                {activeModule === 'Modelos' && <small>{availableModels.length} modelos</small>}
                {activeModule === 'Poses' && selectedCatalogModelSlot !== null && <small>{availablePoses.length} poses</small>}
              </header>
              {catalogError && <p className="customizer-catalog-error" role="alert">{catalogError}</p>}
              {activeModule === 'Modelos' && (
                catalogLoading ? <div className="customizer-catalog-empty">Carregando modelos…</div>
                  : availableModels.length === 0 ? <div className="customizer-catalog-empty">Nenhum modelo salvo ainda.</div>
                    : <div className="customizer-catalog-grid customizer-model-catalog">
                      {availableModels.map((model) => (
                        <button className={'customizer-catalog-card model-catalog-card' + (selectedCatalogModelSlot === model.slot ? ' selected' : '')} key={model.slot} onClick={() => void selectCatalogModel(model)} aria-label={'Selecionar ' + model.name} aria-pressed={selectedCatalogModelSlot === model.slot} title={model.name} type="button">
                          {modelThumbnails[model.slot] ? <img src={modelThumbnails[model.slot]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                        </button>
                      ))}
                    </div>
              )}
              {activeModule === 'Poses' && (
                selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty"><span>Selecione um modelo para ver as poses dele.</span><button onClick={() => setActiveModule('Modelos')} type="button">Ver modelos</button></div>
                  : catalogLoading ? <div className="customizer-catalog-empty">Carregando poses…</div>
                    : availablePoses.length === 0 ? <div className="customizer-catalog-empty">Este modelo ainda não tem poses salvas.</div>
                      : <div className="customizer-catalog-grid customizer-pose-catalog">
                        {availablePoses.map((pose) => {
                          const key = pose.sourceModelSlot + ':' + pose.slot
                          return <button className={'customizer-catalog-card pose-catalog-card' + (selectedCatalogPoseSlot === pose.slot ? ' selected' : '')} key={key} onClick={() => void selectCatalogPose(pose)} aria-pressed={selectedCatalogPoseSlot === pose.slot} title={pose.name} type="button">
                            {poseThumbnails[key] ? <img src={poseThumbnails[key]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                            <span className="customizer-pose-caption"><b>Pose {String(pose.slot).padStart(2, '0')}</b><small>{pose.name}</small></span>
                          </button>
                        })}
                      </div>
              )}
              {activeModule === 'Roupas' && <div className="customizer-wardrobe-catalog">
                <div className="customizer-wardrobe-tabs" role="tablist" aria-label="Tipo de roupa">
                  {(['Superior', 'Inferior'] as const).map((section) => <button key={section} className={clothingSection === section ? 'active' : ''} role="tab" aria-selected={clothingSection === section} onClick={() => setClothingSection(section)} type="button">{section}</button>)}
                </div>
                {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver as roupas salvas dele.</div>
                  : wardrobeLoading ? <div className="customizer-catalog-empty">Carregando roupas…</div>
                    : <div className="customizer-wardrobe-groups">
                      {wardrobeGroupDefinitions.map((definition) => {
                        const matches = wardrobeSets.filter((summary) => wardrobeDetails[`${summary.modelSlot}:${summary.id}`]?.components.some((component) => definition.source.includes(component.category)))
                        return <section className="customizer-wardrobe-category" key={definition.id} aria-label={definition.label}>
                          <header><h3>{definition.label}</h3><span>{matches.length}</span></header>
                          {matches.length === 0 ? <p className="customizer-wardrobe-empty">Nenhum conjunto salvo nesta categoria.</p>
                            : <div className="customizer-wardrobe-items">{matches.map((summary) => {
                              const key = `${summary.modelSlot}:${summary.id}:${definition.id}`
                              const applied = (selectedCharacter?.customization.wardrobeGroups ?? []).some((group) => group.modelSlot === summary.modelSlot && group.setId === summary.id && group.category === definition.id)
                              const selected = selectedClothing?.setId === summary.id && selectedClothing.category === definition.id
                              return <article className={'customizer-wardrobe-item' + (selected ? ' selected' : '')} key={key}>
                                <button className="customizer-wardrobe-select" onClick={() => void applyWardrobeGroup(summary, definition.id)} aria-label={`${applied ? 'Selecionar' : 'Usar'} conjunto de ${definition.label.toLowerCase()}`} aria-pressed={selected} title={definition.id === 'calca' ? 'Calça completa: coxas e canelas juntas' : definition.label} type="button">
                                  {wardrobeThumbnails[key] ? <img src={wardrobeThumbnails[key]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="shirt" /></span>}
                                </button>
                                {applied && <button className="customizer-wardrobe-remove" onClick={() => void removeWardrobeGroup(summary.id, definition.id)} aria-label="Remover roupa deste personagem" title="Remover" type="button"><Icon name="trash" /></button>}
                              </article>
                            })}</div>}
                        </section>
                      })}
                    </div>}
                {activeWardrobeGroup && <section className="customizer-wardrobe-transform" aria-label="Ajustar conjunto selecionado">
                  <div><b>Conjunto selecionado</b><small>Arraste a roupa na prévia; as peças da calça se movem juntas.</small></div>
                  <div className="customizer-wardrobe-transform-controls">
                    <button aria-label="Mover para cima" onClick={() => void adjustWardrobeGroup({ offsetY: activeWardrobeGroup.offsetY - 8 })} type="button">↑</button>
                    <button aria-label="Mover para esquerda" onClick={() => void adjustWardrobeGroup({ offsetX: activeWardrobeGroup.offsetX - 8 })} type="button">←</button>
                    <button aria-label="Mover para direita" onClick={() => void adjustWardrobeGroup({ offsetX: activeWardrobeGroup.offsetX + 8 })} type="button">→</button>
                    <button aria-label="Mover para baixo" onClick={() => void adjustWardrobeGroup({ offsetY: activeWardrobeGroup.offsetY + 8 })} type="button">↓</button>
                    <button aria-label="Diminuir escala" onClick={() => void adjustWardrobeGroup({ scaleX: Math.max(.1, activeWardrobeGroup.scaleX * .95), scaleY: Math.max(.1, activeWardrobeGroup.scaleY * .95) })} type="button">−</button>
                    <button aria-label="Aumentar escala" onClick={() => void adjustWardrobeGroup({ scaleX: Math.min(5, activeWardrobeGroup.scaleX * 1.05), scaleY: Math.min(5, activeWardrobeGroup.scaleY * 1.05) })} type="button">+</button>
                    <button aria-label="Girar conjunto" onClick={() => void adjustWardrobeGroup({ rotation: (activeWardrobeGroup.rotation + 5) % 360 })} type="button">↻ 5°</button>
                  </div>
                </section>}
              </div>}
              {activeModule !== 'Modelos' && activeModule !== 'Poses' && activeModule !== 'Roupas' && <div className="customizer-catalog-empty">O catálogo de {activeModule} aparecerá aqui.</div>}
            </section>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="home-layout">
        <aside className="roster-panel panel" aria-label="Personagens">
          <div className="panel-heading roster-heading">
            <div>
              <p className="eyebrow">SUA COLEÇÃO</p>
              <h2>Personagens <span>{characters.length.toString().padStart(2, '0')}</span></h2>
            </div>
            {selectedCharacter && <button className="icon-button roster-delete-button" aria-label={'Excluir ' + selectedCharacter.name} title="Excluir personagem" onClick={() => void deleteSelectedCharacter()} type="button"><Icon name="trash" /></button>}
            <button className="icon-button add-button" aria-label="Adicionar personagem" onClick={() => { setNameDraft(''); setDialogMode('create') }} type="button">
              <Icon name="plus" />
            </button>
          </div>
          <label className="roster-search">
            <Icon name="search" />
            <input aria-label="Buscar personagem" placeholder="Buscar personagem" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} />
            <kbd>/</kbd>
          </label>
          <div className="character-grid">
            {visibleCharacters.map((character) => (
              <button
                className={`character-card ${selectedCharacter?.id === character.id ? 'selected' : ''}`}
                key={character.id}
                onClick={() => selectCharacter(character.id)}
                aria-pressed={selectedCharacter?.id === character.id}
              >
                <CharacterPortrait character={character} />
                <span>{character.name}</span>
              </button>
            ))}
            {charactersLoading && <p className="empty-roster">Carregando personagens…</p>}
            {!charactersLoading && characters.length === 0 && <p className="empty-roster">Sua coleção está vazia. Use + para criar o primeiro personagem.</p>}
            {!charactersLoading && characters.length > 0 && visibleCharacters.length === 0 && <p className="empty-roster">Nenhum personagem encontrado.</p>}
          </div>
          <div className="roster-footer"><span className={'online-dot' + (charactersError || characterSaveState === 'error' ? ' roster-error-dot' : '')} /> {charactersError || (characterSaveState === 'saving' ? `Salvando ${selectedCharacter?.name ?? 'personagem'}…` : characterSaveState === 'error' ? 'Falha ao salvar personagem' : selectedCharacter ? `Alterações de ${selectedCharacter.name} salvas` : 'Personagens salvos neste dispositivo')}</div>
        </aside>

        <section className="preview-column" aria-label="Preview do personagem">
          <div className="preview-heading">
            <div className="preview-title">
              <p className="eyebrow">CUSTOMIZAR <span>/</span> PERSONAGEM</p>
              <h1>{selectedCharacter?.name ?? (charactersLoading ? 'Carregando personagens…' : 'Crie um personagem')}<button className="rename-button" aria-label="Editar nome do personagem" disabled={!selectedCharacter} onClick={() => { setNameDraft(selectedCharacter?.name ?? ''); setDialogMode('rename') }} type="button"><Icon name="edit" /></button></h1>
            </div>
            <div className="preview-actions">
              <button className="quiet-button" aria-live="polite"><Icon name={characterSaveState === 'error' ? 'warning' : characterSaveState === 'saving' ? 'reset' : 'check'} /> {characterSaveState === 'saving' ? 'Salvando' : characterSaveState === 'error' ? 'Falha ao salvar' : 'Salvo'}</button>
              <button className="icon-button" aria-label="Tela cheia"><Icon name="expand" /></button>
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage-scene" style={{ '--preview-background': previewBackground } as import('react').CSSProperties}>
              <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
              <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                <span className="preview-color-label">Fundo da prévia</span>
                <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
              </label>
              <div className="stage-tools" aria-label="Controles do preview">
                <button aria-label="Ajustar enquadramento"><Icon name="frame" /></button>
                <button aria-label="Aproximar"><Icon name="zoomIn" /></button>
                <button aria-label="Afastar"><Icon name="zoomOut" /></button>
              </div>
              {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>{selectedCharacter ? 'Importe um modelo no Fabricador Dev para começar.' : 'Crie um personagem para começar a personalizar.'}</span></div>}
              {selectedWardrobeUrl && selectedArtworkUrl && <img className="customizer-wardrobe-overlay" src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={beginWardrobeDrag} onPointerMove={moveWardrobeDrag} onPointerUp={finishWardrobeDrag} onPointerCancel={finishWardrobeDrag} />}
              {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
              <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'MODELO DE REFERÊNCIA' : 'SEM MODELO'}</small></div>
            </div>
            <div className="stage-underbar">
              <div className="background-picker"><span className="background-swatch" /><span>Fundo do preview</span><Icon name="chevronDown" /></div>
              <button className="text-action" onClick={() => setActiveModule('Personalização')}><Icon name="sliders" /> Personalizar</button>
            </div>
          </div>

        </section>

        <aside className="modules-panel panel" aria-label="Áreas do aplicativo">
          <div className="modules-topline">
            <div className="app-wordmark"><span className="wordmark-icon">n</span><span>NYMI<small>ESTÚDIO CRIATIVO</small></span></div>
            <button className="icon-button favorite-button" aria-label="Favoritos"><Icon name="star" /></button>
          </div>
          <div className="feature-banner">
            <div className="banner-copy"><span>SEU UNIVERSO,</span><strong>DO SEU JEITO.</strong><small>Crie. Imagine. Compartilhe.</small></div>
            <div className="banner-art" aria-hidden="true"><span className="banner-orbit orbit-one" /><span className="banner-orbit orbit-two" /><span className="banner-star">✦</span><span className="banner-sparkle">✧</span></div>
          </div>
          <div className="module-intro">
            <div><p className="eyebrow">COMECE POR AQUI</p><h2>Seu espaço criativo</h2></div>
            <span className="module-count">09</span>
          </div>
          <div className="module-grid">
            {modules.map((module, index) => (
              <button
                className="module-card"
                key={module.name}
                onClick={() => setActiveModule(module.name)}
                title={module.detail}
              >
                <span className="module-icon"><Icon name={module.icon} /></span>
                <span className="module-name">{module.name}</span>
                {index === 0 && <span className="module-new">NOVO</span>}
              </button>
            ))}
          </div>
          <button className="help-link" onClick={() => setActiveModule('Central de ajuda')}><span className="help-icon">?</span><span><strong>Precisa de uma ideia?</strong><small>Explore o guia rápido do Nymi</small></span><Icon name="chevronRight" /></button>
        </aside>
      {dialogMode && <div className="character-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null) }}>
        <form className="character-dialog" onSubmit={(event) => void submitCharacterDialog(event)} aria-labelledby="character-dialog-title">
          <p className="eyebrow">SUA COLEÇÃO</p>
          <h2 id="character-dialog-title">{dialogMode === 'create' ? 'Novo personagem' : 'Renomear personagem'}</h2>
          <label htmlFor="character-name">Nome</label>
          <input id="character-name" autoFocus maxLength={80} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Ex.: Chloe" />
          {charactersError && <p className="character-dialog-error" role="alert">{charactersError}</p>}
          <div className="character-dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={!nameDraft.trim() || savingCharacter}>{savingCharacter ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </div>}
    </div>
  )
}
