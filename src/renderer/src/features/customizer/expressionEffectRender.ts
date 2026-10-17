import type { FaceCatalogItem, FaceExpressionEffects, FaceSheetKind, FaceElementKind } from '../../../../shared/fabricator'
import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FabricatorProject } from '../../../../shared/fabricator'

type Artwork = Pick<FabricatorProject, 'width' | 'height'>
type HeadPart = FabricatorProject['parts'][number]

const rgba = (hex: string, alpha: number) => {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000'
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${Math.max(0, Math.min(1, alpha))})`
}

/** Draw per-expression color effects into a temporary, head-masked preview layer. */
export async function drawFaceExpressionEffects(context: CanvasRenderingContext2D, artwork: Artwork, sourceHead: HeadPart, head: HeadPart, appearance: CustomizerFaceAppearance, items: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>>, effects?: FaceExpressionEffects): Promise<void> {
  if (!effects || !Object.values(effects).some((effect) => effect.enabled && effect.opacity > 0)) return
  const layer = document.createElement('canvas')
  layer.width = context.canvas.width
  layer.height = context.canvas.height
  const paint = layer.getContext('2d')
  if (!paint) return
  paint.setTransform(layer.width / artwork.width, 0, 0, layer.height / artwork.height, 0, 0)
  const cx = head.x + head.width / 2, cy = head.y + head.height / 2
  const shadow = effects.shadow
  if (shadow.enabled && shadow.opacity > 0) {
    const extent = head.height * Math.max(.08, Math.min(.95, shadow.size))
    const gradient = paint.createLinearGradient(0, head.y, 0, head.y + extent)
    gradient.addColorStop(0, rgba(shadow.color, shadow.opacity * .88))
    gradient.addColorStop(Math.max(.05, 1 - shadow.softness), rgba(shadow.color, shadow.opacity * .52))
    gradient.addColorStop(1, rgba(shadow.color, 0))
    paint.fillStyle = gradient
    paint.fillRect(head.x, head.y, head.width, extent)
  }
  const blob = (x: number, y: number, width: number, height: number, color: string, opacity: number, softness: number) => {
    paint.save(); paint.translate(x, y); paint.rotate(head.rotation * Math.PI / 180); paint.scale(Math.max(1, width / 2), Math.max(1, height / 2))
    const gradient = paint.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, rgba(color, opacity)); gradient.addColorStop(Math.max(.05, 1 - softness), rgba(color, opacity * .62)); gradient.addColorStop(1, rgba(color, 0))
    paint.fillStyle = gradient; paint.fillRect(-1, -1, 2, 2); paint.restore()
  }
  const blush = effects.blush
  if (blush.enabled && blush.opacity > 0) {
    const dx = head.width * .245, y = cy + head.height * (.2 + blush.offsetY)
    blob(cx - dx, y, head.width * blush.size * .42, head.height * blush.size * .2, blush.color, blush.opacity, blush.softness)
    blob(cx + dx, y, head.width * blush.size * .42, head.height * blush.size * .2, blush.color, blush.opacity, blush.softness)
  }
  const mouth = effects.mouthBlush
  const mouthKind = appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
  const mouthId = appearance.mouthOpen ? appearance.mouthOpenCatalogId : appearance.mouthClosedCatalogId
  const mouthItem = mouthId ? items[mouthKind] : undefined
  const mouthTransform = appearance.transforms?.mouth ?? mouthItem?.transforms.mouth
  const mouthPiece = mouthItem?.pieces.find((piece) => piece.sheet === mouthKind && piece.index === appearance.expressionIndex)
  if (mouth.enabled && mouth.opacity > 0 && mouthTransform && mouthPiece) {
    const x = mouthTransform.x / Math.max(1, sourceHead.width) * head.width
    const y = mouthTransform.y / Math.max(1, sourceHead.height) * head.height
    const angle = head.rotation * Math.PI / 180
    const mouthX = head.x + head.width / 2 + (x - head.width / 2) * Math.cos(angle) - (y - head.height / 2) * Math.sin(angle)
    const mouthY = head.y + head.height / 2 + (x - head.width / 2) * Math.sin(angle) + (y - head.height / 2) * Math.cos(angle) + mouth.offsetY * head.height
    blob(mouthX, mouthY, mouthPiece.width * mouthTransform.scaleX * mouth.size * 1.8, mouthPiece.height * mouthTransform.scaleY * mouth.size * 2.8, mouth.color, mouth.opacity, mouth.softness)
  }
  try {
    const mask = new Image()
    await new Promise<void>((resolve, reject) => { mask.onload = () => resolve(); mask.onerror = reject; mask.src = head.dataUrl })
    paint.globalCompositeOperation = 'destination-in'
    paint.save(); paint.translate(cx, cy); paint.rotate(head.rotation * Math.PI / 180); paint.drawImage(mask, -head.width / 2, -head.height / 2, head.width, head.height); paint.restore()
  } catch { return }
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(layer, 0, 0); context.restore()
}
