import type { FaceComponentAsset, FaceComponentKind, FaceTransform, ModelPart } from '../../../../../shared/fabricator'

export type AlignableFaceKind = Extract<FaceComponentKind, 'eye' | 'pupil' | 'eye-closed'>
export type FaceImportAnchor = {
  left: { width: number; height: number; transform: FaceTransform }
  right: { width: number; height: number; transform: FaceTransform }
}

type PositionedFacePiece = Pick<FaceComponentAsset, 'width' | 'defaultTransform' | 'rightSidePositioned'>

/** Keep the closed eye centered over the visible open eye, regardless of source image dimensions. */
export function fitClosedEyeToOpen(closed: PositionedFacePiece, open: PositionedFacePiece, head: ModelPart, rightSide: boolean): FaceTransform {
  const openX = rightSide && !open.rightSidePositioned ? head.width - open.defaultTransform.x : open.defaultTransform.x
  return {
    ...closed.defaultTransform,
    x: rightSide && !closed.rightSidePositioned ? head.width - openX : openX,
    y: open.defaultTransform.y,
    scaleX: open.width * open.defaultTransform.scaleX / closed.width
  }
}

function asPhysicalRight(asset: FaceComponentAsset, head: ModelPart): FaceTransform {
  const transform = asset.defaultTransform
  if (asset.rightSidePositioned || asset.kind === 'pupil') return { ...transform }
  return { ...transform, x: head.width - transform.x, rotation: -transform.rotation, flipX: !transform.flipX }
}

export function captureFaceImportAnchor(left: FaceComponentAsset, right: FaceComponentAsset | undefined, head: ModelPart): FaceImportAnchor {
  const leftTransform = { ...left.defaultTransform }
  const rightTransform = right && right.id !== left.id ? asPhysicalRight(right, head) : {
    ...leftTransform,
    x: left.kind === 'pupil' ? -leftTransform.x : head.width - leftTransform.x,
    rotation: -leftTransform.rotation,
    flipX: !leftTransform.flipX
  }
  return {
    left: { width: left.width, height: left.height, transform: leftTransform },
    right: { width: right?.width ?? left.width, height: right?.height ?? left.height, transform: rightTransform }
  }
}

export function alignImportedFacePiece(kind: AlignableFaceKind, side: 'left' | 'right', width: number, height: number, anchor: FaceImportAnchor): FaceTransform {
  const reference = anchor[side]
  const scaleX = kind === 'pupil' ? reference.transform.scaleX : reference.width * reference.transform.scaleX / width
  const scaleY = kind === 'pupil' ? reference.transform.scaleY : reference.height * reference.transform.scaleY / height
  if (![scaleX, scaleY].every((scale) => Number.isFinite(scale) && scale > 0 && scale <= 20)) {
    throw new Error('A diferença de tamanho desta folha excede o limite de ajuste. Use uma folha com resolução mais próxima da referência.')
  }
  return { ...reference.transform, scaleX, scaleY }
}

export function validFaceImportAnchor(value: unknown): value is FaceImportAnchor {
  if (!value || typeof value !== 'object') return false
  const record = value as FaceImportAnchor
  return [record.left, record.right].every((side) => side && Number.isFinite(side.width) && side.width > 0 && Number.isFinite(side.height) && side.height > 0
    && side.transform && [side.transform.x, side.transform.y, side.transform.scaleX, side.transform.scaleY, side.transform.rotation].every(Number.isFinite)
    && side.transform.scaleX > 0 && side.transform.scaleY > 0)
}
