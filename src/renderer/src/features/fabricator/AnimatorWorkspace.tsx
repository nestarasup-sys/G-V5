import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FaceCatalogItem, FaceElementKind, FaceSet, FaceSheetKind, FabricatorPose, FabricatorProject, FabricatorSlotSummary, HairStyle, WardrobeSet } from '../../../../shared/fabricator'
import type { CustomizerCharacter, CustomizerWardrobeGroup } from '../../../../shared/customizer'
import { Icon } from '../../ui/components/Icon'
import { orderedParts } from './models/rig'
import { detectMotionRig, evaluateMotion, motionDefinitions, motionRigDiagnostics, motionRootOffsetY, type MotionDefinition, type MotionId, type MotionRigMap } from './animator/motions'
import { usePreviewBackground } from './usePreviewBackground'
import { mapWardrobeComponentToPose } from './wardrobe/poseTransform'

const imageCache = new Map<string, Promise<HTMLImageElement>>()
function loadImage(source: string): Promise<HTMLImageElement> {
  let image = imageCache.get(source)
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const loaded = new Image()
      loaded.onload = () => resolve(loaded)
      loaded.onerror = () => reject(new Error('Não foi possível carregar um item do personagem.'))
      loaded.src = source
    })
    imageCache.set(source, image)
    void image.catch(() => imageCache.delete(source))
  }
  return image
}

const faceOrder: FaceElementKind[] = ['brow-left', 'brow-right', 'eye-left', 'eye-right', 'nose', 'mouth']
const wardrobeCategories: Record<CustomizerWardrobeGroup['category'], string[]> = {
  camisa: ['camisa'], 'manga-superior': ['manga-superior'], 'manga-inferior': ['manga-inferior'],
  calca: ['calca-coxa', 'calca-canela'], shorts: ['shorts']
}

function makePoseProject(source: FabricatorProject, pose: FabricatorPose): FabricatorProject {
  return { ...source, width: pose.width, height: pose.height, parts: pose.parts, joints: pose.joints, layerOrder: pose.layerOrder, hiddenPartIds: pose.hiddenPartIds }
}

function partSkinTone(source: string, tone?: string): Promise<string> {
  if (!tone) return Promise.resolve(source)
  return loadImage(source).then((input) => {
    const canvas = document.createElement('canvas')
    canvas.width = input.naturalWidth || input.width; canvas.height = input.naturalHeight || input.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return source
    context.drawImage(input, 0, 0)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const color = [1, 3, 5].map((index) => Number.parseInt(tone.slice(index, index + 2), 16))
    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2]
      if (image.data[i + 3] < 16 || r <= 108 || r <= g || g <= b || r - g < 2 || g - b < 2 || r - b >= 105) continue
      const shade = Math.max(.42, Math.min(1.08, (r * .299 + g * .587 + b * .114) / 244))
      image.data[i] = Math.min(255, Math.round(color[0] * shade))
      image.data[i + 1] = Math.min(255, Math.round(color[1] * shade))
      image.data[i + 2] = Math.min(255, Math.round(color[2] * shade))
    }
    context.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  })
}

function mapHeadOverlay(sourceHead: FabricatorProject['parts'][number], targetHead: FabricatorProject['parts'][number], x: number, y: number, width: number, height: number, rotation: number, scaleX: number, scaleY: number, flipX = false) {
  const localX = x / Math.max(1, sourceHead.width) * targetHead.width
  const localY = y / Math.max(1, sourceHead.height) * targetHead.height
  const radians = targetHead.rotation * Math.PI / 180
  return {
    x: targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians),
    y: targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians),
    width: width * scaleX / Math.max(1, sourceHead.width) * targetHead.width,
    height: height * scaleY / Math.max(1, sourceHead.height) * targetHead.height,
    rotation: targetHead.rotation + rotation,
    flipX
  }
}

