import type { CustomizerCharacter, CustomizerFaceAppearance, FaceComponentPartId } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceComponentAsset, FaceElementKind, FaceExpressionEffects, FaceTransform, FabricatorProject } from '../../../../shared/fabricator'
import type { StudioFaceTransforms, VideoCharacterState } from '../../../../shared/studio'
import type { VideoCharacterRenderAssetProvider } from '../../../../shared/videoCharacterRenderAssets'
import { faceRenderGeometry, trimTransparentImage } from './characterGeometry'
import { mixAppearance, mixEffects, mixPoseArtwork, mixStageElement, mixStudioTransforms, smoothProgress, transitionProgress, type PoseArtwork } from '../../../../shared/videoCharacterInterpolation'
import type { CharacterTransition } from './characterTransitions'

/** Resolve the same visible defaults as the ordinary character compositor. */
function visibleEffects(appearance: CustomizerFaceAppearance | undefined, effects: FaceExpressionEffects | undefined): FaceExpressionEffects {
  const disabled = { enabled: false, color: '#000000', opacity: 0, softness: .5, size: .1, offsetY: 0 }
  return {
    shadow: effects?.shadow ?? disabled,
    blush: effects?.blush ?? disabled,
    mouthBlush: appearance?.mouthBlushEnabled
      ? { softness: .78, size: .12, width: .12, height: .0624, rotation: 0, offsetY: 0, aspectRatio: .52, ...effects?.mouthBlush,
          color: appearance.mouthBlushColor ?? effects?.mouthBlush.color ?? '#e86388', opacity: appearance.mouthBlushOpacity ?? effects?.mouthBlush.opacity ?? .38, enabled: true }
      : { ...(effects?.mouthBlush ?? disabled), enabled: false, opacity: 0 }
  }
}

/** Session-local reader. No supplier, character, or timeline writes are exposed. */
export class TransitionRenderer {
  constructor(private readonly assetProvider: VideoCharacterRenderAssetProvider = window.desktop) {}

  private models = new Map<number, Promise<FabricatorProject | null>>()
  private poses = new Map<string, Promise<PoseArtwork | null>>()
  private components = new Map<string, Promise<FaceComponentAsset | null>>()
  private catalogs = new Map<string, Promise<FaceCatalogItem | null>>()
  private effects = new Map<number, Promise<Record<number, FaceExpressionEffects>>>()

  private model(slot: number) {
    if (!this.models.has(slot)) this.models.set(slot, this.assetProvider.loadFabricatorSlot(slot))
    return this.models.get(slot)!
  }
  private pose(slot: number, pose: number | null) {
    if (pose === null) return this.model(slot)
    const key = `${slot}:${pose}`
    if (!this.poses.has(key)) this.poses.set(key, this.assetProvider.loadFabricatorPose(slot, pose))
    return this.poses.get(key)!
  }
  private component(slot: number, id: string) {
    const key = `${slot}:${id}`
    if (!this.components.has(key)) this.components.set(key, this.assetProvider.loadFaceComponentAsset(slot, id))
    return this.components.get(key)!
  }
  private catalog(slot: number, id: string) {
    const key = `${slot}:${id}`
    if (!this.catalogs.has(key)) this.catalogs.set(key, this.assetProvider.loadFaceCatalogItem(slot, id))
    return this.catalogs.get(key)!
  }

  /** Base -> preset needs the actual supplier calibration, never an invented transform. */
  private async sourceTransform(key: string, appearance: CustomizerFaceAppearance | undefined): Promise<FaceTransform | undefined> {
    if (!appearance) return undefined
    if (key.startsWith('expression-component:')) {
      const part = key.slice('expression-component:'.length) as FaceComponentPartId
      const selection = appearance.components?.[part]
      if (selection?.transform) return selection.transform
      return selection?.assetId ? (await this.component(appearance.modelSlot, selection.assetId))?.defaultTransform : undefined
    }
    const [, category, id] = key.split(':')
    if (!id) return undefined
    const element = category.startsWith('mouth-') ? 'mouth' : category as FaceElementKind
    const targetId = element === 'mouth' ? appearance.mouthClosedCatalogId ?? id : id
    return appearance.transforms?.[element] ?? (await this.catalog(appearance.modelSlot, targetId))?.transforms[element]
  }

