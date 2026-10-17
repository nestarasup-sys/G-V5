import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceComponentAsset, FaceExpressionPreset, FaceTransform } from '../../../../shared/fabricator'
import type { StudioFaceTransforms } from '../../../../shared/studio'

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
      let positionScale = { x: 1, y: 1 }
      if (kind === 'pupil') {
        const sourceEyeId = preset.selections.eyes[side]
        const targetEyeId = appearance.components?.[`eye-${side}`]?.assetId
        const [sourceEye, targetEye] = await Promise.all([sourceEyeId ? component(sourceEyeId) : null, targetEyeId ? component(targetEyeId) : null])
        if (sourceEye && targetEye) {
          const eyeBase = preset.referenceTransforms?.[right ? 'eyeRight' : 'eyeLeft'] ?? sourceEye.defaultTransform
          positionScale = { x: targetEye.width * targetEye.defaultTransform.scaleX / (sourceEye.width * eyeBase.scaleX), y: targetEye.height * targetEye.defaultTransform.scaleY / (sourceEye.height * eyeBase.scaleY) }
        }
      }
      put(`expression-component:${part}`, transferExpressionTransform(base, preset.transforms[layer], target.defaultTransform, right && !source.rightSidePositioned, right && !target.rightSidePositioned, positionScale))
    } else if (kind !== 'pupil') {
      const id = kind === 'eye' ? sideCatalog(right ? 'eyeRightCatalogId' : 'eyeLeftCatalogId', appearance.eyeCatalogId) : sideCatalog(right ? 'eyebrowRightCatalogId' : 'eyebrowLeftCatalogId', appearance.eyebrowCatalogId)
      if (!id) return
      const target = await catalog(id)
      const targetBase = target?.transforms[part as 'eye-left' | 'eye-right' | 'brow-left' | 'brow-right']
      if (targetBase) put(`expression:${part}:${id}`, transferExpressionTransform(base, preset.transforms[layer], targetBase, right && !source.rightSidePositioned))
    }
  })))
  await Promise.all((['nose', 'mouth'] as const).map(async (kind) => {
    const sourceChoice = preset.selections[kind]
    const targetId = kind === 'nose' ? appearance.noseCatalogId : appearance.mouthOpen ? appearance.mouthOpenCatalogId : appearance.mouthClosedCatalogId
    if (!sourceChoice || !targetId) return
    const [source, target] = await Promise.all([catalog(sourceChoice.catalogId), catalog(targetId)])
    const base = preset.referenceTransforms?.[kind] ?? source?.transforms[kind]
    const targetBase = target?.transforms[kind]
    if (!base || !targetBase) return
    const sheet = kind === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    put(`expression:${sheet}:${targetId}`, transferExpressionTransform(base, preset.transforms[kind], targetBase))
  }))
  return result
}