export function AnimatorWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState<number | null>(null)
  const [source, setSource] = useState<FabricatorProject | null>(null)
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const [characterId, setCharacterId] = useState('')
  const [previewBase, setPreviewBase] = useState<FabricatorProject | null>(null)
  const [wardrobeDetails, setWardrobeDetails] = useState<Record<string, WardrobeSet>>({})
  const [hairStyles, setHairStyles] = useState<Record<string, HairStyle>>({})
  const [faceSets, setFaceSets] = useState<Record<string, FaceSet>>({})
  const [faceItems, setFaceItems] = useState<Record<string, FaceCatalogItem>>({})
  const [tintedParts, setTintedParts] = useState<Record<string, string>>({})
  const [motion, setMotion] = useState<MotionId>('walk')
  const [motionCategory, setMotionCategory] = useState<'Todas' | MotionDefinition['category']>('Todas')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [intensity, setIntensity] = useState(1)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [loadError, setLoadError] = useState('')
  const [background] = usePreviewBackground()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef(0)
  const selectedCharacter = characters.find((character) => character.id === characterId) ?? null
  const activeMotion = motionDefinitions.find((item) => item.id === motion) ?? motionDefinitions[0]
  const duration = activeMotion.duration
  const rig: MotionRigMap = useMemo(() => source ? detectMotionRig(source) : {}, [source])
  const diagnostics = useMemo(() => source ? motionRigDiagnostics(source, rig) : [], [source, rig])
  const animated = useMemo(() => previewBase ? evaluateMotion(previewBase, rig, motion, progress, intensity) : null, [previewBase, rig, motion, progress, intensity])
  const parts = useMemo(() => animated ? orderedParts(animated.parts, animated.layerOrder).filter((part) => !animated.hiddenPartIds?.includes(part.id)) : [], [animated])
  const visibleMotions = motionDefinitions.filter((item) => motionCategory === 'Todas' || item.category === motionCategory)
  const scale = animated && stage.width && stage.height ? Math.max(0.05, Math.min((stage.width - 64) / animated.width, (stage.height - 64) / animated.height)) : 1
  const layerStride = Math.max(16, (selectedCharacter?.customization.wardrobeGroups?.length ?? 0) * 12 + 16)
  const layerIndex = useMemo(() => new Map(animated ? orderedParts(animated.parts, animated.layerOrder).map((part, index) => [part.id, index]) : []), [animated])
  const headOverlays = useMemo(() => {
    if (!source || !animated || !selectedCharacter) return []
    const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
    const targetHead = animated.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
    if (!sourceHead || !targetHead) return []
    const result: Array<{ key: string; dataUrl: string; x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; zIndex: number }> = []
    const hair = selectedCharacter.customization.hairAppearance
    if (hair?.modelSlot === source.slot) {
      const backId = 'backStyleId' in hair ? hair.backStyleId ?? null : hair.styleId ?? null
      const frontId = 'frontStyleId' in hair ? hair.frontStyleId ?? null : hair.styleId ?? null
      const backStyle = backId ? hairStyles[`${source.slot}:${backId}`] : null
      const frontStyle = frontId ? hairStyles[`${source.slot}:${frontId}`] : null
      const headLayer = (layerIndex.get(targetHead.id) ?? animated.parts.indexOf(targetHead)) * layerStride
      for (const side of ['back', 'front'] as const) {
        const asset = side === 'back' ? backStyle?.back : frontStyle?.front
        const style = side === 'back' ? backStyle : frontStyle
        if (!asset || !style) continue
        const transform = style.transforms[side]
        const placement = mapHeadOverlay(sourceHead, targetHead, transform.x, transform.y, asset.width, asset.height, transform.rotation, transform.scaleX, transform.scaleY, transform.flipX)
        result.push({ key: `hair-${side}`, dataUrl: asset.dataUrl, ...placement, zIndex: headLayer + (side === 'back' ? 1 : layerStride - 1) })
      }
    }
    const appearance = selectedCharacter.customization.faceAppearance
    if (appearance?.modelSlot === source.slot) {
      const catalog: Partial<Record<FaceSheetKind, FaceCatalogItem>> = {
        eyes: appearance.eyeCatalogId ? faceItems[`${source.slot}:${appearance.eyeCatalogId}`] : undefined,
        eyebrows: appearance.eyebrowCatalogId ? faceItems[`${source.slot}:${appearance.eyebrowCatalogId}`] : undefined,
        nose: appearance.noseCatalogId ? faceItems[`${source.slot}:${appearance.noseCatalogId}`] : undefined,
        'mouth-open': appearance.mouthOpenCatalogId ? faceItems[`${source.slot}:${appearance.mouthOpenCatalogId}`] : undefined,
        'mouth-closed': appearance.mouthClosedCatalogId ? faceItems[`${source.slot}:${appearance.mouthClosedCatalogId}`] : undefined
      }
      const legacy = appearance.setId ? faceSets[`${source.slot}:${appearance.setId}`] : null
      for (const element of faceOrder) {
        if (element.startsWith('brow') && !appearance.eyebrows) continue
        const sheet: FaceSheetKind = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
        const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
        const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
        const item = catalog[sheet]
        const piece = item?.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side)
          ?? legacy?.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side)
        const transform = item?.transforms[element] ?? legacy?.transforms[element]
        if (!piece || !transform) continue
        const placement = mapHeadOverlay(sourceHead, targetHead, transform.x, transform.y, piece.width, piece.height, transform.rotation, transform.scaleX, transform.scaleY)
        result.push({ key: `face-${element}`, dataUrl: piece.dataUrl, ...placement, zIndex: (layerIndex.get(targetHead.id) ?? animated.parts.indexOf(targetHead)) * layerStride + layerStride - 2 })
      }
    }
    return result
  }, [source, animated, selectedCharacter, hairStyles, faceItems, faceSets, layerIndex, layerStride])
  const garmentLayers = useMemo(() => {
    if (!source || !animated || !selectedCharacter) return []
    const entries: Array<{ key: string; dataUrl: string; originX: number; originY: number; centerX: number; centerY: number; matrix: string; localLeft: number; localTop: number; width: number; height: number; rotation: number; groupX: number; groupY: number; groupScaleX: number; groupScaleY: number; groupRotation: number; zIndex: number }> = []
    const groups = (selectedCharacter.customization.wardrobeGroups ?? []).filter((group) => group.modelSlot === source.slot)
    let sequence = 0
    for (const group of groups) {
      const set = wardrobeDetails[`${group.modelSlot}:${group.setId}`]
      if (!set) continue
      const accepted = wardrobeCategories[group.category]
      const components = set.components.filter((component) => accepted.includes(component.category) && (!group.componentId || group.componentId === component.id))
      const pantsTogether = components.some((piece) => piece.category === 'calca-coxa') && components.some((piece) => piece.category === 'calca-canela')
      const groupMapped: Array<{ component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; index: number }> = []
      for (const component of components) {
        const sourceBone = source.parts.find((part) => part.id === component.attachedPartId)
        const targetBone = animated.parts.find((part) => part.id === component.attachedPartId)
        if (!sourceBone || !targetBone) continue
        const kneeOverlap = pantsTogether && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
        const sleevePadding = component.category.startsWith('manga-') ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06))) : 0
        groupMapped.push({ component, transform: mapWardrobeComponentToPose(component, sourceBone, targetBone, kneeOverlap, sleevePadding), index: layerIndex.get(targetBone.id) ?? animated.parts.indexOf(targetBone) })
      }
      if (!groupMapped.length) continue
      const centerX = groupMapped.reduce((sum, item) => sum + item.transform.origin.x / groupMapped.length, 0)
      const centerY = groupMapped.reduce((sum, item) => sum + item.transform.origin.y / groupMapped.length, 0)
      for (const item of groupMapped) {
        entries.push({ key: `${group.setId}:${group.category}:${item.component.id}:${sequence}`, dataUrl: item.component.dataUrl, originX: item.transform.origin.x, originY: item.transform.origin.y, centerX, centerY, matrix: item.transform.matrix, localLeft: item.transform.localLeft, localTop: item.transform.localTop, width: item.transform.renderWidth, height: item.transform.renderHeight, rotation: item.transform.localRotation, groupX: group.offsetX, groupY: group.offsetY, groupScaleX: group.scaleX, groupScaleY: group.scaleY, groupRotation: group.rotation, zIndex: item.index * layerStride + 4 + sequence % Math.max(1, layerStride - 8) })
        sequence++
      }
    }
    return entries
  }, [source, animated, selectedCharacter, wardrobeDetails, layerIndex, layerStride])

  useEffect(() => {
    let live = true
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listCustomizerCharacters()]).then(([slots, savedCharacters]) => {
      if (!live) return
      setModels(slots); setCharacters(savedCharacters)
      const defaultSlot = slots.findIndex(Boolean) + 1
      if (defaultSlot > 0) setModelSlot(defaultSlot)
    }).catch((reason: unknown) => { if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível carregar modelos e personagens.') })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    setSource(null); setPlaying(false); setProgress(0); setLoadError('')
    if (modelSlot === null) return
    void window.desktop.loadFabricatorSlot(modelSlot).then((project) => { if (live) { setSource(project); if (!project) setLoadError('Este slot ainda não tem um modelo salvo.') } }).catch((reason: unknown) => { if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.') })
    return () => { live = false }
  }, [modelSlot])

  useEffect(() => {
    let live = true
    setPreviewBase(null)
    if (!source) return
    if (!selectedCharacter || selectedCharacter.customization.modelSlot !== source.slot || selectedCharacter.customization.poseSlot === null) {
      setPreviewBase(source)
      return
    }
    void window.desktop.loadFabricatorPose(source.slot, selectedCharacter.customization.poseSlot).then((pose) => {
      if (!live) return
      setPreviewBase(pose ? makePoseProject(source, pose) : source)
      if (!pose) setLoadError(`A pose ${selectedCharacter.customization.poseSlot} deste personagem não está disponível; mostrando o modelo.`)
    }).catch((reason: unknown) => { if (live) { setPreviewBase(source); setLoadError(reason instanceof Error ? reason.message : 'Não foi possível carregar a pose do personagem.') } })
    return () => { live = false }
  }, [source, selectedCharacter?.id, selectedCharacter?.customization.modelSlot, selectedCharacter?.customization.poseSlot])

  useEffect(() => {
    if (!selectedCharacter) return
    let live = true
    const model = selectedCharacter.customization.modelSlot
    if (model === null) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    void Promise.all(groups.filter((group) => group.modelSlot === model).map(async (group) => {
      const key = `${group.modelSlot}:${group.setId}`
      if (wardrobeDetails[key]) return [key, wardrobeDetails[key]] as const
      const set = await window.desktop.loadWardrobeSet(group.modelSlot, group.setId)
      return set ? [key, set] as const : null
    })).then((entries) => { if (live) setWardrobeDetails((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) })) })
    const appearance = selectedCharacter.customization.hairAppearance
    const hairIds = appearance?.modelSlot === model ? [appearance.frontStyleId, appearance.backStyleId, appearance.styleId].filter((id): id is string => Boolean(id)) : []
    void Promise.all(hairIds.map(async (id) => {
      const key = `${model}:${id}`
      if (hairStyles[key]) return [key, hairStyles[key]] as const
      const style = await window.desktop.loadHairStyle(model, id)
      return style ? [key, style] as const : null
    })).then((entries) => { if (live) setHairStyles((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) })) })
    const face = selectedCharacter.customization.faceAppearance
    if (face?.modelSlot === model) {
      if (face.setId && !faceSets[`${model}:${face.setId}`]) void window.desktop.loadFaceSet(model, face.setId).then((set) => { if (live && set) setFaceSets((current) => ({ ...current, [`${model}:${set.id}`]: set })) })
      const ids = [face.eyeCatalogId, face.eyebrowCatalogId, face.noseCatalogId, face.mouthClosedCatalogId, face.mouthOpenCatalogId].filter((id): id is string => Boolean(id))
      void Promise.all(ids.map(async (id) => {
        const key = `${model}:${id}`
        if (faceItems[key]) return [key, faceItems[key]] as const
        const item = await window.desktop.loadFaceCatalogItem(model, id)
        return item ? [key, item] as const : null
      })).then((entries) => { if (live) setFaceItems((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))) })) })
    }
    return () => { live = false }
  }, [selectedCharacter?.id])

  useEffect(() => {
    let live = true
    const tone = selectedCharacter?.customization.modelSkinTone
    if (!tone || !previewBase) { setTintedParts({}); return }
    void Promise.all(previewBase.parts.map(async (part) => [part.id, await partSkinTone(part.dataUrl, tone)] as const))
      .then((entries) => { if (live) setTintedParts(Object.fromEntries(entries)) })
      .catch((reason: unknown) => { if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível aplicar o tom de pele do personagem.') })
    return () => { live = false }
  }, [previewBase, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [source])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    let lastPaint = 0
    const tick = (now: number) => {
      const delta = Math.min(80, now - previous) / 1000
      previous = now
      const next = progressRef.current + delta * speed / duration
      if (next >= 1) {
        if (loop || activeMotion.loop) progressRef.current = next % 1
        else { progressRef.current = 1; setProgress(1); setPlaying(false); return }
      } else progressRef.current = next
      if (now - lastPaint > 32) { setProgress(progressRef.current); lastPaint = now }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, duration, loop, motion, activeMotion.loop])

  function selectMotion(id: MotionId) {
    const definition = motionDefinitions.find((item) => item.id === id)
    setMotion(id); setProgress(0); progressRef.current = 0; setPlaying(false); setLoop(definition?.loop ?? false)
  }

  function seek(value: number) {
    const next = Math.max(0, Math.min(1, value))
    progressRef.current = next; setProgress(next)
  }

  return <section className="fabricator-workspace animator-workspace" aria-label="Animador Dev">
    <header className="animator-toolbar"><span className="animator-title"><Icon name="sparkles" /><span><strong>Animador Dev</strong><small>Animações experimentais calculadas pelo rig</small></span></span><label className="animator-character">Personagem<select value={characterId} onChange={(event) => { const id = event.target.value; const character = characters.find((item) => item.id === id); setCharacterId(id); if (character?.customization.modelSlot) setModelSlot(character.customization.modelSlot); setProgress(0); progressRef.current = 0; setPlaying(false); setLoadError('') }}><option value="">Sem personagem</option>{characters.filter((character) => character.customization.modelSlot !== null).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label className="animator-model">Modelo<select value={modelSlot ?? ''} onChange={(event) => { setCharacterId(''); setModelSlot(Number(event.target.value)) }}><option value="" disabled>Escolher modelo</option>{models.map((model, index) => model && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label><span className="animator-readonly">Prévia temporária · modelo protegido</span></header>
    <div className="animator-content">
      <aside className="animator-motion-list"><header><strong>Animações</strong><small>{motionDefinitions.length} movimentos experimentais</small></header><nav className="animator-categories">{(['Todas', 'Locomoção', 'Gestos', 'Posturas'] as const).map((category) => <button key={category} className={motionCategory === category ? 'active' : ''} onClick={() => setMotionCategory(category)} type="button">{category}</button>)}</nav>{visibleMotions.map((item, index) => <button key={item.id} className={`animator-motion-card${motion === item.id ? ' active' : ''}`} onClick={() => selectMotion(item.id)} type="button"><span className="animator-motion-icon">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}<div className="animator-controls"><strong>Ajustes</strong><label>Velocidade <output>{speed.toFixed(1)}×</output><input type="range" min="0.35" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label><label>Intensidade <output>{Math.round(intensity * 100)}%</output><input type="range" min="0.35" max="1.5" step="0.05" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label><label className="animator-loop"><input type="checkbox" checked={loop} disabled={activeMotion.loop} onChange={(event) => setLoop(event.target.checked)} /> Repetir animação</label></div></aside>
      <div className="animator-preview-column"><div className="animator-preview-heading"><span><i /> PRÉVIA DA ANIMAÇÃO</span><span>{source ? `${source.width} × ${source.height}` : 'Selecione um modelo salvo'}</span></div><div ref={stageRef} className="animator-stage" style={{ '--preview-background': background } as CSSProperties}>
        {animated && <div className="animator-artboard" style={{ width: animated.width * scale, height: animated.height * scale, marginTop: motionRootOffsetY(motion, progress, intensity) * scale }}>
          {parts.map((part, index) => {
            const characterOverride = selectedCharacter?.customization.partOverrides?.[part.id]
            const width = part.width * (characterOverride?.scaleX ?? 1)
            const height = part.height * (characterOverride?.scaleY ?? 1)
            return <img key={part.id} className="animator-part" src={tintedParts[part.id] ?? part.dataUrl} alt={part.name} draggable={false} style={{ left: ((characterOverride?.x ?? part.x) + (part.width - width) / 2) * scale, top: ((characterOverride?.y ?? part.y) + (part.height - height) / 2) * scale, width: width * scale, height: height * scale, zIndex: (layerIndex.get(part.id) ?? index) * layerStride + 2, transform: `rotate(${(characterOverride?.rotation ?? 0) + part.rotation}deg)` }} />
          })}
          {garmentLayers.map((garment) => <div key={garment.key} className="animator-garment-root" style={{ left: garment.centerX * scale, top: garment.centerY * scale, zIndex: garment.zIndex, transform: `translate(${garment.groupX * scale}px, ${garment.groupY * scale}px) rotate(${garment.groupRotation}deg) scale(${garment.groupScaleX}, ${garment.groupScaleY})` }}><div className="animator-garment-bone" style={{ left: (garment.originX - garment.centerX) * scale, top: (garment.originY - garment.centerY) * scale, transform: garment.matrix }}><img className="animator-garment-image" src={garment.dataUrl} alt="Roupa do personagem" draggable={false} style={{ left: garment.localLeft * scale, top: garment.localTop * scale, width: garment.width * scale, height: garment.height * scale, transform: `rotate(${garment.rotation}deg)` }} /></div></div>)}
          {headOverlays.map((overlay) => <img key={overlay.key} className="animator-accessory" src={overlay.dataUrl} alt="" draggable={false} style={{ left: overlay.x * scale, top: overlay.y * scale, width: overlay.width * scale, height: overlay.height * scale, zIndex: overlay.zIndex, transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg) scaleX(${overlay.flipX ? -1 : 1})` }} />)}
        </div>}
        {!source && <div className="animator-empty"><Icon name="body" /><strong>{loadError || (models.some(Boolean) ? 'Carregando modelo…' : 'Salve um modelo para animar')}</strong><small>O animador usa as imagens e juntas do modelo selecionado.</small></div>}
      </div><footer className="animator-player"><div className="animator-player-actions"><button onClick={() => { setPlaying(false); seek(0) }} type="button" title="Voltar ao início">⏮</button><button className="animator-play" onClick={() => { if (progress >= 1) seek(0); setPlaying((value) => !value) }} type="button">{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><button onClick={() => setPlaying(false)} type="button" title="Pausar">■</button></div><input className="animator-timeline" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} aria-label="Posição da animação"/><span className="animator-time">{(progress * duration).toFixed(2)}s / {duration.toFixed(2)}s</span></footer></div>
      <aside className="animator-info"><header><strong>{activeMotion.title}</strong><small>{Object.values(rig).flatMap((sides) => Object.values(sides ?? {})).length} segmentos reconhecidos</small></header><p>{activeMotion.detail} A rotação usa a âncora da própria peça e propaga o movimento às subpeças conectadas.</p><div className="animator-rig-list">{diagnostics.map((entry) => <div key={entry.role}><span>{entry.label}</span><small>Esq.: {entry.left ?? 'não identificada'} · Dir.: {entry.right ?? 'não identificada'}</small></div>)}</div>{source && source.joints.length === 0 && <p className="animator-warning">Este modelo ainda não tem juntas. Conecte as peças em Modelos Dev para animar os segmentos ligados.</p>}{source && diagnostics.some((entry) => !entry.left || !entry.right) && <p className="animator-warning">Alguns segmentos não foram encontrados dos dois lados. A identificação usa nomes e a hierarquia das juntas; revise as conexões em Modelos Dev.</p>}<small className="animator-note">A animação é uma demonstração temporária e não salva alterações no Modelo Dev.</small></aside>
    </div>
  </section>
}
