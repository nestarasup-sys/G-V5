import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceComponentAsset, FaceExpressionPreset, FaceExpressionPresetSummary, FaceTransform } from '../../../../shared/fabricator'
import type { StudioElement, StudioExpressionBase, StudioFaceTransforms } from '../../../../shared/studio'

export function studioExpressionCollection(element: Pick<StudioElement, 'activeExpressionCollectionId' | 'activeExpressionPresetId'> | null, presets: FaceExpressionPresetSummary[]): string {
  return element?.activeExpressionCollectionId ?? presets.find((preset) => preset.id === element?.activeExpressionPresetId)?.collectionId ?? 'standard'
}

/** Apply the same left-looking pupil offset as the Expressão Dev `pt` button. */
export async function presetWithPupilsLookingLeft(preset: FaceExpressionPreset, loadComponent: (id: string) => Promise<FaceComponentAsset | null>): Promise<FaceExpressionPreset | null> {
  const next = structuredClone(preset)
  let changed = false
  for (const side of ['left', 'right'] as const) {
    const eyeId = preset.selections.eyes[side]
    const pupilId = preset.selections.pupils[side]
    if (!eyeId || !pupilId) continue
    const [eye, pupil] = await Promise.all([loadComponent(eyeId), loadComponent(pupilId)])
    if (!eye || !pupil) continue
    const eyeTransform = next.transforms[side === 'left' ? 'eyeLeft' : 'eyeRight']
    const key = side === 'left' ? 'pupilLeft' : 'pupilRight'
    const pointsLeft = side === 'left' || pupil.rightSidePositioned === true
    next.transforms[key] = { ...next.transforms[key], x: (pointsLeft ? -1 : 1) * eye.width * eyeTransform.scaleX * .16 }
    changed = true
  }
  return changed ? next : null
}

/** Fallback for characters whose default face has no saved expression preset. */
export async function appearanceWithPupilsLookingLeft(appearance: CustomizerFaceAppearance, loadComponent: (id: string) => Promise<FaceComponentAsset | null>): Promise<StudioFaceTransforms | null> {
  const transforms: StudioFaceTransforms = {}
  let changed = false
  for (const side of ['left', 'right'] as const) {
    const eyeSelection = appearance.components?.[`eye-${side}`]
    const pupilSelection = appearance.components?.[`pupil-${side}`]
    if (!eyeSelection?.assetId || !pupilSelection?.assetId) continue
    const [eye, pupil] = await Promise.all([loadComponent(eyeSelection.assetId), loadComponent(pupilSelection.assetId)])
    if (!eye || !pupil) continue
    const eyeTransform = eyeSelection.transform ?? eye.defaultTransform
    const pupilTransform = pupilSelection.transform ?? pupil.defaultTransform
    const pointsLeft = side === 'left' || pupil.rightSidePositioned === true
    transforms[`expression-component:pupil-${side}`] = {
      x: 0, y: 0, width: 100, height: 100, rotation: 0,
      sourceTransformOverride: { ...pupilTransform, x: (pointsLeft ? -1 : 1) * eye.width * eyeTransform.scaleX * .16 }
    }
    changed = true
  }
  return changed ? transforms : null
}

export function resolveStudioExpressionBase(element: Pick<StudioElement, 'expressionBase' | 'faceTransforms'>, characterAppearance: CustomizerFaceAppearance): StudioExpressionBase {
  return structuredClone(element.expressionBase ?? {
    appearance: characterAppearance,
    transforms: Object.fromEntries(Object.entries(element.faceTransforms ?? {}).filter(([key]) => !key.startsWith('expression-component:') && !key.startsWith('expression:')))
  })
}

export async function buildStudioExpressionAppearance(preset: FaceExpressionPreset, base: CustomizerFaceAppearance, loadCatalog: (id: string) => Promise<FaceCatalogItem | null>): Promise<CustomizerFaceAppearance> {
  const next = structuredClone(base)
  // Opacity and colors belong to the character's Base, including explicit zero
  // opacity. The author's nose opacity is only used in the Dev preview.
  const desiredOpen = preset.selections.mouth?.kind === 'mouth-open'
  const hasDesiredMouth = Boolean(desiredOpen ? base.mouthOpenCatalogId : base.mouthClosedCatalogId)
  const mouthOpen = preset.selections.mouth && hasDesiredMouth ? desiredOpen : base.mouthOpen
  const mouthId = mouthOpen ? base.mouthOpenCatalogId : base.mouthClosedCatalogId
  if (mouthId && preset.selections.mouth) {
    const mouth = await loadCatalog(mouthId)
    const sheet = mouthOpen ? 'mouth-open' : 'mouth-closed'
    const index = preset.selections.mouth.index
    if (mouth?.pieces.some((piece) => piece.sheet === sheet && piece.index === index)) {
      next.expressionIndex = index
      next.mouthOpen = mouthOpen
    }
  }
  return next
}

