import type { ModelPart, WardrobeComponent } from '../../../../../shared/fabricator'

export type Point = { x: number; y: number }

/** CSS/Canvas 2D affine matrix in unzoomed artboard pixels. */
export type Affine2D = { a: number; b: number; c: number; d: number; e: number; f: number }
const identity = (): Affine2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
const translate = (x: number, y: number): Affine2D => ({ ...identity(), e: x, f: y })
const rotate = (degrees: number): Affine2D => {
  const angle = degrees * Math.PI / 180
  return { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 }
}
const scale = (x: number, y: number): Affine2D => ({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 })

/** Returns left × right: right acts on the point first. */
export function multiplyAffine(left: Affine2D, right: Affine2D): Affine2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  }
}
function compose(...matrices: Affine2D[]): Affine2D {
  return matrices.reduce(multiplyAffine, identity())
}
export function applyAffine(matrix: Affine2D, point: Point): Point {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }
}
export function invertAffine(matrix: Affine2D): Affine2D {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 1e-12) throw new Error('Transformação do osso sem inversa.')
  const a = matrix.d / determinant, b = -matrix.b / determinant
  const c = -matrix.c / determinant, d = matrix.a / determinant
  return { a, b, c, d, e: -(a * matrix.e + c * matrix.f), f: -(b * matrix.e + d * matrix.f) }
}

/**
 * The wardrobe is fitted on the ORIGINAL DISASSEMBLED SHEET, not on the
 * assembled model. The stored sourceTransform is the source frame, while
 * poseBone is the actual rendered frame (even for a zero-rotation pose).
 *
 * A 2D affine transform can represent rotation AND independently scaled axes.
 * Keeping it as one matrix also retains shear caused by rotating an already
 * non-uniformly resized garment, which separate CSS rotate/scale steps lose.
 */
export function sourceSheetToPose(sourceBone: ModelPart, poseBone: ModelPart): Affine2D {
  const source = sourceBone.sourceTransform
  const sourceWidth = Math.max(0.0001, source?.width ?? sourceBone.width)
  const sourceHeight = Math.max(0.0001, source?.height ?? sourceBone.height)
  const sourceCenter = {
    x: (source?.x ?? sourceBone.x) + sourceWidth / 2,
    y: (source?.y ?? sourceBone.y) + sourceHeight / 2
  }
  const poseCenter = { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 }
  return compose(
    translate(poseCenter.x, poseCenter.y),
    rotate(poseBone.rotation),
    scale(Math.max(0.0001, poseBone.width) / sourceWidth, Math.max(0.0001, poseBone.height) / sourceHeight),
    rotate(-(source?.rotation ?? sourceBone.rotation)),
    translate(-sourceCenter.x, -sourceCenter.y)
  )
}

/** The pixels of the adjusted garment, measured from its upper-left corner. */
export function mapWardrobeComponentToPose(
  component: WardrobeComponent,
  sourceBone: ModelPart,
  poseBone: ModelPart
): Affine2D {
  const garmentCenter = { x: component.x + component.width / 2, y: component.y + component.height / 2 }
  return compose(
    sourceSheetToPose(sourceBone, poseBone),
    translate(garmentCenter.x, garmentCenter.y),
    rotate(component.rotation),
    translate(-component.width / 2, -component.height / 2)
  )
}

/** CSS zoom belongs only to the translation; image width/height are zoomed separately. */
export function cssAffine(matrix: Affine2D, zoom: number, localY = 0): string {
  const e = matrix.e + matrix.c * localY
  const f = matrix.f + matrix.d * localY
  return `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${e * zoom}, ${f * zoom})`
}

/** A drag in the posed canvas converted back to the disassembled-sheet axes. */
export function poseDeltaToSource(delta: Point, sourceBone: ModelPart, poseBone: ModelPart): Point {
  const inverse = invertAffine(sourceSheetToPose(sourceBone, poseBone))
  return { x: inverse.a * delta.x + inverse.c * delta.y, y: inverse.b * delta.x + inverse.d * delta.y }
}

/**
 * A copied narrow band extends ONLY the knee-facing edge. Its dimensions are
 * never written into the garment and the original edited width/height stay
 * intact. The transform can be rendered using cssAffine(matrix, zoom, shift).
 */
export function kneeBand(
  component: WardrobeComponent,
  amount: number
): { shiftY: number; clipTop: number; clipBottom: number } | null {
  if (!Number.isFinite(amount) || amount <= 0 || component.height <= 0) return null
  const band = Math.min(amount, component.height / 3)
  if (component.category === 'calca-coxa') return { shiftY: band, clipTop: component.height - band, clipBottom: 0 }
  if (component.category === 'calca-canela') return { shiftY: -band, clipTop: 0, clipBottom: component.height - band }
  return null
}
