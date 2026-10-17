import type { FaceCatalogItem, FaceElementKind, FaceExpressionEffect, FaceExpressionEffects, FaceSheetKind, FabricatorProject } from '../../../../shared/fabricator'
import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { StudioFaceTransforms } from '../../../../shared/studio'

type Artwork = Pick<FabricatorProject, 'width' | 'height'>
type HeadPart = FabricatorProject['parts'][number]

function rgba(hex: string, alpha: number) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000'
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${Math.max(0, Math.min(1, alpha))})`
}

function radialBlob(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, angle: number, effect: FaceExpressionEffect, alpha = 1) {
  context.save()
  context.translate(x, y)
  context.rotate(angle)
  context.scale(Math.max(1, width / 2), Math.max(1, height / 2))
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, rgba(effect.color, effect.opacity * alpha))
  // Match Expression Dev's `radial-gradient(ellipse, color, transparent N%)`.
  // The previous midpoint stop made softness invert into a hard, saturated
  // center in the Customizer even though the Dev preview looked smooth.
  const transparentAt = Math.max(.05, Math.min(1, .4 + effect.softness * .58))
  gradient.addColorStop(transparentAt, rgba(effect.color, 0))
  gradient.addColorStop(1, rgba(effect.color, 0))
  context.fillStyle = gradient
  context.fillRect(-1, -1, 2, 2)
  context.restore()
}

/** Paint expression effects against the actual Studio head and active mouth transform. */
export async function drawFaceExpressionEffects(context: CanvasRenderingContext2D, artwork: Artwork, sourceHead: HeadPart, head: HeadPart, appearance: CustomizerFaceAppearance, items: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>>, effects?: FaceExpressionEffects, studioTransforms?: StudioFaceTransforms): Promise<void> {
  const mouthBlush: FaceExpressionEffect | undefined = appearance.mouthBlushEnabled
    ? {
      softness: .78, size: .12, width: .12, height: .0624, rotation: 0, offsetY: 0, aspectRatio: .52,
      ...effects?.mouthBlush, color: appearance.mouthBlushColor ?? effects?.mouthBlush.color ?? '#e86388',
      opacity: appearance.mouthBlushOpacity ?? effects?.mouthBlush.opacity ?? .38, enabled: true
    }
    : undefined
  const hasOtherEffects = Boolean(effects && (effects.shadow.enabled && effects.shadow.opacity > 0 || effects.blush.enabled && effects.blush.opacity > 0))
  if (!hasOtherEffects && (!mouthBlush || mouthBlush.opacity <= 0)) return
  const layer = document.createElement('canvas')
  layer.width = context.canvas.width
  layer.height = context.canvas.height
  const paint = layer.getContext('2d')
  if (!paint) return
  paint.setTransform(layer.width / artwork.width, 0, 0, layer.height / artwork.height, 0, 0)
  const cx = head.x + head.width / 2
  const cy = head.y + head.height / 2
  const shadow = effects?.shadow
  if (shadow?.enabled && shadow.opacity > 0) {
    const extent = head.height * shadow.size
    const startY = head.y + shadow.offsetY * head.height
    const gradient = paint.createLinearGradient(0, startY, 0, startY + extent)
    gradient.addColorStop(0, rgba(shadow.color, shadow.opacity * .78))
    gradient.addColorStop(Math.max(.05, 1 - shadow.softness), rgba(shadow.color, shadow.opacity * .6))
    gradient.addColorStop(1, rgba(shadow.color, 0))
    paint.fillStyle = gradient
    paint.fillRect(head.x, startY, head.width, extent)
  }
  const blush = effects?.blush
  if (blush?.enabled && blush.opacity > 0) {
    const width = head.width * blush.size
    const height = head.height * blush.size * (blush.aspectRatio ?? .52)
    const x = cx + head.width * (blush.offsetX ?? 0)
    const y = cy + head.height * blush.offsetY
    const angle = head.rotation * Math.PI / 180
    switch (blush.style ?? 'cheeks') {
      case 'cheeks':
        radialBlob(paint, x - width * .23, y, width * .54, height * .82, angle, blush, .54)
        radialBlob(paint, x + width * .23, y, width * .54, height * .82, angle, blush, .54)
        break
      case 'bands':
        radialBlob(paint, x, y - height * .24, width * .92, height * .28, angle, blush, .44)
        radialBlob(paint, x, y, width * .96, height * .28, angle, blush, .38)
        radialBlob(paint, x, y + height * .24, width * .92, height * .28, angle, blush, .32)
        break
      case 'diagonal': radialBlob(paint, x, y, width * .92, height * .58, angle - .28, blush, .54); break
      case 'spot': radialBlob(paint, x, y, width * .62, height * .62, angle, blush, .68); break
      default: radialBlob(paint, x, y, width, height, angle, blush, .54)
    }
  }
  const mouth = mouthBlush
  const mouthKind = appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
  const mouthId = appearance.mouthOpen ? appearance.mouthOpenCatalogId : appearance.mouthClosedCatalogId
  const mouthItem = mouthId ? items[mouthKind] : undefined
  const closedMouthItem = items['mouth-closed']
  const closedMouthOverride = closedMouthItem && (studioTransforms?.[`expression:mouth-closed:${closedMouthItem.id}`]?.sourceTransformOverride ?? studioTransforms?.[`expression:mouth:${closedMouthItem.id}`]?.sourceTransformOverride)
  const activeMouthOverride = mouthItem && (studioTransforms?.[`expression:${mouthKind}:${mouthItem.id}`]?.sourceTransformOverride ?? studioTransforms?.[`expression:mouth:${mouthItem.id}`]?.sourceTransformOverride)
  const mouthOverride = closedMouthOverride ?? activeMouthOverride
  const mouthTransform = mouthOverride ?? appearance.transforms?.mouth ?? items['mouth-closed']?.transforms.mouth ?? mouthItem?.transforms.mouth
  const mouthPiece = mouthItem?.pieces.find((piece) => piece.sheet === mouthKind && piece.index === appearance.expressionIndex)
  if (mouth?.enabled && mouth.opacity > 0 && mouthTransform && mouthPiece) {
    const localX = mouthTransform.x / sourceHead.width * head.width
    const localY = mouthTransform.y / sourceHead.height * head.height
    const angle = head.rotation * Math.PI / 180
    const x = cx + (localX - head.width / 2) * Math.cos(angle) - (localY - head.height / 2) * Math.sin(angle) + head.width * (mouth.offsetX ?? 0)
    const y = cy + (localX - head.width / 2) * Math.sin(angle) + (localY - head.height / 2) * Math.cos(angle) + head.height * mouth.offsetY
    const width = mouth.width ?? mouth.size
    const height = mouth.height ?? mouth.size * (mouth.aspectRatio ?? .52)
    radialBlob(paint, x, y, head.width * width, head.height * height, angle + (mouthTransform.rotation + (mouth.rotation ?? 0)) * Math.PI / 180, mouth)
  }
  try {
    const mask = new Image()
    await new Promise<void>((resolve, reject) => { mask.onload = () => resolve(); mask.onerror = reject; mask.src = head.dataUrl })
    paint.globalCompositeOperation = 'destination-in'
    paint.save()
    paint.translate(cx, cy)
    paint.rotate(head.rotation * Math.PI / 180)
    paint.drawImage(mask, -head.width / 2, -head.height / 2, head.width, head.height)
    paint.restore()
  } catch { return }
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.drawImage(layer, 0, 0)
  context.restore()
}
