import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceComponentAsset, FaceExpressionPreset, FaceExpressionPresetSummary, FaceTransform } from '../../../../shared/fabricator'
import type { StudioElement, StudioExpressionBase, StudioFaceTransforms } from '../../../../shared/studio'

export function studioExpressionCollection(element: Pick<StudioElement, 'activeExpressionCollectionId' | 'activeExpressionPresetId'> | null, presets: FaceExpressionPresetSummary[]): string {
  return element?.activeExpressionCollectionId ?? presets.find((preset) => preset.id === element?.activeExpressionPresetId)?.collectionId ?? 'standard'
}

export function resolveStudioExpressionBase(element: Pick<StudioElement, 'expressionBase' | 'faceTransforms'>, characterAppearance: CustomizerFaceAppearance): StudioExpressionBase {
  return structuredClone(element.expressionBase ?? {
    appearance: characterAppearance,
    transforms: Object.fromEntries(Object.entries(element.faceTransforms ?? {}).filter(([key]) => !key.startsWith('expression-component:') && !key.startsWith('expression:')))
  })
}

export async function buildStudioExpressionAppearance(preset: FaceExpressionPreset, base: CustomizerFaceAppearance, loadCatalog: (id: string) => Promise<FaceCatalogItem | null>): Promise<CustomizerFaceAppearance> {
  const next = structuredClone(base)
  if (preset.selections.nose) next.noseOpacity = preset.noseOpacity
  const desiredOpen = preset.selections.mouth?.kind === 'mouth-open'
  if (preset.selections.mouth && (desiredOpen ? base.mouthOpenCatalogId : base.mouthClosedCatalogId)) next.mouthOpen = desiredOpen
  const mouthId = next.mouthOpen ? base.mouthOpenCatalogId : base.mouthClosedCatalogId
  if (mouthId && preset.selections.mouth) {
    const mouth = await loadCatalog(mouthId)
    const sheet = next.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const index = preset.selections.mouth.index
    if (mouth?.pieces.some((piece) => piece.sheet === sheet && piece.index === index)) next.expressionIndex = index
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
  await Promise.all((['nose', 'mouth'] as const).map(async (kind) => {
    const sourceChoice = preset.selections[kind]
    const targetId = kind === 'nose' ? appearance.noseCatalogId : appearance.mouthOpen ? appearance.mouthOpenCatalogId : appearance.mouthClosedCatalogId
    if (!sourceChoice || !targetId) return
    const [source, target] = await Promise.all([catalog(sourceChoice.catalogId), catalog(targetId)])
    const base = preset.referenceTransforms?.[kind] ?? source?.transforms[kind]
    const targetBase = appearance.transforms?.[kind] ?? target?.transforms[kind]
    if (!base || !targetBase) return
    const sheet = kind === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const sourcePiece = source?.pieces?.find((piece) => piece.index === sourceChoice.index)
    const targetPiece = target?.pieces?.find((piece) => piece.index === (kind === 'nose' ? appearance.noseIndex : appearance.expressionIndex))
    const positionScale = sourcePiece && targetPiece ? relativePieceSize(sourcePiece, base, targetPiece, targetBase) : { x: 1, y: 1 }
    put(`expression:${sheet}:${targetId}`, transferExpressionTransform(base, preset.transforms[kind], targetBase, false, false, positionScale))
  }))
  return result
}