  private async normalizedTransforms(from: StudioFaceTransforms, to: StudioFaceTransforms, a: CustomizerFaceAppearance | undefined, b: CustomizerFaceAppearance | undefined) {
    const left = { ...from }, right = { ...to }
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (!from[key]?.sourceTransformOverride && !to[key]?.sourceTransformOverride) continue
      const av = from[key]?.sourceTransformOverride ?? await this.sourceTransform(key, a)
      const bv = to[key]?.sourceTransformOverride ?? await this.sourceTransform(key, b)
      if (!av || !bv) throw new Error('Uma referência facial da transição não está disponível no fornecedor.')
      left[key] = { ...(from[key] ?? { x: 0, y: 0, width: 100, height: 100, rotation: 0 }), sourceTransformOverride: av }
      right[key] = { ...(to[key] ?? { x: 0, y: 0, width: 100, height: 100, rotation: 0 }), sourceTransformOverride: bv }
    }
    return { left, right }
  }

  async render(transition: CharacterTransition, frame: number, character: CustomizerCharacter): Promise<VideoCharacterState> {
    const t = smoothProgress(transitionProgress(transition, frame))
    if (t <= 0) return transition.from
    if (t >= 1) return transition.to
    const a = transition.from.element, b = transition.to.element
    const slot = character.customization.modelSlot ?? 1
    const [source, fromPose, toPose, rendererModule] = await Promise.all([
      this.model(slot), this.pose(slot, a.poseSlot === undefined ? character.customization.poseSlot : a.poseSlot),
      this.pose(slot, b.poseSlot === undefined ? character.customization.poseSlot : b.poseSlot), import('../customizer/CustomizerPage')
    ])
    if (!source || !fromPose || !toPose) throw new Error(`Uma pose de ${character.name} não está disponível para a animação.`)
    const aa = a.faceAppearance ?? character.customization.faceAppearance, ba = b.faceAppearance ?? character.customization.faceAppearance
    const appearance = aa && ba ? mixAppearance(aa, ba, t) : aa ?? ba
    const normalized = await this.normalizedTransforms(a.faceTransforms ?? {}, b.faceTransforms ?? {}, aa, ba)
    const transforms = mixStudioTransforms(normalized.left, normalized.right, t)
    if (!this.effects.has(slot)) this.effects.set(slot, rendererModule.loadStandardExpressionEffects(slot, this.assetProvider))
    const defaults = await this.effects.get(slot)!
    const effects = mixEffects(visibleEffects(aa, a.activeExpressionEffects ?? (aa ? defaults[aa.expressionIndex] : undefined)), visibleEffects(ba, b.activeExpressionEffects ?? (ba ? defaults[ba.expressionIndex] : undefined)), t)
    const element = mixStageElement(a, b, t)
    const artwork = mixPoseArtwork(fromPose, toPose, t)
    const copy: CustomizerCharacter = { ...character, customization: { ...character.customization, faceAppearance: appearance } }
    const renderer = await rendererModule.prepareSavedCharacterRenderer(copy, { source, artwork, assetProvider: this.assetProvider })
    const mode = t < .5 ? a.activeFaceMode : b.activeFaceMode
    const rendered = await renderer.render(appearance, transforms, effects, mode)
    const crop = await trimTransparentImage(rendered.dataUrl)
    // Rendering is measured against the invariant 1920x1080 stage, not window pixels.
    const geometry = faceRenderGeometry(element, rendered, crop, 1920, 1080)
    return { element: { ...element, ...geometry, faceAppearance: appearance, faceTransforms: transforms, activeExpressionEffects: effects }, imageDataUrl: crop?.dataUrl ?? rendered.dataUrl }
  }
}
