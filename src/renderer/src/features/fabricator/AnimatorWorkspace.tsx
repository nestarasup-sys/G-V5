import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import { resolvePoseCategory, type AnimatorAnimation, type AnimatorAnimationAsset, type AnimatorAnimationDraft, type AnimatorFrame, type AnimatorAnimationSave, type AnimatorAnimationSummary, type AnimatorFrameTransform, type FaceCatalogItem, type FaceElementKind, type FaceSet, type FaceSheetKind, type FabricatorPose, type FabricatorProject, type FabricatorSlotSummary, type HairStyle, type JointLink, type PosePart, type WardrobeSet } from '../../../../shared/fabricator'
import { defaultCharacterBodyDimensions, type CustomizerCharacter, type CustomizerWardrobeGroup } from '../../../../shared/customizer'
import { Icon } from '../../ui/components/Icon'
import { normalizeLayerOrder, orderedParts, partJointAnchor } from './models/rig'
import { usePreviewBackground } from './usePreviewBackground'
import { mapWardrobeComponentToPose } from './wardrobe/poseTransform'
import { applyCharacterBodyShape } from '../customizer/bodyShape'

const SLOT_COUNT = 12
const HISTORY_LIMIT = 40
const breathingVariations = [
  { key: 'suave', name: 'Suave', cycleMs: 4200, torsoWidth: 100.7, torsoHeight: 102.0 },
  { key: 'calma', name: 'Calma', cycleMs: 3600, torsoWidth: 101.1, torsoHeight: 103.0 },
  { key: 'profunda', name: 'Profunda', cycleMs: 5200, torsoWidth: 101.8, torsoHeight: 104.2 },
  { key: 'ritmada', name: 'Ritmada', cycleMs: 3000, torsoWidth: 101.2, torsoHeight: 102.6 }
] as const
const faceOrder: FaceElementKind[] = ['brow-left', 'brow-right', 'eye-left', 'eye-right', 'nose', 'mouth']
const wardrobeCategories: Record<CustomizerWardrobeGroup['category'], string[]> = {
  camisa: ['camisa'], jaqueta: ['jaqueta'], 'manga-superior': ['manga-superior'], 'manga-inferior': ['manga-inferior'],
  luvas: ['luvas'], capa: ['capa'], cinto: ['cinto'], saia: ['saia'], 'saia-superior': ['saia'], 'saia-inferior': ['saia'],
  calca: ['calca-coxa', 'calca-canela', 'shorts'], shorts: ['shorts'], meia: ['meia'], sapato: ['sapato'], oculos: ['oculos'], 'acessorio-cabeca': ['acessorio-cabeca']
}
const imageCache = new Map<string, Promise<HTMLImageElement>>()

type FrameHistoryState = { animation: AnimatorAnimation | null; transforms: Record<string, AnimatorFrameTransform>; joints: JointLink[]; frameId: string }
type Gesture = { pointerId: number; partId: string; startX: number; startY: number; lastAngle: number; rotationDelta: number; before: FrameHistoryState; pivotX: number; pivotY: number; scale: number; mode: 'rotate' | 'move' }
type PanGesture = { pointerId: number; startX: number; startY: number; originX: number; originY: number }

function loadImage(source: string): Promise<HTMLImageElement> {
  let image = imageCache.get(source)
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const loaded = new Image()
      loaded.onload = () => resolve(loaded)
      loaded.onerror = () => reject(new Error('Não foi possível carregar uma imagem da animação.'))
      loaded.src = source
    })
    imageCache.set(source, image)
    void image.catch(() => imageCache.delete(source))
  }
  return image
}

function makePoseProject(source: FabricatorProject, pose: FabricatorPose): FabricatorProject {
  return { ...source, width: pose.width, height: pose.height, parts: pose.parts, joints: pose.joints, layerOrder: pose.layerOrder, hiddenPartIds: pose.hiddenPartIds }
}

function projectFromAnimation(animation: AnimatorAnimation): FabricatorProject {
  return {
    schemaVersion: 1, chromaVersion: 0, slot: animation.sourceModelSlot, name: animation.sourceModelName,
    sourceName: animation.sourceModelName, sourceAssetName: '', sourceDataUrl: '', width: animation.width, height: animation.height,
    tolerance: 0, parts: animation.parts, joints: animation.joints, layerOrder: animation.layerOrder,
    hiddenPartIds: animation.hiddenPartIds, updatedAt: animation.sourceModelUpdatedAt
  }
}

function transformsFromProject(project: Pick<FabricatorProject, 'parts'>): Record<string, AnimatorFrameTransform> {
  return Object.fromEntries(project.parts.map((part) => [part.id, { x: part.x, y: part.y, width: part.width, height: part.height, rotation: part.rotation, ...(part.jointAnchor ? { jointAnchor: { ...part.jointAnchor } } : {}) }]))
}

function applyFrameState(base: FabricatorProject, transforms: Record<string, AnimatorFrameTransform>, joints: JointLink[]): FabricatorProject {
  return {
    ...base,
    parts: base.parts.map((part) => {
      const transform = transforms[part.id]
      return transform ? { ...part, x: transform.x, y: transform.y, width: transform.width ?? part.width, height: transform.height ?? part.height, rotation: transform.rotation, ...(transform.jointAnchor ? { jointAnchor: transform.jointAnchor } : {}) } : part
    }),
    joints
  }
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180
  const x = point.x - origin.x, y = point.y - origin.y
  return { x: origin.x + x * Math.cos(radians) - y * Math.sin(radians), y: origin.y + x * Math.sin(radians) + y * Math.cos(radians) }
}

function rotateFramePart(base: FabricatorProject, state: FrameHistoryState, partId: string, delta: number, includeChildren: boolean): FrameHistoryState {
  if (!delta) return state
  const project = applyFrameState(base, state.transforms, state.joints)
  const selected = project.parts.find((part) => part.id === partId)
  if (!selected) return state
  const origin = partJointAnchor(selected, project.joints) ?? { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 }
  const affected = new Set([partId])
  if (includeChildren) {
    let changed = true
    while (changed) {
      changed = false
      for (const joint of project.joints) if (joint.fixed && affected.has(joint.parentPartId) && !affected.has(joint.childPartId)) { affected.add(joint.childPartId); changed = true }
    }
  }
  const nextParts = project.parts.map((part) => {
    if (!affected.has(part.id)) return part
    const center = rotatePoint({ x: part.x + part.width / 2, y: part.y + part.height / 2 }, origin, delta)
    const anchor = partJointAnchor(part, project.joints)
    const jointAnchor = anchor ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 }
    return { ...part, x: center.x - part.width / 2, y: center.y - part.height / 2, rotation: part.rotation + delta, jointAnchor: rotatePoint(jointAnchor, origin, delta) }
  })
  const nextById = new Map(nextParts.map((part) => [part.id, part]))
  const nextJoints = project.joints.map((joint) => {
    const parent = nextById.get(joint.parentPartId), child = nextById.get(joint.childPartId)
    const parentAnchor = parent ? partJointAnchor(parent, project.joints) ?? joint.parentAnchor : joint.parentAnchor
    const childAnchor = child ? partJointAnchor(child, project.joints) ?? joint.childAnchor : joint.childAnchor
    return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
  })
  return { ...state, transforms: transformsFromProject({ parts: nextParts }), joints: nextJoints }
}

function moveFramePart(base: FabricatorProject, state: FrameHistoryState, partId: string, dx: number, dy: number, includeChildren: boolean): FrameHistoryState {
  const project = applyFrameState(base, state.transforms, state.joints)
  const affected = new Set([partId])
  if (includeChildren) {
    let changed = true
    while (changed) {
      changed = false
      for (const joint of project.joints) if (joint.fixed && affected.has(joint.parentPartId) && !affected.has(joint.childPartId)) { affected.add(joint.childPartId); changed = true }
    }
  }
  const transforms = { ...state.transforms }
  for (const part of project.parts) if (affected.has(part.id)) {
    const current = transforms[part.id]
    transforms[part.id] = { ...current, x: current.x + dx, y: current.y + dy, ...(current.jointAnchor ? { jointAnchor: { x: current.jointAnchor.x + dx, y: current.jointAnchor.y + dy } } : {}) }
  }
  const joints = state.joints.map((joint) => {
    const parentAnchor = affected.has(joint.parentPartId) ? { x: joint.parentAnchor.x + dx, y: joint.parentAnchor.y + dy } : joint.parentAnchor
    const childAnchor = affected.has(joint.childPartId) ? { x: joint.childAnchor.x + dx, y: joint.childAnchor.y + dy } : joint.childAnchor
    return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
  })
  return { ...state, transforms, joints }
}

function shortestAngle(from: number, to: number): number { return ((to - from + 540) % 360) - 180 }

function interpolateFrames(frames: AnimatorFrame[], elapsed: number, mode: AnimatorAnimation['interpolation'], loopMode: AnimatorAnimation['loopMode'], direction: 1 | -1 = 1) {
  const total = frames.reduce((sum, frame) => sum + frame.durationMs, 0)
  let time = Math.max(0, Math.min(total, elapsed))
  let index = 0
  while (index < frames.length - 1 && time >= frames[index].durationMs) { time -= frames[index].durationMs; index++ }
  const from = frames[index]
  const nextIndex = direction > 0 ? (index === frames.length - 1 && loopMode === 'loop' ? 0 : Math.min(frames.length - 1, index + 1)) : Math.max(0, index - 1)
  const to = frames[nextIndex]
  const tRaw = mode === 'stepped' || !to || to === from ? 0 : Math.max(0, Math.min(1, time / Math.max(1, from.durationMs)))
  const t = tRaw * tRaw * (3 - 2 * tRaw)
  const ids = new Set([...Object.keys(from.transforms), ...Object.keys(to.transforms)])
  const transforms: Record<string, AnimatorFrameTransform> = {}
  for (const id of ids) {
    const a = from.transforms[id], b = to.transforms[id] ?? a
    if (!a) { if (b) transforms[id] = b; continue }
    transforms[id] = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      ...(a.width !== undefined || b.width !== undefined ? { width: (a.width ?? b.width!) + ((b.width ?? a.width!) - (a.width ?? b.width!)) * t } : {}),
      ...(a.height !== undefined || b.height !== undefined ? { height: (a.height ?? b.height!) + ((b.height ?? a.height!) - (a.height ?? b.height!)) * t } : {}),
      rotation: a.rotation + shortestAngle(a.rotation, b.rotation) * t,
      ...(a.jointAnchor && b.jointAnchor ? { jointAnchor: { x: a.jointAnchor.x + (b.jointAnchor.x - a.jointAnchor.x) * t, y: a.jointAnchor.y + (b.jointAnchor.y - a.jointAnchor.y) * t } } : {})
    }
  }
  const fromJoints = new Map(from.joints.map((joint) => [joint.id, joint]))
  const toJoints = new Map(to.joints.map((joint) => [joint.id, joint]))
  const joints = [...new Set([...fromJoints.keys(), ...toJoints.keys()])].flatMap((id) => {
    const a = fromJoints.get(id), b = toJoints.get(id) ?? a
    if (!a) return b ? [b] : []
    if (!b) return [a]
    const aPivot = a.pivot ?? { x: (a.parentAnchor.x + a.childAnchor.x) / 2, y: (a.parentAnchor.y + a.childAnchor.y) / 2 }
    const bPivot = b.pivot ?? { x: (b.parentAnchor.x + b.childAnchor.x) / 2, y: (b.parentAnchor.y + b.childAnchor.y) / 2 }
    return [{ ...a, fixed: t < .5 ? a.fixed : b.fixed,
      parentAnchor: { x: a.parentAnchor.x + (b.parentAnchor.x - a.parentAnchor.x) * t, y: a.parentAnchor.y + (b.parentAnchor.y - a.parentAnchor.y) * t },
      childAnchor: { x: a.childAnchor.x + (b.childAnchor.x - a.childAnchor.x) * t, y: a.childAnchor.y + (b.childAnchor.y - a.childAnchor.y) * t },
      pivot: { x: aPivot.x + (bPivot.x - aPivot.x) * t, y: aPivot.y + (bPivot.y - aPivot.y) * t } }]
  })
  return { transforms, joints, frameIndex: index, total }
}