function relativePieceSize(source: { width: number; height: number }, base: FaceTransform, target: { width: number; height: number }, targetBase: FaceTransform) {
  return { x: target.width * targetBase.scaleX / (source.width * base.scaleX), y: target.height * targetBase.scaleY / (source.height * base.scaleY) }
}

/** Transfer the authored change, relative to each asset's own calibrated base. */
export function transferExpressionTransform(base: FaceTransform, expression: FaceTransform, target: FaceTransform, sourceMirrored = false, targetMirrored = false, positionScale = { x: 1, y: 1 }): FaceTransform {
  for (const value of [base, expression, target]) {
    if (![value.x, value.y, value.scaleX, value.scaleY, value.rotation].every(Number.isFinite) || value.scaleX <= 0 || value.scaleY <= 0) {
      throw new Error('A expressão contém uma transformação facial inválida. Restaure e salve essa expressão no Expressão Dev.')
    }
  }
  if (![positionScale.x, positionScale.y].every((value) => Number.isFinite(value) && value > 0)) throw new Error('A referência de tamanho desta expressão é inválida.')
  const direction = (sourceMirrored ? -1 : 1) * (targetMirrored ? -1 : 1)
  const transferred = {
    x: target.x + (expression.x - base.x) * direction * positionScale.x,
    y: target.y + (expression.y - base.y) * positionScale.y,
    scaleX: target.scaleX * (expression.scaleX / base.scaleX),
    scaleY: target.scaleY * (expression.scaleY / base.scaleY),
    rotation: target.rotation + (expression.rotation - base.rotation) * direction,
    flipX: Boolean(target.flipX) !== (Boolean(expression.flipX) !== Boolean(base.flipX))
  }
  if (![transferred.x, transferred.y, transferred.scaleX, transferred.scaleY, transferred.rotation].every(Number.isFinite)) throw new Error('A expressão ultrapassou os limites de transformação.')
  return transferred
}