async function renderThumbnail(project: FabricatorProject, transforms = transformsFromProject(project)): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 120; canvas.height = Math.max(100, Math.round(120 * project.height / Math.max(1, project.width)))
  const context = canvas.getContext('2d')
  if (!context) return ''
  const scale = Math.min(canvas.width / project.width, canvas.height / project.height)
  const hidden = new Set(project.hiddenPartIds ?? [])
  for (const part of orderedParts(project.parts, project.layerOrder)) {
    if (hidden.has(part.id)) continue
    const transform = transforms[part.id] ?? { x: part.x, y: part.y, rotation: part.rotation }
    try {
      const image = await loadImage(part.dataUrl)
      context.save()
      context.translate((transform.x + (transform.width ?? part.width) / 2) * scale, (transform.y + (transform.height ?? part.height) / 2) * scale)
      context.rotate(transform.rotation * Math.PI / 180)
       context.drawImage(image, -(transform.width ?? part.width) * scale / 2, -(transform.height ?? part.height) * scale / 2, (transform.width ?? part.width) * scale, (transform.height ?? part.height) * scale)
      context.restore()
    } catch { /* Uma miniatura parcial não impede a edição. */ }
  }
  return canvas.toDataURL('image/png')
}

async function refreshThumbnails(project: FabricatorProject, frames: AnimatorFrame[]): Promise<AnimatorFrame[]> {
  return Promise.all(frames.map(async (frame) => ({ ...frame, thumbnailDataUrl: await renderThumbnail(project, frame.transforms) })))
}

function centerProjectOnCanvas(project: FabricatorProject, width: number, height: number): FabricatorProject {
  const offsetX = (width - project.width) / 2
  const offsetY = (height - project.height) / 2
  return {
    ...project,
    width,
    height,
    parts: project.parts.map((part) => ({ ...part, x: part.x + offsetX, y: part.y + offsetY, ...(part.jointAnchor ? { jointAnchor: { x: part.jointAnchor.x + offsetX, y: part.jointAnchor.y + offsetY } } : {}) })),
    joints: project.joints.map((joint) => ({
      ...joint,
      parentAnchor: { x: joint.parentAnchor.x + offsetX, y: joint.parentAnchor.y + offsetY },
      childAnchor: { x: joint.childAnchor.x + offsetX, y: joint.childAnchor.y + offsetY },
      ...(joint.pivot ? { pivot: { x: joint.pivot.x + offsetX, y: joint.pivot.y + offsetY } } : {})
    }))
  }
}

async function makeBreathingAnimation(source: FabricatorProject, pose: FabricatorPose, slot: number, characterId: string | null, variation: typeof breathingVariations[number]): Promise<AnimatorAnimation> {
  const poseProject = makePoseProject(source, pose)
  const torso = poseProject.parts.find((part) => /tronco|torso|peito|chest/i.test(part.name))
  if (!torso) throw new Error(`A pose ${pose.name} não possui uma peça de tronco identificável.`)
  const inhaleRaw = applyCharacterBodyShape(poseProject, {
    ...defaultCharacterBodyDimensions,
    torsoWidth: variation.torsoWidth,
    torsoHeight: variation.torsoHeight,
    balance: 0
  })
  // Respiração deve animar apenas a metade superior. Keep leg branches anchored
  // to the hips, while explicitly retaining a visible head/shoulder follow-through.
  const lowerRoots = poseProject.joints.filter((joint) => joint.fixed && joint.parentPartId === torso.id).map((joint) => poseProject.parts.find((part) => part.id === joint.childPartId)).filter((part): part is PosePart => Boolean(part && (/(coxa|perna|canela|panturrilha|joelho|thigh|shin|calf)/i.test(part.name) || part.y + part.height / 2 > torso.y + torso.height * .8)))
  const lowerIds = new Set(lowerRoots.map((part) => part.id))
  let changed = true
  while (changed) {
    changed = false
    for (const joint of poseProject.joints) if (joint.fixed && lowerIds.has(joint.parentPartId) && !lowerIds.has(joint.childPartId)) { lowerIds.add(joint.childPartId); changed = true }
  }
  const expandedTorso = inhaleRaw.parts.find((part) => part.id === torso.id)!
  const breathHeight = Math.max(0, expandedTorso.height - torso.height)
  const inhaleParts = inhaleRaw.parts.map((part) => {
    const original = poseProject.parts.find((candidate) => candidate.id === part.id)!
    if (lowerIds.has(part.id)) return original
    if (/cabe[çc]a|head/i.test(part.name)) return { ...part, y: original.y + Math.min(0, expandedTorso.y - torso.y) }
    if (/bra[cç]o|arm/i.test(part.name)) return { ...part, y: original.y - breathHeight * .25 }
    return part
  })
  const inhaleProject = { ...inhaleRaw, parts: inhaleParts }
  const canvasWidth = Math.max(poseProject.width, inhaleRaw.width)
  const canvasHeight = Math.max(poseProject.height, inhaleRaw.height)
  const base = centerProjectOnCanvas(poseProject, canvasWidth, canvasHeight)
  const inhale = centerProjectOnCanvas(inhaleProject, canvasWidth, canvasHeight)
  const makeFrame = async (project: FabricatorProject, durationMs: number): Promise<AnimatorFrame> => {
    const transforms = transformsFromProject(project)
    return { id: crypto.randomUUID(), durationMs, transforms, joints: structuredClone(project.joints), thumbnailDataUrl: await renderThumbnail(base, transforms) }
  }
  const cycle = variation.cycleMs
  const frames = [
    await makeFrame(base, Math.round(cycle * .36)),
    await makeFrame(inhale, Math.round(cycle * .1)),
    await makeFrame(inhale, Math.round(cycle * .38)),
    await makeFrame(base, Math.round(cycle * .16))
  ]
  return {
    schemaVersion: 1,
    slot,
    name: `Respiração · ${resolvePoseCategory(pose)} · ${variation.name}`,
    sourceModelSlot: source.slot,
    sourceModelName: source.name,
    sourceModelUpdatedAt: source.updatedAt,
    sourceModelPartCount: source.parts.length,
    basePoseSlot: pose.slot,
    characterId,
    width: canvasWidth,
    height: canvasHeight,
    parts: structuredClone(base.parts),
    joints: structuredClone(base.joints),
    layerOrder: normalizeLayerOrder(base.parts, base.layerOrder),
    hiddenPartIds: [...(base.hiddenPartIds ?? [])],
    frames,
    interpolation: 'smooth',
    loopMode: 'loop',
    speed: 1,
    thumbnailDataUrl: frames[0].thumbnailDataUrl,
    updatedAt: new Date().toISOString()
  }
}