export async function buildStudioExpressionTransforms(
  preset: FaceExpressionPreset,
  appearance: CustomizerFaceAppearance,
  previous: StudioFaceTransforms,
  loadComponent: (id: string) => Promise<FaceComponentAsset | null>,
  loadCatalog: (id: string) => Promise<FaceCatalogItem | null>
): Promise<StudioFaceTransforms> {
  const components = new Map<string, Promise<FaceComponentAsset | null>>()
  const catalogs = new Map<string, Promise<FaceCatalogItem | null>>()
  const component = (id: string) => {
    if (!components.has(id)) components.set(id, loadComponent(id))
    return components.get(id)!
  }
  const catalog = (id: string) => {
    if (!catalogs.has(id)) catalogs.set(id, loadCatalog(id))
    return catalogs.get(id)!
  }
  const result = Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('expression-component:') && !key.startsWith('expression:')))
  const put = (key: string, transform: FaceTransform) => {
    result[key] = { x: 0, y: 0, width: 100, height: 100, rotation: 0, sourceTransformOverride: transform }
  }
  const sideCatalog = (key: 'eyeLeftCatalogId' | 'eyeRightCatalogId' | 'eyebrowLeftCatalogId' | 'eyebrowRightCatalogId', shared: string | undefined) => Object.hasOwn(appearance, key) ? appearance[key] : shared
  await Promise.all((['left', 'right'] as const).flatMap((side) => (['eye', 'pupil', 'brow'] as const).map(async (kind) => {
    const right = side === 'right'
    const part = `${kind}-${side}` as const
    const layer = `${kind}${right ? 'Right' : 'Left'}` as 'eyeLeft' | 'eyeRight' | 'pupilLeft' | 'pupilRight' | 'browLeft' | 'browRight'
    const sourceId = (kind === 'eye' ? preset.selections.eyes : kind === 'pupil' ? preset.selections.pupils : preset.selections.eyebrows)[side]
    if (!sourceId) return
    const source = await component(sourceId)
    if (!source) throw new Error('Um asset de referência desta expressão não está disponível. Abra e salve a expressão no Expressão Dev.')
    const base = preset.referenceTransforms?.[layer] ?? source.defaultTransform
    const targetId = appearance.components?.[part]?.assetId
    if (targetId) {
      const target = await component(targetId)
      if (!target) return
      const targetBase = appearance.components?.[part]?.transform ?? target.defaultTransform
      let positionScale = relativePieceSize(source, base, target, targetBase)
      if (kind === 'pupil') {
        const sourceEyeId = preset.selections.eyes[side]
        const targetEyeId = appearance.components?.[`eye-${side}`]?.assetId
        const [sourceEye, targetEye] = await Promise.all([sourceEyeId ? component(sourceEyeId) : null, targetEyeId ? component(targetEyeId) : null])
        if (sourceEye && targetEye) {
          const eyeBase = preset.referenceTransforms?.[right ? 'eyeRight' : 'eyeLeft'] ?? sourceEye.defaultTransform
          positionScale = relativePieceSize(sourceEye, eyeBase, targetEye, appearance.components?.[`eye-${side}`]?.transform ?? targetEye.defaultTransform)
        }
      }
      put(`expression-component:${part}`, transferExpressionTransform(base, preset.transforms[layer], targetBase, right && !source.rightSidePositioned, right && !target.rightSidePositioned, positionScale))
    } else if (kind !== 'pupil') {
      const id = kind === 'eye' ? sideCatalog(right ? 'eyeRightCatalogId' : 'eyeLeftCatalogId', appearance.eyeCatalogId) : sideCatalog(right ? 'eyebrowRightCatalogId' : 'eyebrowLeftCatalogId', appearance.eyebrowCatalogId)
      if (!id) return
      const target = await catalog(id)
      const element = part as 'eye-left' | 'eye-right' | 'brow-left' | 'brow-right'
      const targetBase = appearance.transforms?.[element] ?? target?.transforms[element]
      const piece = target?.pieces?.find((candidate) => candidate.side === side && candidate.index === (kind === 'eye' ? appearance.eyeState ?? 0 : 0))
      if (targetBase) put(`expression:${part}:${id}`, transferExpressionTransform(base, preset.transforms[layer], targetBase, right && !source.rightSidePositioned, false, piece ? relativePieceSize(source, base, piece, targetBase) : { x: 1, y: 1 }))
    }
  })))
  const noseChoice = preset.selections.nose
  if (noseChoice && appearance.noseCatalogId) {
    const [source, target] = await Promise.all([catalog(noseChoice.catalogId), catalog(appearance.noseCatalogId)])
    const base = preset.referenceTransforms?.nose ?? source?.transforms.nose
    const targetBase = appearance.transforms?.nose ?? target?.transforms.nose
    if (base && targetBase) {
      const sourcePiece = source?.pieces?.find((piece) => piece.sheet === 'nose' && piece.index === noseChoice.index)
      const targetPiece = target?.pieces?.find((piece) => piece.sheet === 'nose' && piece.index === appearance.noseIndex)
      const positionScale = sourcePiece && targetPiece ? relativePieceSize(sourcePiece, base, targetPiece, targetBase) : { x: 1, y: 1 }
      put(`expression:nose:${appearance.noseCatalogId}`, transferExpressionTransform(base, preset.transforms.nose, targetBase, false, false, positionScale))
    }
  }

  // A mouth preset authors one shape at a time, while Studio's Idle/Talk modes
  // switch between the character's closed and talking sheets. Transfer the
  // same authored change to both sheets so the speaking mouth keeps the same
  // placement and scale as its closed counterpart.
  const mouthChoice = preset.selections.mouth
  if (mouthChoice) {
    const source = await catalog(mouthChoice.catalogId)
    const base = preset.referenceTransforms?.mouth ?? source?.transforms.mouth
    if (source && base) {
      const sourcePiece = source.pieces.find((piece) => piece.sheet === mouthChoice.kind && piece.index === mouthChoice.index)
      const closedTargetId = appearance.mouthClosedCatalogId
      const closedTarget = closedTargetId ? await catalog(closedTargetId) : null
      const sharedTargetBase = appearance.transforms?.mouth ?? closedTarget?.transforms.mouth
      await Promise.all((['mouth-closed', 'mouth-open'] as const).map(async (sheet) => {
        const targetId = sheet === 'mouth-open' ? appearance.mouthOpenCatalogId : appearance.mouthClosedCatalogId
        if (!targetId) return
        const target = await catalog(targetId)
        const targetBase = sharedTargetBase ?? target?.transforms.mouth
        if (!targetBase) return
        const targetPiece = target?.pieces.find((piece) => piece.sheet === sheet && piece.index === appearance.expressionIndex)
        const positionScale = sourcePiece && targetPiece ? relativePieceSize(sourcePiece, base, targetPiece, targetBase) : { x: 1, y: 1 }
        put(`expression:${sheet}:${targetId}`, transferExpressionTransform(base, preset.transforms.mouth, targetBase, false, false, positionScale))
      }))
    }
  }
  return result
}