function mapHeadOverlay(sourceHead: PosePart, targetHead: PosePart, x: number, y: number, width: number, height: number, rotation: number, scaleX: number, scaleY: number, flipX = false) {
  const localX = x / Math.max(1, sourceHead.width) * targetHead.width, localY = y / Math.max(1, sourceHead.height) * targetHead.height
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

function isCorePart(part: PosePart | undefined): boolean { return Boolean(part && /tronco|corpo|cabeça|cabeca/i.test(part.name)) }

function serializeAnimation(animation: AnimatorAnimation): AnimatorAnimationSave {
  return { ...animation, parts: animation.parts.map(({ dataUrl: _dataUrl, ...part }) => part) }
}

function serializeDraft(animation: AnimatorAnimation, editingSlot: number | null, current: FrameHistoryState, dirtyFrame: boolean): AnimatorAnimationDraft {
  return {
    editingSlot,
    animation: { ...serializeAnimation(animation), slot: undefined } as unknown as AnimatorAnimationDraft['animation'],
    currentTransforms: current.transforms,
    currentJoints: current.joints,
    selectedFrameId: current.frameId,
    dirtyFrame,
    updatedAt: new Date().toISOString()
  }
}

export function AnimatorWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [animationSourceSlots, setAnimationSourceSlots] = useState<number[]>([])
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const [modelSlot, setModelSlot] = useState<number | null>(null)
  const [characterId, setCharacterId] = useState('')
  const [source, setSource] = useState<FabricatorProject | null>(null)
  const [baseProject, setBaseProject] = useState<FabricatorProject | null>(null)
  const [summaries, setSummaries] = useState<AnimatorAnimationSummary[]>([])
  const [activeSlot, setActiveSlot] = useState(1)
  const [animation, setAnimation] = useState<AnimatorAnimation | null>(null)
  const [currentTransforms, setCurrentTransforms] = useState<Record<string, AnimatorFrameTransform>>({})
  const [currentJoints, setCurrentJoints] = useState<JointLink[]>([])
  const [selectedFrameId, setSelectedFrameId] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')
  const [copiedTransforms, setCopiedTransforms] = useState<{ transforms: Record<string, AnimatorFrameTransform>; joints: JointLink[] } | null>(null)
  const [undoStack, setUndoStack] = useState<FrameHistoryState[]>([])
  const [redoStack, setRedoStack] = useState<FrameHistoryState[]>([])
  const [draft, setDraft] = useState<AnimatorAnimationDraft | null>(null)
  const [dragMode, setDragMode] = useState<'rotate' | 'move'>('rotate')
  const [includeChildren, setIncludeChildren] = useState(true)
  const [applyToAllFrames, setApplyToAllFrames] = useState(false)
  const [allowCorePartId, setAllowCorePartId] = useState('')
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [playDirection, setPlayDirection] = useState<1 | -1>(1)
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panelTab, setPanelTab] = useState<'parts' | 'layers' | 'rig' | 'settings'>('parts')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [largePreview, setLargePreview] = useState(false)
  const [nameDialog, setNameDialog] = useState<{ mode: 'rename' | 'duplicate'; value: string } | null>(null)
  const [breathingDialog, setBreathingDialog] = useState(false)
  const [breathingSaving, setBreathingSaving] = useState(false)
  const [background] = usePreviewBackground()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const panGestureRef = useRef<PanGesture | null>(null)
  const stateRef = useRef<FrameHistoryState | null>(null)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const pendingAssets = useRef<Map<string, string>>(new Map())
  const draftAssetsPersisted = useRef(false)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedAnimationRef = useRef<string | null>(null)
  const dirtyFrameRef = useRef(false)
  const animationLoadId = useRef(0)
  const playheadRef = useRef(0)
  const directionRef = useRef<1 | -1>(1)
  const selectedCharacter = characters.find((character) => character.id === characterId) ?? null
  const rigProject = animation ? projectFromAnimation(animation) : source
  const diagnostics = useMemo(() => {
    if (!rigProject) return []
    const used = new Set<string>()
    return rigProject.joints.map((joint) => {
      const parent = rigProject.parts.find((part) => part.id === joint.parentPartId)
      const child = rigProject.parts.find((part) => part.id === joint.childPartId)
      used.add(joint.parentPartId); used.add(joint.childPartId)
      return { id: joint.id, parent: parent?.name ?? 'Peça ausente', child: child?.name ?? 'Peça ausente', fixed: joint.fixed, exists: Boolean(parent && child) }
    }).concat(rigProject.parts.filter((part) => !used.has(part.id)).map((part) => ({ id: part.id, parent: '—', child: part.name, fixed: false, exists: true })))
  }, [rigProject])
  const slots = useMemo(() => Array.from({ length: SLOT_COUNT }, (_, index) => summaries.find((item) => item.slot === index + 1) ?? null), [summaries])
  const selectedFrameIndex = animation?.frames.findIndex((frame) => frame.id === selectedFrameId) ?? -1
  const selectedFrame = animation && selectedFrameIndex >= 0 ? animation.frames[selectedFrameIndex] : null
  const currentSnapshot = useMemo<FrameHistoryState>(() => ({ animation, transforms: currentTransforms, joints: currentJoints, frameId: selectedFrameId }), [animation, currentTransforms, currentJoints, selectedFrameId])
  useEffect(() => { stateRef.current = currentSnapshot }, [currentSnapshot])
  const dirtyFrame = Boolean(selectedFrame && (JSON.stringify(selectedFrame.transforms) !== JSON.stringify(currentTransforms) || JSON.stringify(selectedFrame.joints) !== JSON.stringify(currentJoints)))
  dirtyFrameRef.current = dirtyFrame
  const totalDuration = animation?.frames.reduce((sum, frame) => sum + frame.durationMs, 0) ?? 0
  const playbackState = useMemo(() => animation ? interpolateFrames(animation.frames, playhead, animation.interpolation, animation.loopMode, playDirection) : null, [animation, playhead, playDirection])
  const displayTransforms = playing && playbackState ? playbackState.transforms : currentTransforms
  const displayJoints = playing && playbackState ? playbackState.joints : currentJoints
  const displayBase = animation ? projectFromAnimation(animation) : baseProject
  const tintParts = displayBase?.parts
  const displayProject = displayBase ? applyFrameState(displayBase, displayTransforms, displayJoints.length ? displayJoints : displayBase.joints) : null
  const parts = useMemo(() => displayProject ? orderedParts(displayProject.parts, displayProject.layerOrder).filter((part) => !displayProject.hiddenPartIds?.includes(part.id)) : [], [displayProject])
  const selectedPart = displayProject?.parts.find((part) => part.id === selectedPartId) ?? null
  const selectedCanTransform = Boolean(selectedPart && (!isCorePart(selectedPart) || allowCorePartId === selectedPart.id) && !playing && !saving)
  const scale = displayProject && stageSize.width > 1 && stageSize.height > 1 ? Math.max(.05, Math.min((stageSize.width - 64) / displayProject.width, (stageSize.height - 64) / displayProject.height)) * zoom : 1
  const layerStride = Math.max(16, (selectedCharacter?.customization.wardrobeGroups?.length ?? 0) * 12 + 16)
  const layerIndex = useMemo(() => new Map(displayProject ? orderedParts(displayProject.parts, displayProject.layerOrder).map((part, index) => [part.id, index]) : []), [displayProject])
  const [wardrobeDetails, setWardrobeDetails] = useState<Record<string, WardrobeSet>>({})
  const [hairStyles, setHairStyles] = useState<Record<string, HairStyle>>({})
  const [faceSets, setFaceSets] = useState<Record<string, FaceSet>>({})
  const [faceItems, setFaceItems] = useState<Record<string, FaceCatalogItem>>({})
  const [tintedParts, setTintedParts] = useState<Record<string, string>>({})
  const headOverlays = useMemo(() => {
    if (!rigProject || !displayProject || !selectedCharacter) return []
    const sourceHead = rigProject.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
    const targetHead = displayProject.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
    if (!sourceHead || !targetHead) return []
    const result: Array<{ key: string; dataUrl: string; x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; zIndex: number }> = []
    const hair = selectedCharacter.customization.hairAppearance
    if (hair?.modelSlot === rigProject.slot) {
      const backId = 'backStyleId' in hair ? hair.backStyleId ?? null : hair.styleId ?? null
      const frontId = 'frontStyleId' in hair ? hair.frontStyleId ?? null : hair.styleId ?? null
      const backStyle = backId ? hairStyles[`${rigProject.slot}:${backId}`] : null
      const frontStyle = frontId ? hairStyles[`${rigProject.slot}:${frontId}`] : null
      for (const side of ['back', 'front'] as const) {
        const asset = side === 'back' ? backStyle?.back : frontStyle?.front
        const style = side === 'back' ? backStyle : frontStyle
        if (!asset || !style) continue
        const transform = style.transforms[side]
        const placement = mapHeadOverlay(sourceHead, targetHead, transform.x, transform.y, asset.width, asset.height, transform.rotation, transform.scaleX, transform.scaleY, transform.flipX)
        result.push({ key: `hair-${side}`, dataUrl: asset.dataUrl, ...placement, zIndex: side === 'back' ? 0 : (layerIndex.get(targetHead.id) ?? 0) * layerStride + layerStride - 1 })
      }
    }
    const appearance = selectedCharacter.customization.faceAppearance
    if (appearance?.modelSlot === rigProject.slot) {
      const catalog: Partial<Record<FaceSheetKind, FaceCatalogItem>> = {
        eyes: appearance.eyeCatalogId ? faceItems[`${rigProject.slot}:${appearance.eyeCatalogId}`] : undefined,
        eyebrows: appearance.eyebrowCatalogId ? faceItems[`${rigProject.slot}:${appearance.eyebrowCatalogId}`] : undefined,
        nose: appearance.noseCatalogId ? faceItems[`${rigProject.slot}:${appearance.noseCatalogId}`] : undefined,
        'mouth-open': appearance.mouthOpenCatalogId ? faceItems[`${rigProject.slot}:${appearance.mouthOpenCatalogId}`] : undefined,
        'mouth-closed': appearance.mouthClosedCatalogId ? faceItems[`${rigProject.slot}:${appearance.mouthClosedCatalogId}`] : undefined
      }
      const legacy = appearance.setId ? faceSets[`${rigProject.slot}:${appearance.setId}`] : null
      for (const element of faceOrder) {
        if (element.startsWith('brow') && !appearance.eyebrows) continue
        const sheet: FaceSheetKind = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
        const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
        const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
        const item = catalog[sheet]
        const piece = item?.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side) ?? legacy?.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side)
        const transform = item?.transforms[element] ?? legacy?.transforms[element]
        if (!piece || !transform) continue
        const placement = mapHeadOverlay(sourceHead, targetHead, transform.x, transform.y, piece.width, piece.height, transform.rotation, transform.scaleX, transform.scaleY)
        result.push({ key: `face-${element}`, dataUrl: piece.dataUrl, ...placement, zIndex: (layerIndex.get(targetHead.id) ?? 0) * layerStride + layerStride - 2 })
      }
    }
    return result
  }, [rigProject, displayProject, selectedCharacter, hairStyles, faceItems, faceSets, layerIndex, layerStride])
  const garmentLayers = useMemo(() => {
    if (!rigProject || !displayProject || !selectedCharacter) return []
    const entries: Array<{ key: string; dataUrl: string; originX: number; originY: number; centerX: number; centerY: number; matrix: string; localLeft: number; localTop: number; width: number; height: number; rotation: number; groupX: number; groupY: number; groupScaleX: number; groupScaleY: number; groupRotation: number; opacity: number; zIndex: number }> = []
    let sequence = 0
    for (const group of (selectedCharacter.customization.wardrobeGroups ?? []).filter((item) => item.modelSlot === rigProject.slot)) {
      const set = wardrobeDetails[`${group.modelSlot}:${group.setId}`]
      if (!set) continue
      const components = set.components.filter((component) => wardrobeCategories[group.category].includes(component.category) && (!group.componentId || group.componentId === component.id))
      const pantsTogether = components.some((item) => item.category === 'calca-coxa') && components.some((item) => item.category === 'calca-canela')
      const mapped: Array<{ component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; layer: number }> = []
      for (const component of components) {
        const from = rigProject.parts.find((part) => part.id === component.attachedPartId)
        const to = displayProject.parts.find((part) => part.id === component.attachedPartId)
        if (!from || !to) continue
        const knee = pantsTogether && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
        const edge = component.category.startsWith('manga-') ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06))) : 0
        mapped.push({ component, transform: mapWardrobeComponentToPose(component, from, to, knee, edge), layer: layerIndex.get(to.id) ?? 0 })
      }
      if (!mapped.length) continue
      const centerX = mapped.reduce((sum, item) => sum + item.transform.origin.x / mapped.length, 0)
      const centerY = mapped.reduce((sum, item) => sum + item.transform.origin.y / mapped.length, 0)
      for (const item of mapped) {
        entries.push({ key: `${group.setId}:${group.category}:${item.component.id}`, dataUrl: item.component.dataUrl, originX: item.transform.origin.x, originY: item.transform.origin.y, centerX, centerY, matrix: item.transform.matrix, localLeft: item.transform.localLeft, localTop: item.transform.localTop, width: item.transform.renderWidth, height: item.transform.renderHeight, rotation: item.transform.localRotation, groupX: group.offsetX, groupY: group.offsetY, groupScaleX: group.scaleX, groupScaleY: group.scaleY, groupRotation: group.rotation, opacity: Math.min(1, Math.max(0, group.opacity ?? 1)), zIndex: item.layer * layerStride + 4 + sequence % Math.max(1, layerStride - 8) })
        sequence++
      }
    }
    return entries
  }, [rigProject, displayProject, selectedCharacter, wardrobeDetails, layerIndex, layerStride])

  const pushHistory = useCallback((before = stateRef.current) => {
    if (!before) return
    setUndoStack((current) => [...current, structuredClone(before)].slice(-HISTORY_LIMIT))
    setRedoStack([])
  }, [])

  const setEditorState = useCallback((next: FrameHistoryState, record = false) => {
    if (record) pushHistory(stateRef.current)
    stateRef.current = next
    setAnimation(next.animation)
    setCurrentTransforms(next.transforms)
    setCurrentJoints(next.joints)
    setSelectedFrameId(next.frameId)
  }, [pushHistory])

  useEffect(() => {
    let live = true
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listCustomizerCharacters(), window.desktop.listAnimatorModelSlots()]).then(([slots, savedCharacters, savedAnimationSlots]) => {
      if (!live) return
      setModels(slots); setCharacters(savedCharacters); setAnimationSourceSlots(savedAnimationSlots)
      setModelSlot(slots.find((slot) => slot)?.slot ?? savedAnimationSlots[0] ?? 1)
    }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar modelos e personagens.') }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    if (modelSlot === null) { setSource(null); setBaseProject(null); return }
    setSource(null); setBaseProject(null); setPlaying(false)
    void window.desktop.loadFabricatorSlot(modelSlot).then(async (project) => {
      if (!live) return
      setSource(project)
      if (!project) { setBaseProject(null); return }
      const character = selectedCharacter?.customization.modelSlot === modelSlot ? selectedCharacter : null
      const poseSlot = character?.customization.poseSlot
      if (poseSlot !== null && poseSlot !== undefined) {
        const pose = await window.desktop.loadFabricatorPose(modelSlot, poseSlot)
        if (live) setBaseProject(pose ? makePoseProject(project, pose) : project)
      } else setBaseProject(project)
    }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o modelo selecionado.') })
    return () => { live = false }
  }, [modelSlot, selectedCharacter?.id, selectedCharacter?.customization.modelSlot, selectedCharacter?.customization.poseSlot])

  useEffect(() => {
    let live = true
    if (modelSlot === null) return
    setLoading(true); setAnimation(null); setCurrentTransforms({}); setCurrentJoints([]); savedAnimationRef.current = null
    void Promise.all([window.desktop.listAnimatorAnimations(modelSlot), window.desktop.loadAnimatorDraft(modelSlot)]).then(([items, savedDraft]) => {
      if (!live) return
      setSummaries(items); setDraft(savedDraft)
      if (savedDraft) {
        const firstEmpty = Array.from({ length: SLOT_COUNT }, (_, index) => index + 1).find((slot) => !items.some((item) => item.slot === slot)) ?? 1
        setActiveSlot(savedDraft.editingSlot ?? firstEmpty)
      } else if (items.length) setActiveSlot(items[0].slot)
      else setActiveSlot(1)
    }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca de animações.') }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [modelSlot])

  useEffect(() => {
    if (!selectedCharacter || selectedCharacter.customization.modelSlot === null) return
    let live = true
    const model = selectedCharacter.customization.modelSlot
    const load = async () => {
      const groups = selectedCharacter.customization.wardrobeGroups ?? []
      const sets = await Promise.all(groups.filter((group) => group.modelSlot === model).map(async (group) => {
        const key = `${model}:${group.setId}`
        const cached = wardrobeDetails[key]
        return [key, cached ?? await window.desktop.loadWardrobeSet(model, group.setId)] as const
      }))
      const appearance = selectedCharacter.customization.hairAppearance
      const hairIds = appearance?.modelSlot === model ? [appearance.frontStyleId, appearance.backStyleId, appearance.styleId].filter((id): id is string => Boolean(id)) : []
      const styles = await Promise.all(hairIds.map(async (id) => [`${model}:${id}`, hairStyles[`${model}:${id}`] ?? await window.desktop.loadHairStyle(model, id)] as const))
      const face = selectedCharacter.customization.faceAppearance
      const legacyFace = face?.modelSlot === model && face.setId && !faceSets[`${model}:${face.setId}`] ? await window.desktop.loadFaceSet(model, face.setId) : null
      const ids = face?.modelSlot === model ? [face.eyeCatalogId, face.eyebrowCatalogId, face.noseCatalogId, face.mouthClosedCatalogId, face.mouthOpenCatalogId].filter((id): id is string => Boolean(id)) : []
      const items = await Promise.all(ids.map(async (id) => [`${model}:${id}`, faceItems[`${model}:${id}`] ?? await window.desktop.loadFaceCatalogItem(model, id)] as const))
      if (!live) return
      setWardrobeDetails((current) => ({ ...current, ...Object.fromEntries(sets.filter((entry): entry is [string, WardrobeSet] => Boolean(entry[1]))) }))
      setHairStyles((current) => { const next = { ...current }; for (const [key, style] of styles) if (style) next[key] = style; return next })
      if (legacyFace) setFaceSets((current) => ({ ...current, [`${model}:${legacyFace.id}`]: legacyFace }))
      setFaceItems((current) => { const next = { ...current }; for (const [key, item] of items) if (item) next[key] = item; return next })
    }
    void load().catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os itens deste personagem.') })
    return () => { live = false }
  }, [selectedCharacter?.id])

  useEffect(() => {
    let live = true
    const tone = selectedCharacter?.customization.modelSkinTone
    if (!tone || !tintParts) { setTintedParts({}); return }
    void Promise.all(tintParts.map(async (part) => {
      const image = await loadImage(part.dataUrl)
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return [part.id, part.dataUrl] as const
      context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const color = [1, 3, 5].map((index) => Number.parseInt(tone.slice(index, index + 2), 16))
      for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2]
        if (pixels.data[i + 3] < 16 || r <= 108 || r <= g || g <= b || r - g < 2 || g - b < 2 || r - b >= 105) continue
        const shade = Math.max(.42, Math.min(1.08, (r * .299 + g * .587 + b * .114) / 244))
        pixels.data[i] = Math.min(255, Math.round(color[0] * shade)); pixels.data[i + 1] = Math.min(255, Math.round(color[1] * shade)); pixels.data[i + 2] = Math.min(255, Math.round(color[2] * shade))
      }
      context.putImageData(pixels, 0, 0); return [part.id, canvas.toDataURL('image/png')] as const
    })).then((entries) => { if (live) setTintedParts(Object.fromEntries(entries)) }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : 'Não foi possível colorir a pele da prévia.') })
    return () => { live = false }
  }, [tintParts, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element); return () => observer.disconnect()
  }, [largePreview])

  const makeInitialAnimation = useCallback(async (slot: number, project: FabricatorProject, name: string): Promise<AnimatorAnimation> => {
    const transforms = transformsFromProject(project)
    const thumbnail = await renderThumbnail(project, transforms)
    const frame: AnimatorFrame = { id: crypto.randomUUID(), durationMs: 250, transforms, joints: structuredClone(project.joints), thumbnailDataUrl: thumbnail }
    return {
      schemaVersion: 1, slot, name, sourceModelSlot: project.slot, sourceModelName: project.name,
      sourceModelUpdatedAt: source?.updatedAt ?? project.updatedAt, sourceModelPartCount: source?.parts.length ?? project.parts.length,
      basePoseSlot: selectedCharacter?.customization.poseSlot ?? null, characterId: selectedCharacter?.id ?? null,
      width: project.width, height: project.height, parts: structuredClone(project.parts), joints: structuredClone(project.joints),
      layerOrder: normalizeLayerOrder(project.parts, project.layerOrder), hiddenPartIds: [...(project.hiddenPartIds ?? [])], frames: [frame],
      interpolation: 'smooth', loopMode: 'loop', speed: 1, thumbnailDataUrl: thumbnail, updatedAt: new Date().toISOString()
    }
  }, [source, selectedCharacter])

  const persistDraftNow = async (snapshot = animation, targetSlot = activeSlot, editorState = stateRef.current) => {
    if (!snapshot || !editorState) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const frame = snapshot.frames.find((item) => item.id === editorState.frameId)
    const stateIsDirty = Boolean(frame && (JSON.stringify(frame.transforms) !== JSON.stringify(editorState.transforms) || JSON.stringify(frame.joints) !== JSON.stringify(editorState.joints)))
    const documentIsDirty = savedAnimationRef.current === null || JSON.stringify(serializeAnimation(snapshot)) !== savedAnimationRef.current || stateIsDirty
    if (!documentIsDirty) {
      const existing = await window.desktop.loadAnimatorDraft(snapshot.sourceModelSlot)
      if (existing?.editingSlot === targetSlot) await window.desktop.deleteAnimatorDraft(snapshot.sourceModelSlot)
      setDraft(null)
      return
    }
    const serialized = serializeDraft(snapshot, targetSlot, editorState, stateIsDirty)
    const assets: AnimatorAnimationAsset[] = draftAssetsPersisted.current ? [] : snapshot.parts.flatMap((part) => pendingAssets.current.has(part.id) ? [{ id: part.id, dataUrl: pendingAssets.current.get(part.id)! }] : [])
    const next = writeQueue.current.catch(() => undefined).then(() => window.desktop.saveAnimatorDraft(snapshot.sourceModelSlot, serialized, assets))
    writeQueue.current = next
    await next
    draftAssetsPersisted.current = true
    setDraft(serialized)
  }

  const createAnimation = async () => {
    if (saving) return
    if (!baseProject) { setError('Escolha um modelo salvo antes de criar uma animação.'); return }
    if (animation) {
      const changed = savedAnimationRef.current === null || JSON.stringify(serializeAnimation(animation)) !== savedAnimationRef.current || dirtyFrame
      if (changed) {
        if (!window.confirm('A animação atual tem alterações. Salvar no slot antes de criar outra?')) return
        if (!await saveAnimation()) return
      }
    }
    if (draft && !animation) {
      if (!window.confirm('Existe um rascunho recuperável. Descartar e começar uma animação nova?')) return
      await window.desktop.deleteAnimatorDraft(modelSlot!)
      setDraft(null)
    }
    const occupied = new Set(summaries.map((item) => item.slot))
    if (animation && savedAnimationRef.current !== null) occupied.add(animation.slot)
    const slot = Array.from({ length: SLOT_COUNT }, (_, index) => index + 1).find((candidate) => !occupied.has(candidate)) ?? 0
    if (!slot) { setError('Os 12 slots deste modelo estão ocupados. Exclua uma animação para liberar espaço.'); return }
    const name = `Animação ${String(slot).padStart(2, '0')}`
    try {
      const created = await makeInitialAnimation(slot, baseProject, name)
      pendingAssets.current = new Map(created.parts.map((part) => [part.id, part.dataUrl]))
      draftAssetsPersisted.current = false
      savedAnimationRef.current = null
      setAnimation(created); setActiveSlot(slot); setSelectedFrameId(created.frames[0].id); setSelectedPartId(created.parts[0]?.id ?? '')
      setCurrentTransforms(created.frames[0].transforms); setCurrentJoints(created.frames[0].joints); setUndoStack([]); setRedoStack([]); playheadRef.current = 0; setPlayhead(0); setError(''); setSaveMessage('Rascunho novo')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a animação.') }
  }

  const createBreathingSet = async () => {
    if (!source || modelSlot === null || breathingSaving || saving) return
    setBreathingSaving(true); setError('')
    const createdSlots: number[] = []
    let previousBreathing: AnimatorAnimation[] = []
    let replacementStarted = false
    try {
      const [poseSummaries, summariesBefore] = await Promise.all([
        window.desktop.listFabricatorPoseSlots(modelSlot),
        window.desktop.listAnimatorAnimations(modelSlot)
      ])
      const oldBreathing = await Promise.all(summariesBefore.filter((item) => item.name.startsWith('Respiração ·')).map(async (item) => {
        const saved = await window.desktop.loadAnimatorAnimation(modelSlot, item.slot)
        if (!saved) throw new Error(`Não consegui ler a animação de respiração no slot ${item.slot}; não alterei nenhum slot.`)
        return saved
      }))
      previousBreathing = oldBreathing
      const poses = await Promise.all(poseSummaries.map(async (summary) => {
        if (!summary) return null
        const pose = await window.desktop.loadFabricatorPose(modelSlot, summary.slot)
        return pose ? { pose, category: resolvePoseCategory(pose) } : null
      }))
      const standing = poses.find((entry) => entry?.category.toLocaleLowerCase('pt-BR').includes('parad'))
      const sitting = poses.find((entry) => entry?.category.toLocaleLowerCase('pt-BR').includes('sentad'))
      if (!standing || !sitting) throw new Error('Salve pelo menos uma pose “Parado” e uma “Sentado” em Poses Dev para criar as variações.')
      const replaceable = new Set(oldBreathing.map((item) => item.slot))
      const occupied = new Set(summariesBefore.filter((item) => !replaceable.has(item.slot)).map((item) => item.slot))
      const freeSlots = Array.from({ length: SLOT_COUNT }, (_, index) => index + 1).filter((slot) => !occupied.has(slot))
      const needed = breathingVariations.length * 2
      if (freeSlots.length < needed) throw new Error(`São necessários ${needed} slots livres; este modelo tem ${freeSlots.length}. Libere slots sem animação para continuar.`)
      const plans = [
        ...breathingVariations.map((variation) => ({ pose: standing.pose, variation })),
        ...breathingVariations.map((variation) => ({ pose: sitting.pose, variation }))
      ]
      const newAnimations = await Promise.all(plans.map((plan, index) => makeBreathingAnimation(source, plan.pose, freeSlots[index], characterId || null, plan.variation)))
      replacementStarted = true
      for (const old of oldBreathing) await window.desktop.deleteAnimatorAnimation(modelSlot, old.slot)
      for (const animation of newAnimations) {
        const assets: AnimatorAnimationAsset[] = animation.parts.map((part) => ({ id: part.id, dataUrl: part.dataUrl }))
        await window.desktop.saveAnimatorAnimation(modelSlot, animation.slot, serializeAnimation(animation), assets)
        createdSlots.push(animation.slot)
      }
      const updated = await window.desktop.listAnimatorAnimations(modelSlot)
      setSummaries(updated)
      setSaveMessage('8 variações de respiração salvas')
      setBreathingDialog(false)
    } catch (reason) {
      // This batch owns only the empty slots reserved above; roll back its partial writes.
      await Promise.all(createdSlots.map((slot) => window.desktop.deleteAnimatorAnimation(modelSlot, slot).catch(() => undefined)))
      // If a write failed after replacement began, restore the old breathing set.
      if (replacementStarted) for (const old of previousBreathing) {
        const assets: AnimatorAnimationAsset[] = old.parts.map((part) => ({ id: part.id, dataUrl: part.dataUrl }))
        await window.desktop.saveAnimatorAnimation(modelSlot, old.slot, serializeAnimation(old), assets).catch(() => undefined)
      }
      if (replacementStarted) setSummaries(await window.desktop.listAnimatorAnimations(modelSlot).catch(() => summaries))
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar as animações de respiração.')
    } finally { setBreathingSaving(false) }
  }

  const selectAnimationSlot = async (slot: number) => {
    if (saving) return
    if (animation) {
      const changed = savedAnimationRef.current === null || JSON.stringify(serializeAnimation(animation)) !== savedAnimationRef.current || dirtyFrame
      if (changed) {
        if (!window.confirm('A animação atual tem alterações. Salvar no slot antes de trocar?')) return
        if (!await saveAnimation()) return
      } else await persistDraftNow()
    }
    else if (draft && draft.editingSlot !== slot && !window.confirm('Há um rascunho recuperável. Descartar esse rascunho para abrir outro slot?')) return
    else if (draft && draft.editingSlot !== slot) { await window.desktop.deleteAnimatorDraft(modelSlot!); setDraft(null) }
    else if (draft && draft.editingSlot === slot && !window.confirm('Este slot tem um rascunho recuperável. Abrir a versão salva e descartar o rascunho?')) return
    else if (draft && draft.editingSlot === slot) { await window.desktop.deleteAnimatorDraft(modelSlot!); setDraft(null) }
    setPlaying(false); setActiveSlot(slot); setError('')
    const loadId = ++animationLoadId.current
    const summary = summaries.find((item) => item.slot === slot)
    if (!summary) { setLoading(false); setAnimation(null); setSelectedFrameId(''); setCurrentTransforms({}); setCurrentJoints([]); setSelectedPartId(''); return }
    setLoading(true); setAnimation(null); setCurrentTransforms({}); setCurrentJoints([]); savedAnimationRef.current = null
    try {
      const loaded = await window.desktop.loadAnimatorAnimation(summary.sourceModelSlot, slot)
      if (loadId !== animationLoadId.current) return
      if (!loaded) throw new Error('A animação não pôde ser carregada.')
      const first = loaded.frames[0]
      savedAnimationRef.current = JSON.stringify(serializeAnimation(loaded))
      pendingAssets.current = new Map(loaded.parts.map((part) => [part.id, part.dataUrl])); draftAssetsPersisted.current = false
      setAnimation(loaded); setSelectedFrameId(first.id); setCurrentTransforms(first.transforms); setCurrentJoints(first.joints); setSelectedPartId(loaded.parts[0]?.id ?? '')
      setCharacterId(characters.find((character) => character.id === loaded.characterId && character.customization.modelSlot === loaded.sourceModelSlot)?.id ?? '')
      setModelSlot(loaded.sourceModelSlot); setUndoStack([]); setRedoStack([]); playheadRef.current = 0; setPlayhead(0)
      const currentModel = await window.desktop.loadFabricatorSlot(loaded.sourceModelSlot)
      if (loadId !== animationLoadId.current) return
      if (currentModel && (currentModel.updatedAt !== loaded.sourceModelUpdatedAt || currentModel.name !== loaded.sourceModelName || currentModel.parts.length !== loaded.sourceModelPartCount)) setError('A origem deste modelo mudou desde a criação. A animação continua usando a cópia original salva.')
      if (!currentModel) setError('O modelo de origem foi removido. A cópia guardada na animação continua disponível para edição.')
    } catch (reason) { if (loadId === animationLoadId.current) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a animação.') }
    finally { if (loadId === animationLoadId.current) setLoading(false) }
  }

  const saveAnimation = async (): Promise<boolean> => {
    if (!animation || saving) return false
    if (draftTimer.current) clearTimeout(draftTimer.current)
    setSaving(true); setError('')
    try {
      let snapshot = animation
      if (dirtyFrame && displayBase && selectedFrame) {
        const thumbnail = await renderThumbnail(displayBase, currentTransforms)
        const frame: AnimatorFrame = { id: crypto.randomUUID(), durationMs: selectedFrame.durationMs, transforms: structuredClone(currentTransforms), joints: structuredClone(currentJoints), thumbnailDataUrl: thumbnail }
        const frames = [...animation.frames]; frames.splice(Math.max(0, selectedFrameIndex + 1), 0, frame)
        snapshot = { ...animation, frames, thumbnailDataUrl: frames[0].thumbnailDataUrl }
        setAnimation(snapshot); setSelectedFrameId(frame.id)
      }
      const updated = { ...snapshot, updatedAt: new Date().toISOString(), thumbnailDataUrl: snapshot.frames[0]?.thumbnailDataUrl ?? snapshot.thumbnailDataUrl }
      const assets: AnimatorAnimationAsset[] = updated.parts.flatMap((part) => pendingAssets.current.has(part.id) ? [{ id: part.id, dataUrl: pendingAssets.current.get(part.id)! }] : [])
      await window.desktop.saveAnimatorAnimation(updated.sourceModelSlot, updated.slot, serializeAnimation(updated), assets)
      const savedDraft = await window.desktop.loadAnimatorDraft(updated.sourceModelSlot)
      if (savedDraft?.editingSlot === updated.slot) await window.desktop.deleteAnimatorDraft(updated.sourceModelSlot)
      pendingAssets.current = new Map(updated.parts.map((part) => [part.id, part.dataUrl]))
      draftAssetsPersisted.current = false
      savedAnimationRef.current = JSON.stringify(serializeAnimation(updated))
      setAnimation(updated); setDraft(null); setSummaries((current) => [...current.filter((item) => item.slot !== updated.slot), {
        slot: updated.slot, sourceModelSlot: updated.sourceModelSlot, name: updated.name, sourceModelName: updated.sourceModelName,
        sourceModelUpdatedAt: updated.sourceModelUpdatedAt, sourceModelPartCount: updated.sourceModelPartCount,
        thumbnailDataUrl: updated.thumbnailDataUrl, updatedAt: updated.updatedAt
      }].sort((a, b) => a.slot - b.slot)); setSaveMessage('Animação salva'); return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a animação.'); return false }
    finally { setSaving(false) }
  }

  const renameAnimation = () => {
    if (saving || !animation) return
    setNameDialog({ mode: 'rename', value: animation.name })
  }

  const updatePlaybackSettings = (patch: Partial<Pick<AnimatorAnimation, 'interpolation' | 'loopMode' | 'speed'>>) => {
    if (!animation) return
    pushHistory()
    const updated = { ...animation, ...patch }
    setAnimation(updated)
    if (stateRef.current) stateRef.current = { ...stateRef.current, animation: updated }
  }

  const moveAnimationLayer = (partId: string, direction: -1 | 1) => {
    if (!animation || saving || playing) return
    const frontToBack = normalizeLayerOrder(animation.parts, animation.layerOrder).reverse()
    const index = frontToBack.indexOf(partId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= frontToBack.length) return
    const before = stateRef.current
    pushHistory(before)
    ;[frontToBack[index], frontToBack[target]] = [frontToBack[target], frontToBack[index]]
    const updated: AnimatorAnimation = { ...animation, layerOrder: frontToBack.reverse(), updatedAt: new Date().toISOString() }
    setAnimation(updated)
    if (before) stateRef.current = { ...before, animation: updated }
  }

  const duplicateAnimation = async (requestedName: string) => {
    if (saving || !animation) return
    if (savedAnimationRef.current === null || JSON.stringify(serializeAnimation(animation)) !== savedAnimationRef.current || dirtyFrame) {
      if (!window.confirm('A animação atual tem alterações. Salvar antes de duplicar?')) return
      if (!await saveAnimation()) return
    }
    const slot = Array.from({ length: SLOT_COUNT }, (_, index) => index + 1).find((candidate) => !summaries.some((item) => item.slot === candidate)) ?? 0
    if (!slot) { setError('Os 12 slots deste modelo estão ocupados.'); return }
    const name = requestedName.trim()
    if (!name) return
    const copy = { ...structuredClone(animation), slot, name, frames: animation.frames.map((frame) => ({ ...structuredClone(frame), id: crypto.randomUUID() })), updatedAt: new Date().toISOString() }
    pendingAssets.current = new Map(copy.parts.map((part) => [part.id, part.dataUrl])); draftAssetsPersisted.current = false
    savedAnimationRef.current = null
    setAnimation(copy); setActiveSlot(slot); setSelectedFrameId(copy.frames[0].id); setCurrentTransforms(copy.frames[0].transforms); setCurrentJoints(copy.frames[0].joints); setUndoStack([]); setRedoStack([]); setSaveMessage('Cópia não salva')
  }

  const submitNameDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = nameDialog?.value.trim()
    if (!name || !nameDialog) return
    if (nameDialog.mode === 'rename' && animation) {
      pushHistory(); setAnimation((current) => current ? { ...current, name, updatedAt: new Date().toISOString() } : current)
    } else if (nameDialog.mode === 'duplicate') void duplicateAnimation(name)
    setNameDialog(null)
  }

  const deleteAnimation = async () => {
    if (saving || !animation || !window.confirm(`Excluir a animação “${animation.name}” do slot ${animation.slot}?`)) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    try {
      await window.desktop.deleteAnimatorAnimation(animation.sourceModelSlot, animation.slot)
      const savedDraft = await window.desktop.loadAnimatorDraft(animation.sourceModelSlot)
      if (savedDraft?.editingSlot === animation.slot) await window.desktop.deleteAnimatorDraft(animation.sourceModelSlot)
      setSummaries((current) => current.filter((item) => item.slot !== animation.slot)); setAnimation(null); setCurrentTransforms({}); setCurrentJoints([]); setSelectedFrameId(''); setSelectedPartId(''); setSaveMessage(''); setDraft(null); savedAnimationRef.current = null
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a animação.') }
  }

  const saveFrame = async () => {
    if (saving || !animation || !displayBase || !dirtyFrame) return
    const thumbnail = await renderThumbnail(displayBase, currentTransforms)
    const frame: AnimatorFrame = { id: crypto.randomUUID(), durationMs: selectedFrame?.durationMs ?? 250, transforms: structuredClone(currentTransforms), joints: structuredClone(currentJoints), thumbnailDataUrl: thumbnail }
    pushHistory()
    const frames = [...animation.frames]; const insertion = Math.max(0, selectedFrameIndex + 1); frames.splice(insertion, 0, frame)
    const next = { ...animation, frames, thumbnailDataUrl: frames[0].thumbnailDataUrl, updatedAt: new Date().toISOString() }
    setAnimation(next); setSelectedFrameId(frame.id); setSaveMessage('Frame adicionado'); setError('')
  }

  const selectFrame = (frame: AnimatorFrame) => {
    if (dirtyFrame && !window.confirm('As alterações deste frame ainda não foram gravadas. Descartar essas alterações e abrir o outro frame?')) return
    const startTime = animation?.frames.slice(0, animation.frames.indexOf(frame)).reduce((sum, item) => sum + item.durationMs, 0) ?? 0
    playheadRef.current = startTime
    setPlaying(false); setSelectedFrameId(frame.id); setCurrentTransforms(structuredClone(frame.transforms)); setCurrentJoints(structuredClone(frame.joints)); setPlayhead(startTime)
  }

  const duplicateFrame = () => {
    if (!animation || !selectedFrame) return
    pushHistory(); const copy = { ...structuredClone(selectedFrame), id: crypto.randomUUID() }
    const frames = [...animation.frames]; frames.splice(selectedFrameIndex + 1, 0, copy)
    setAnimation({ ...animation, frames }); setSelectedFrameId(copy.id); setCurrentTransforms(copy.transforms); setCurrentJoints(copy.joints)
  }

  const deleteFrame = () => {
    if (!animation || animation.frames.length <= 1 || !selectedFrame) return
    pushHistory(); const frames = animation.frames.filter((frame) => frame.id !== selectedFrame.id); const nextIndex = Math.max(0, selectedFrameIndex - 1); const frame = frames[nextIndex]
    setAnimation({ ...animation, frames, thumbnailDataUrl: frames[0].thumbnailDataUrl }); setSelectedFrameId(frame.id); setCurrentTransforms(frame.transforms); setCurrentJoints(frame.joints)
  }

  const reorderFrame = (offset: -1 | 1) => {
    if (!animation || selectedFrameIndex < 0) return
    const target = selectedFrameIndex + offset; if (target < 0 || target >= animation.frames.length) return
    pushHistory(); const frames = [...animation.frames]; [frames[selectedFrameIndex], frames[target]] = [frames[target], frames[selectedFrameIndex]]
    const startTime = frames.slice(0, target).reduce((sum, frame) => sum + frame.durationMs, 0)
    setAnimation({ ...animation, frames }); playheadRef.current = startTime; setPlayhead(startTime)
  }

  const changeFrameDuration = (value: number) => {
    if (!animation || !selectedFrame || !Number.isFinite(value)) return
    const duration = Math.max(40, Math.min(10000, value))
    if (duration === selectedFrame.durationMs) return
    pushHistory(); setAnimation({ ...animation, frames: animation.frames.map((frame) => frame.id === selectedFrame.id ? { ...frame, durationMs: duration } : frame) })
  }

  const undo = () => {
    if (saving) return
    const previous = undoStack.at(-1); const current = stateRef.current
    if (!previous || !current) return
    setRedoStack((stack) => [...stack, structuredClone(current)].slice(-HISTORY_LIMIT)); setUndoStack((stack) => stack.slice(0, -1)); setEditorState(previous)
  }
  const redo = () => {
    if (saving) return
    const next = redoStack.at(-1); const current = stateRef.current
    if (!next || !current) return
    setUndoStack((stack) => [...stack, structuredClone(current)].slice(-HISTORY_LIMIT)); setRedoStack((stack) => stack.slice(0, -1)); setEditorState(next)
  }

  const transformSelected = (axis: 'x' | 'y' | 'rotation', value: number) => {
    if (!animation || !selectedPart || !selectedCanTransform || !Number.isFinite(value)) return
    pushHistory()
    let next = stateRef.current
    if (!next) return
    const currentPart = displayProject?.parts.find((part) => part.id === selectedPart.id)
    if (!currentPart) return
    if (axis === 'rotation') next = rotateFramePart(displayBase!, next, selectedPart.id, value - currentPart.rotation, includeChildren)
    else next = moveFramePart(displayBase!, next, selectedPart.id, axis === 'x' ? value - currentPart.x : 0, axis === 'y' ? value - currentPart.y : 0, includeChildren)
    if (!applyToAllFrames || !selectedFrame) { setEditorState(next); return }
    const delta = axis === 'rotation' ? value - currentPart.rotation : 0
    const dx = axis === 'x' ? value - currentPart.x : 0
    const dy = axis === 'y' ? value - currentPart.y : 0
    const frames = animation.frames.map((frame) => {
      const before: FrameHistoryState = { animation, transforms: frame.transforms, joints: frame.joints, frameId: frame.id }
      const after = frame.id === selectedFrame.id ? next : axis === 'rotation'
        ? rotateFramePart(displayBase!, before, selectedPart.id, delta, includeChildren)
        : moveFramePart(displayBase!, before, selectedPart.id, dx, dy, includeChildren)
      return { ...frame, transforms: after.transforms, joints: after.joints }
    })
    const updated = { ...animation, frames, thumbnailDataUrl: frames[0].thumbnailDataUrl }
    setAnimation(updated); setEditorState({ ...next, animation: updated })
    void Promise.all(frames.map(async (frame) => ({ id: frame.id, thumbnailDataUrl: await renderThumbnail(displayBase!, frame.transforms) }))).then((thumbs) => {
      setAnimation((current) => current?.slot === updated.slot ? { ...current, thumbnailDataUrl: thumbs[0]?.thumbnailDataUrl ?? current.thumbnailDataUrl, frames: current.frames.map((frame) => ({ ...frame, thumbnailDataUrl: thumbs.find((thumb) => thumb.id === frame.id)?.thumbnailDataUrl ?? frame.thumbnailDataUrl })) } : current)
    })
  }

  const beginDrag = (event: ReactPointerEvent<HTMLImageElement>, part: PosePart) => {
    if (!animation || playing || !displayProject) return
    event.preventDefault(); event.stopPropagation(); setSelectedPartId(part.id)
    if (isCorePart(part) && allowCorePartId !== part.id) return
    const rect = event.currentTarget.closest('.animator-artboard')?.getBoundingClientRect()
    const pivot = partJointAnchor(part, displayProject.joints) ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 }
    const pivotX = (rect?.left ?? 0) + pivot.x * scale, pivotY = (rect?.top ?? 0) + pivot.y * scale
    event.currentTarget.setPointerCapture(event.pointerId)
    const angle = Math.atan2(event.clientY - pivotY, event.clientX - pivotX) * 180 / Math.PI
    gestureRef.current = { pointerId: event.pointerId, partId: part.id, startX: event.clientX, startY: event.clientY, lastAngle: angle, rotationDelta: 0, before: structuredClone(stateRef.current!), pivotX, pivotY, scale, mode: dragMode }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panGesture = panGestureRef.current
    if (panGesture?.pointerId === event.pointerId) {
      setPan({ x: panGesture.originX + event.clientX - panGesture.startX, y: panGesture.originY + event.clientY - panGesture.startY })
      return
    }
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !displayBase) return
    if (gesture.mode === 'rotate') {
      const angle = Math.atan2(event.clientY - gesture.pivotY, event.clientX - gesture.pivotX) * 180 / Math.PI
      gesture.rotationDelta += shortestAngle(gesture.lastAngle, angle); gesture.lastAngle = angle
      setEditorState(rotateFramePart(displayBase, gesture.before, gesture.partId, gesture.rotationDelta, includeChildren))
    } else {
      const dx = (event.clientX - gesture.startX) / gesture.scale, dy = (event.clientY - gesture.startY) / gesture.scale
      setEditorState(moveFramePart(displayBase, gesture.before, gesture.partId, dx, dy, includeChildren))
    }
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panGestureRef.current?.pointerId === event.pointerId) { panGestureRef.current = null; return }
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    const after = stateRef.current
    if (JSON.stringify(gesture.before.transforms) !== JSON.stringify(after?.transforms)) {
      pushHistory(gesture.before)
      if (applyToAllFrames && animation && displayBase && after) {
        const beforePart = gesture.before.transforms[gesture.partId], afterPart = after.transforms[gesture.partId]
        if (beforePart && afterPart) {
          const deltaAngle = afterPart.rotation - beforePart.rotation
          const dx = afterPart.x - beforePart.x, dy = afterPart.y - beforePart.y
          const frames = animation.frames.map((frame) => {
            if (frame.id === after.frameId) return { ...frame, transforms: after.transforms, joints: after.joints }
            const state: FrameHistoryState = { animation, transforms: frame.transforms, joints: frame.joints, frameId: frame.id }
            const changed = gesture.mode === 'rotate' ? rotateFramePart(displayBase, state, gesture.partId, deltaAngle, includeChildren) : moveFramePart(displayBase, state, gesture.partId, dx, dy, includeChildren)
            return { ...frame, transforms: changed.transforms, joints: changed.joints }
          })
          const updated = { ...animation, frames }
          setAnimation(updated); stateRef.current = { ...after, animation: updated }
          void refreshThumbnails(displayBase, frames).then((nextFrames) => setAnimation((current) => current?.slot === updated.slot ? { ...current, frames: nextFrames, thumbnailDataUrl: nextFrames[0]?.thumbnailDataUrl ?? current.thumbnailDataUrl } : current))
        }
      }
    }
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.animator-part,.animator-stage-tools')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panGestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  }

  const seek = (time: number) => { const value = Math.max(0, Math.min(totalDuration, time)); playheadRef.current = value; setPlayhead(value); setPlaying(false) }
  const play = () => {
    if (!animation || !animation.frames.length) return
    if (playheadRef.current >= totalDuration) {
      const firstFrame = animation.frames[0]
      playheadRef.current = 0; setPlayhead(0)
      setEditorState({ animation, transforms: structuredClone(firstFrame.transforms), joints: structuredClone(firstFrame.joints), frameId: firstFrame.id })
    }
    directionRef.current = 1; setPlayDirection(1); setPlaying(true)
  }

  useEffect(() => {
    if (!playing || !animation) return
    let raf = 0, previous = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(80, now - previous) * animation.speed; previous = now
      let time = playheadRef.current + delta * directionRef.current
      if (animation.loopMode === 'loop') time = time >= totalDuration ? time % totalDuration : time
      else if (animation.loopMode === 'pingpong') {
        if (time >= totalDuration) { directionRef.current = -1; setPlayDirection(-1); time = Math.max(0, totalDuration - (time - totalDuration)) }
        else if (time <= 0 && directionRef.current < 0) { directionRef.current = 1; setPlayDirection(1); time = Math.min(totalDuration, -time) }
      } else if (time >= totalDuration) {
        time = totalDuration
        const lastFrame = animation.frames.at(-1)
        if (lastFrame) setEditorState({ animation, transforms: structuredClone(lastFrame.transforms), joints: structuredClone(lastFrame.joints), frameId: lastFrame.id })
        setPlaying(false)
      }
      playheadRef.current = time; setPlayhead(time); raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [playing, animation, totalDuration, setEditorState])

  useEffect(() => {
    if (!animation || modelSlot === null || saving) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const snapshot = animation
    const editorState = stateRef.current ?? { animation, transforms: currentTransforms, joints: currentJoints, frameId: selectedFrameId }
    const frame = snapshot.frames.find((item) => item.id === editorState.frameId)
    const frameIsDirty = Boolean(frame && (JSON.stringify(frame.transforms) !== JSON.stringify(editorState.transforms) || JSON.stringify(frame.joints) !== JSON.stringify(editorState.joints)))
    const documentIsDirty = savedAnimationRef.current === null || JSON.stringify(serializeAnimation(snapshot)) !== savedAnimationRef.current || frameIsDirty
    if (!documentIsDirty) { setSaveMessage('Animação salva'); return }
    const serialized = serializeDraft(snapshot, activeSlot, editorState, dirtyFrame)
    const assets: AnimatorAnimationAsset[] = draftAssetsPersisted.current ? [] : snapshot.parts.flatMap((part) => pendingAssets.current.has(part.id) ? [{ id: part.id, dataUrl: pendingAssets.current.get(part.id)! }] : [])
    setSaveMessage(dirtyFrame ? 'Frame alterado · rascunho automático' : 'Rascunho automático')
    draftTimer.current = setTimeout(() => {
      const next = writeQueue.current.catch(() => undefined).then(() => window.desktop.saveAnimatorDraft(snapshot.sourceModelSlot, serialized, assets))
      writeQueue.current = next
      void next.then(() => { draftAssetsPersisted.current = true; setDraft(serialized) }).catch((reason: unknown) => setError(reason instanceof Error ? `Não foi possível salvar o rascunho: ${reason.message}` : 'Não foi possível salvar o rascunho.'))
    }, 350)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [animation, activeSlot, currentTransforms, currentJoints, selectedFrameId, dirtyFrame, modelSlot, saving])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (saving || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      else if (event.code === 'Space' && animation) { event.preventDefault(); setPlaying((value) => !value) }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirtyFrame) void saveFrame(); else void saveAnimation() }
    }
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown)
  }, [animation, dirtyFrame, undoStack, redoStack, currentTransforms, currentJoints, saving])

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const current = stateRef.current
    const active = current?.animation
    if (active) {
      const frame = active.frames.find((item) => item.id === current!.frameId)
      const frameIsDirty = Boolean(frame && (JSON.stringify(frame.transforms) !== JSON.stringify(current!.transforms) || JSON.stringify(frame.joints) !== JSON.stringify(current!.joints)))
      const documentIsDirty = savedAnimationRef.current === null || JSON.stringify(serializeAnimation(active)) !== savedAnimationRef.current || frameIsDirty || dirtyFrameRef.current
      if (!documentIsDirty) return
      const serialized = serializeDraft(active, active.slot, current!, dirtyFrameRef.current)
      const assets = active.parts.flatMap((part) => pendingAssets.current.has(part.id) ? [{ id: part.id, dataUrl: pendingAssets.current.get(part.id)! }] : [])
      void window.desktop.saveAnimatorDraft(active.sourceModelSlot, serialized, assets).catch(() => undefined)
    }
  }, [])

  const stageScale = scale
  const frameSeconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(2)}s`
  const modelOptions = [
    ...models.filter((model): model is NonNullable<FabricatorSlotSummary> => Boolean(model)).map((model) => ({ slot: model.slot, label: `Modelo ${String(model.slot).padStart(2, '0')} · ${model.name}` })),
    ...animationSourceSlots.filter((slot) => !models.some((model) => model?.slot === slot)).map((slot) => ({ slot, label: `Origem indisponível · Modelo ${String(slot).padStart(2, '0')}` }))
  ]
  const changeModel = async (nextSlot: number) => {
    if (saving) return
    if (nextSlot === modelSlot) { setCharacterId(''); return }
    if (animation) await persistDraftNow()
    animationLoadId.current++
    setCharacterId(''); setModelSlot(nextSlot); setAnimation(null); setCurrentTransforms({}); setCurrentJoints([]); setSummaries([]); setDraft(null); setActiveSlot(1); setAllowCorePartId(''); savedAnimationRef.current = null
  }
  const changeCharacter = async (id: string) => {
    if (saving) return
    if (animation) await persistDraftNow()
    const character = characters.find((item) => item.id === id)
    setCharacterId(id)
    if (character?.customization.modelSlot) {
      const modelChanged = character.customization.modelSlot !== modelSlot
      animationLoadId.current++
      setModelSlot(character.customization.modelSlot); setAnimation(null); setCurrentTransforms({}); setCurrentJoints([]); if (modelChanged) { setSummaries([]); setDraft(null); savedAnimationRef.current = null }; setActiveSlot(modelChanged ? 1 : animation?.slot ?? draft?.editingSlot ?? activeSlot); setAllowCorePartId('')
    }
  }

  return <section className={`fabricator-workspace animator-workspace${largePreview ? ' animator-large-preview' : ''}${saving ? ' animator-saving' : ''}`} aria-label="Animador Dev">
    <header className="animator-toolbar">
      <span className="animator-title"><Icon name="sparkles" /><span><strong>Animador Dev</strong><small>Editor manual por frames</small></span></span>
      <label className="animator-character">Personagem<select value={characterId} onChange={(event) => { void changeCharacter(event.target.value) }}><option value="">Sem personagem</option>{characters.filter((character) => character.customization.modelSlot !== null).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <label className="animator-model">Modelo<select value={modelSlot ?? ''} onChange={(event) => { void changeModel(Number(event.target.value)) }}><option value="" disabled>Escolher modelo</option>{modelOptions.map((model) => <option key={model.slot} value={model.slot}>{model.label}</option>)}</select></label>
      <span className="animator-toolbar-spacer" />
      <button className="pose-button secondary animator-breathing-button" onClick={() => setBreathingDialog(true)} disabled={!source || loading || saving || breathingSaving} type="button"><Icon name="sparkles" /> Respiração</button>
      <button className="pose-button secondary" onClick={() => void createAnimation()} disabled={!baseProject || loading || saving} type="button"><Icon name="plus" /> Nova animação</button>
      <button className="pose-icon-button" title="Desfazer (Ctrl+Z)" disabled={!undoStack.length} onClick={undo} type="button"><Icon name="undo" /></button>
      <button className="pose-icon-button" title="Refazer (Ctrl+Shift+Z)" disabled={!redoStack.length} onClick={redo} type="button"><Icon name="redo" /></button>
      {animation && <><button className="pose-button secondary" onClick={renameAnimation} disabled={saving} type="button">Renomear</button><button className="pose-button secondary" onClick={() => setNameDialog({ mode: 'duplicate', value: `${animation.name} — cópia` })} disabled={saving} type="button">Duplicar</button><button className="pose-button danger" onClick={() => void deleteAnimation()} disabled={saving} type="button"><Icon name="trash" /></button><button className="pose-button primary" onClick={() => void saveAnimation()} disabled={saving} type="button"><Icon name="check" />{saving ? 'Salvando…' : 'Salvar animação'}</button></>}
      <span className={`pose-save-state${dirtyFrame ? ' pending' : ''}`}><i />{saveMessage || (animation ? 'Animação aberta' : 'Biblioteca vazia')}</span>
    </header>
    {breathingDialog && <div className="animator-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !breathingSaving) setBreathingDialog(false) }}><section className="animator-breathing-dialog" role="dialog" aria-modal="true" aria-labelledby="animator-breathing-title"><header><span><strong id="animator-breathing-title">Animações de respiração</strong><small>Quatro estilos para cada pose. Substitui somente as respirações anteriores.</small></span><button className="pose-icon-button" onClick={() => setBreathingDialog(false)} disabled={breathingSaving} type="button" aria-label="Fechar">×</button></header><div className="animator-breathing-groups">{(['Parado', 'Sentado'] as const).map((category) => <article key={category}><strong>{category}</strong><div>{breathingVariations.map((variation, index) => <div className="animator-breathing-variation" key={variation.key}><span><b>{index + 1}</b>{variation.name}</span><small>{(variation.cycleMs / 1000).toFixed(1)} s · loop suave</small></div>)}</div></article>)}</div><p>O movimento anima o tronco, os braços e um leve balanço da cabeça. Quadris e pernas ficam ancorados; sua animação manual e outros slots são preservados.</p><footer><button className="pose-button secondary" onClick={() => setBreathingDialog(false)} disabled={breathingSaving} type="button">Cancelar</button><button className="pose-button primary" onClick={() => void createBreathingSet()} disabled={breathingSaving || loading || !source} type="button"><Icon name={breathingSaving ? 'sparkles' : 'check'} />{breathingSaving ? 'Atualizando…' : 'Substituir respirações'}</button></footer></section></div>}
    {nameDialog && <div className="animator-dialog-backdrop"><form className="animator-name-dialog" onSubmit={submitNameDialog} role="dialog" aria-modal="true" aria-labelledby="animator-name-title"><strong id="animator-name-title">{nameDialog.mode === 'rename' ? 'Renomear animação' : 'Duplicar animação'}</strong><input autoFocus maxLength={80} value={nameDialog.value} onChange={(event) => setNameDialog((current) => current ? { ...current, value: event.target.value } : current)} aria-label="Nome da animação" /><div><button className="pose-button secondary" onClick={() => setNameDialog(null)} type="button">Cancelar</button><button className="pose-button primary" disabled={!nameDialog.value.trim() || saving} type="submit">{nameDialog.mode === 'rename' ? 'Renomear' : 'Duplicar'}</button></div></form></div>}
    {error && <div className="animator-error" role="alert"><span>{error}</span><button onClick={() => setError('')} type="button">Fechar</button></div>}
    {draft && !animation && <div className="pose-recovery"><span><strong>Rascunho de animação recuperável</strong><small>{draft.animation.name} · {draft.animation.frames.length} frames</small></span><div><button onClick={() => { void window.desktop.deleteAnimatorDraft(modelSlot!).then(() => setDraft(null)) }} type="button">Descartar</button><button className="pose-recover-button" onClick={() => {
      const restoredParts = draft.animation.parts as unknown as PosePart[]
      const restored = { ...draft.animation, slot: draft.editingSlot ?? (slots.findIndex((item) => !item) + 1 || 1), parts: restoredParts } as AnimatorAnimation
      pendingAssets.current = new Map(restoredParts.map((part) => [part.id, part.dataUrl])); draftAssetsPersisted.current = true
      setAnimation(restored); setActiveSlot(restored.slot); setCurrentTransforms(draft.currentTransforms); setCurrentJoints(draft.currentJoints); setSelectedFrameId(draft.selectedFrameId); setSelectedPartId(restored.parts[0]?.id ?? ''); stateRef.current = { animation: restored, transforms: draft.currentTransforms, joints: draft.currentJoints, frameId: draft.selectedFrameId }; setDraft(null)
    }} type="button">Retomar rascunho</button></div></div>}
    <div className="animator-editor-body">
      <section className="animator-preview-column" aria-label="Prévia do personagem">
        <div className="animator-preview-heading"><span><i />{animation ? `PRÉVIA · ${animation.name}` : 'PRÉVIA DO MODELO'}</span><span>{displayProject ? `${displayProject.width} × ${displayProject.height}` : 'Escolha um modelo salvo'}</span><button onClick={() => setLargePreview((value) => !value)} title={largePreview ? 'Voltar ao editor' : 'Ampliar prévia'} type="button"><Icon name="frame" /></button></div>
        <div ref={stageRef} className={`animator-stage${dragMode === 'move' ? ' move-tool-active' : ''}`} style={{ '--preview-background': background } as CSSProperties} onPointerDown={beginPan} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {displayProject && <div className="animator-artboard" style={{ width: displayProject.width * stageScale, height: displayProject.height * stageScale, left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)` }}>
            {parts.map((part, index) => <img key={part.id} className={`animator-part${selectedPartId === part.id ? ' selected' : ''}${selectedCanTransform && selectedPartId === part.id ? ' can-transform' : ''}`} src={tintedParts[part.id] ?? part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); setSelectedPartId(part.id) }} onPointerDown={(event) => beginDrag(event, part)} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, zIndex: (layerIndex.get(part.id) ?? index) * layerStride + 2, transform: `rotate(${part.rotation}deg)` }} />)}
            {garmentLayers.map((garment) => <div key={garment.key} className="animator-garment-root" style={{ left: garment.centerX * scale, top: garment.centerY * scale, zIndex: garment.zIndex, opacity: garment.opacity, transform: `translate(${garment.groupX * scale}px, ${garment.groupY * scale}px) rotate(${garment.groupRotation}deg) scale(${garment.groupScaleX}, ${garment.groupScaleY})` }}><div className="animator-garment-bone" style={{ left: (garment.originX - garment.centerX) * scale, top: (garment.originY - garment.centerY) * scale, transform: garment.matrix }}><img className="animator-garment-image" src={garment.dataUrl} alt="Roupa do personagem" draggable={false} style={{ left: garment.localLeft * scale, top: garment.localTop * scale, width: garment.width * scale, height: garment.height * scale, transform: `rotate(${garment.rotation}deg)` }} /></div></div>)}
            {headOverlays.map((overlay) => <img key={overlay.key} className="animator-accessory" src={overlay.dataUrl} alt="" draggable={false} style={{ left: overlay.x * scale, top: overlay.y * scale, width: overlay.width * scale, height: overlay.height * scale, zIndex: overlay.zIndex, transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg) scaleX(${overlay.flipX ? -1 : 1})` }} />)}
          </div>}
          {!displayProject && <div className="animator-empty"><Icon name="body" /><strong>{loading ? 'Carregando modelo…' : 'Escolha um modelo salvo'}</strong><small>O Animador Dev cria uma cópia independente do modelo e das juntas do Fabricador.</small></div>}
          <div className="animator-stage-tools"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.5, value + .15))} title="Aproximar" type="button">+</button><button onClick={() => setZoom((value) => Math.max(.45, value - .15))} title="Afastar" type="button">−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Centralizar" type="button"><Icon name="frame" /></button></div>
        </div>
        <footer className="animator-preview-footer"><span>{animation ? `${animation.parts.length} peças · ${animation.joints.length} juntas · ${animation.frames.length} frames` : 'O modelo e as poses salvos ficam protegidos'}</span><span>{animation && dirtyFrame ? 'Frame com alterações não gravadas' : animation ? 'Arraste uma peça para ajustar' : 'Crie uma animação para começar'}</span></footer>
      </section>
      <aside className="animator-side-panel">
        <section className="animator-library-panel"><header><span><strong>Slots de animações</strong><small>12 espaços · separados por modelo</small></span><span>{summaries.length}/12</span></header><div className="animator-slot-grid">{slots.map((summary, index) => <button key={index} className={`animator-slot${activeSlot === index + 1 ? ' active' : ''}${summary ? ' filled' : ''}`} onClick={() => void selectAnimationSlot(index + 1)} type="button" title={summary?.name ?? `Slot ${index + 1} vazio`}><span>{summary?.thumbnailDataUrl ? <img src={summary.thumbnailDataUrl} alt="" /> : <b>{String(index + 1).padStart(2, '0')}</b>}</span><small>{summary?.name ?? 'Vazio'}</small></button>)}</div></section>
        <section className="animator-edit-panel"><header><span><small>EDIÇÃO</small><strong>{animation ? selectedPart?.name ?? 'Selecione uma peça' : 'Controles'}</strong></span>{animation && <div className="pose-heading-actions"><button className={`pose-move-tool${dragMode === 'move' ? ' active' : ''}`} aria-pressed={dragMode === 'move'} disabled={playing || saving} title={dragMode === 'move' ? 'Desativar modo mover peça' : 'Ativar modo mover peça'} onClick={() => setDragMode((mode) => mode === 'move' ? 'rotate' : 'move')} type="button"><Icon name="move" /><span>{dragMode === 'move' ? 'Mover ligado' : 'Mover peça'}</span></button></div>}</header><nav>{([['parts', 'Peças'], ['layers', 'Camadas'], ['rig', 'Rig'], ['settings', 'Animação']] as const).map(([tab, label]) => <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)} type="button">{label}</button>)}</nav>
          {animation && panelTab === 'parts' && <div className="animator-panel-content"><div className="animator-piece-list">{orderedParts(animation.parts, animation.layerOrder).map((part) => <button key={part.id} className={`animator-piece-row${part.id === selectedPartId ? ' selected' : ''}`} onClick={() => setSelectedPartId(part.id)} type="button"><span>{part.name}</span><small>{Math.round(displayProject?.parts.find((item) => item.id === part.id)?.rotation ?? 0)}°</small></button>)}</div>
          {selectedPart && <div className="animator-transform-card"><strong>Transformação do frame atual</strong>{isCorePart(selectedPart) && <label className="animator-check"><input type="checkbox" checked={allowCorePartId === selectedPart.id} onChange={(event) => setAllowCorePartId(event.target.checked ? selectedPart.id : '')} /> Permitir manipular esta peça central</label>}<div className="animator-number-row"><label>X<input type="number" disabled={!selectedCanTransform} value={Number(selectedPart.x.toFixed(1))} onChange={(event) => transformSelected('x', Number(event.target.value))} /></label><label>Y<input type="number" disabled={!selectedCanTransform} value={Number(selectedPart.y.toFixed(1))} onChange={(event) => transformSelected('y', Number(event.target.value))} /></label></div><label className="animator-angle">Rotação <output>{selectedPart.rotation.toFixed(1)}°</output><input type="range" min={selectedPart.rotation - 180} max={selectedPart.rotation + 180} step="1" disabled={!selectedCanTransform} value={selectedPart.rotation} onChange={(event) => transformSelected('rotation', Number(event.target.value))} /></label><div className="animator-number-row"><label>Graus<input type="number" disabled={!selectedCanTransform} value={Number(selectedPart.rotation.toFixed(1))} onChange={(event) => transformSelected('rotation', Number(event.target.value))} /></label><button onClick={() => transformSelected('rotation', 0)} disabled={!selectedCanTransform} type="button">Zerar</button></div><div className="animator-mode-toggle"><button className={dragMode === 'rotate' ? 'active' : ''} onClick={() => setDragMode('rotate')} type="button">Arrastar para girar</button><button className={dragMode === 'move' ? 'active' : ''} onClick={() => setDragMode('move')} type="button">Arrastar para mover</button></div><label className="animator-check"><input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} /> Aplicar às descendentes conectadas</label><label className="animator-check"><input type="checkbox" checked={applyToAllFrames} onChange={(event) => setApplyToAllFrames(event.target.checked)} /> Aplicar a todos os frames</label><small>{selectedCanTransform ? 'A bolinha de junta define o pivô da rotação.' : 'Cabeça e tronco ficam bloqueados por segurança.'}</small></div>}
          </div>}
          {animation && panelTab === 'layers' && <div className="animator-panel-content animator-layer-editor"><p>Ordem exclusiva deste slot. O topo da lista fica à frente na prévia.</p><div className="animator-layer-list">{orderedParts(animation.parts, animation.layerOrder).reverse().map((part, index, frontToBack) => <article className={`animator-layer-row${part.id === selectedPartId ? ' selected' : ''}`} key={part.id}><button className="animator-layer-select" onClick={() => setSelectedPartId(part.id)} type="button"><span>{part.name}</span><small>{index === 0 ? 'Frente' : index === frontToBack.length - 1 ? 'Fundo' : `Camada ${frontToBack.length - index}`}</small></button><div><button disabled={saving || playing || index === 0} onClick={() => moveAnimationLayer(part.id, -1)} title="Trazer para frente" type="button" aria-label={`Trazer ${part.name} para frente`}>↑</button><button disabled={saving || playing || index === frontToBack.length - 1} onClick={() => moveAnimationLayer(part.id, 1)} title="Enviar para trás" type="button" aria-label={`Enviar ${part.name} para trás`}>↓</button></div></article>)}</div><small className="animator-layer-note">Salvar a animação grava esta ordem somente no slot atual. O modelo original e os demais slots permanecem intactos.</small></div>}
          {animation && panelTab === 'rig' && <div className="animator-panel-content animator-rig-list">{diagnostics.map((joint) => <article key={joint.id}><strong>{joint.parent} → {joint.child}</strong><small>{joint.exists ? joint.fixed ? 'Conectada · acompanha quando o ramo está ativo' : 'Conexão solta' : 'Peça ausente na cópia'}</small></article>)}{!diagnostics.length && <p>Este modelo não possui juntas. Configure o rig em Modelos Dev para animar os membros conectados.</p>}</div>}
          {animation && panelTab === 'settings' && <div className="animator-panel-content animator-settings"><label>Interpolação<select value={animation.interpolation} onChange={(event) => updatePlaybackSettings({ interpolation: event.target.value as AnimatorAnimation['interpolation'] })}><option value="smooth">Suave · menor caminho angular</option><option value="stepped">Quadro a quadro</option></select></label><label>Repetição<select value={animation.loopMode} onChange={(event) => updatePlaybackSettings({ loopMode: event.target.value as AnimatorAnimation['loopMode'] })}><option value="loop">Loop contínuo</option><option value="once">Uma vez</option><option value="pingpong">Ida e volta</option></select></label><label>Velocidade <output>{animation.speed.toFixed(2)}×</output><input type="range" min="0.25" max="2.5" step="0.05" value={animation.speed} onChange={(event) => updatePlaybackSettings({ speed: Number(event.target.value) })} /></label><label>Duração do frame <output>{frameSeconds(selectedFrame?.durationMs ?? 250)}</output><input type="range" min="80" max="1600" step="20" value={selectedFrame?.durationMs ?? 250} onChange={(event) => changeFrameDuration(Number(event.target.value))} /></label><small>A duração é individual por frame. A animação usa uma cópia independente da origem.</small></div>}
          {!animation && <div className="animator-panel-empty"><Icon name="sparkles" /><strong>Prévia do modelo selecionado</strong><small>Crie uma animação para editar peças e registrar frames.</small></div>}
        </section>
      </aside>
    </div>
    <section className="animator-timeline-panel" aria-label="Sequência de frames"><header><span><strong>Frames</strong><small>{animation ? `${animation.frames.length} frames · ${frameSeconds(totalDuration)} total` : 'Crie uma animação para gravar estados'}</small></span><div className="animator-player-actions"><button disabled={!animation} onClick={() => seek(0)} type="button" title="Voltar ao início">⏮</button><button className="animator-play" disabled={!animation} onClick={() => playing ? setPlaying(false) : play()} type="button">{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><label className="animator-loop-toggle"><input type="checkbox" checked={animation?.loopMode === 'loop'} disabled={!animation} onChange={(event) => updatePlaybackSettings({ loopMode: event.target.checked ? 'loop' : 'once' })} /><span>Loop</span></label><button disabled={!animation || selectedFrameIndex >= (animation?.frames.length ?? 0) - 1} onClick={() => { if (animation && animation.frames[selectedFrameIndex + 1]) selectFrame(animation.frames[selectedFrameIndex + 1]) }} type="button" title="Próximo frame">⏭</button><span>{frameSeconds(playhead)} / {frameSeconds(totalDuration)}</span></div></header>
      {animation && <><input className="animator-scrubber" type="range" min="0" max={Math.max(1, totalDuration)} step="1" value={Math.min(playhead, totalDuration)} onChange={(event) => seek(Number(event.target.value))} aria-label="Posição na sequência"/><div className="animator-frame-strip">{animation.frames.map((frame, index) => <button key={frame.id} className={`animator-frame-card${frame.id === selectedFrameId ? ' active' : ''}${frame.id === selectedFrameId && dirtyFrame ? ' dirty' : ''}`} onClick={() => selectFrame(frame)} type="button"><span className="animator-frame-thumb">{frame.thumbnailDataUrl && <img src={frame.thumbnailDataUrl} alt="" />}</span><b>{String(index + 1).padStart(2, '0')}</b><small>{frameSeconds(frame.durationMs)}</small></button>)}</div><div className="animator-frame-actions"><button className="pose-button primary" disabled={!dirtyFrame || playing} onClick={() => void saveFrame()} type="button"><Icon name="check" /> Salvar frame</button><button className="pose-button secondary" disabled={!selectedFrame || playing} onClick={duplicateFrame} type="button">Duplicar</button><button className="pose-button secondary" disabled={!selectedFrame || playing} onClick={() => setCopiedTransforms({ transforms: structuredClone(currentTransforms), joints: structuredClone(currentJoints) })} type="button">Copiar transforms</button><button className="pose-button secondary" disabled={!copiedTransforms || playing} onClick={() => { if (!copiedTransforms) return; pushHistory(); setCurrentTransforms(structuredClone(copiedTransforms.transforms)); setCurrentJoints(structuredClone(copiedTransforms.joints)) }} type="button">Colar transforms</button><button className="pose-icon-button" disabled={selectedFrameIndex <= 0 || playing} onClick={() => reorderFrame(-1)} title="Mover frame para trás" type="button">←</button><button className="pose-icon-button" disabled={!animation || selectedFrameIndex >= animation.frames.length - 1 || playing} onClick={() => reorderFrame(1)} title="Mover frame para frente" type="button">→</button><button className="pose-button danger" disabled={!selectedFrame || animation.frames.length <= 1 || playing} onClick={deleteFrame} type="button"><Icon name="trash" /> Excluir frame</button></div></>}
    </section>
  </section>
}
