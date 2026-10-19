import type { StudioElement, VideoCharacterState } from '../../../../shared/studio'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { VideoSceneFrame, VideoSceneLayer } from '../../../../shared/videoSceneIR'
import { videoCharacterElementSize, videoClipStageRect, videoStageRect, VIDEO_STAGE_HEIGHT, VIDEO_STAGE_WIDTH } from '../../../../shared/videoStageGeometry'

export type VideoCanvasFrameResources = Readonly<{
  /** Transition/blink/mouth renderer output keyed by Studio character element id. */
  characterStates?: ReadonlyMap<string, VideoCharacterState>
  /** Exact source video frame keyed by clip id. */
  videoFrames?: ReadonlyMap<string, CanvasImageSource>
}>

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const MAX_IMAGE_CACHE = 256

async function loadImage(source: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(source)
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Uma imagem da cena não pôde ser decodificada.'))
      image.src = source
    })
    imageCache.set(source, pending)
    if (imageCache.size > MAX_IMAGE_CACHE) {
      const oldest = imageCache.keys().next().value
      if (oldest) imageCache.delete(oldest)
    }
  }
  return pending
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight }
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height }
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height }
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return { width: source.width, height: source.height }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) return { width: source.width, height: source.height }
  const sized = source as { width?: number; height?: number }
  return { width: Number(sized.width) || 0, height: Number(sized.height) || 0 }
}

function drawTransformed(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  element: Pick<StudioElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  flipX = false,
  contain = false,
) {
  const rect = videoStageRect(element.x, element.y, element.width, element.height)
  context.save()
  context.translate(rect.centerX, rect.centerY)
  context.rotate(element.rotation * Math.PI / 180)
  if (flipX) context.scale(-1, 1)
  let width = rect.width, height = rect.height
  if (contain) {
    const sourceRect = sourceSize(source)
    if (sourceRect.width > 0 && sourceRect.height > 0) {
      const scale = Math.min(width / sourceRect.width, height / sourceRect.height)
      width = sourceRect.width * scale
      height = sourceRect.height * scale
    }
  }
  context.drawImage(source, -width / 2, -height / 2, width, height)
  context.restore()
}

function ellipsePath(context: CanvasRenderingContext2D, width: number, height: number) {
  context.beginPath()
  context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
}

function wrappedLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const paragraphs = String(text ?? '').split(/\n/)
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
        if (lines.length >= maxLines) break
      } else line = candidate
    }
    if (lines.length >= maxLines) break
    if (line) lines.push(line)
  }
  if (lines.length > maxLines) lines.length = maxLines
  return lines
}

function drawTextLayer(
  context: CanvasRenderingContext2D,
  element: StudioElement,
  speaker: StudioElement | undefined,
) {
  const rect = videoStageRect(element.x, element.y, element.width, element.height)
  const speakerName = speaker?.text || element.speakerName
  const speakerColor = videoCharacterTrackColor(element.speakerCharacterId ?? element.id, speaker?.timelineColor ?? element.speakerColor)
  context.save()
  context.translate(rect.centerX, rect.centerY)
  context.rotate(element.rotation * Math.PI / 180)
  context.fillStyle = element.kind === 'narrator' ? 'rgba(255,255,255,.90)' : element.kind === 'thought' ? '#fffafd' : 'rgba(255,255,255,.94)'
  context.strokeStyle = '#624d5b'
  context.lineWidth = 1.5

  if (element.kind === 'speech' || element.kind === 'thought') ellipsePath(context, rect.width, rect.height)
  else {
    context.beginPath()
    context.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, 9)
  }
  context.fill()
  context.stroke()

  if (element.kind === 'speech') {
    const x = rect.width * .22, y = rect.height / 2 - 1
    context.beginPath()
    context.moveTo(x - 8, y - 1)
    context.lineTo(x + 5, y + 12)
    context.lineTo(x + 8, y - 3)
    context.fill()
    context.stroke()
  } else if (element.kind === 'thought') {
    context.fillStyle = '#fffafd'
    context.strokeStyle = '#624d5b'
    for (const [x, y, radius] of [[rect.width * .35, rect.height * .48, 5], [rect.width * .42, rect.height * .60, 3]] as const) {
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke()
    }
  }

  const horizontalPadding = Math.min(28, Math.max(12, rect.width * .06))
  const speakerHeight = speakerName ? 24 : 0
  if (speakerName) {
    context.fillStyle = speakerColor
    context.font = '850 12px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(speakerName, 0, -rect.height / 2 + 14, Math.max(1, rect.width - horizontalPadding * 2))
    context.strokeStyle = speakerColor
    context.globalAlpha = .55
    context.beginPath()
    context.moveTo(-rect.width / 2 + horizontalPadding, -rect.height / 2 + 27)
    context.lineTo(rect.width / 2 - horizontalPadding, -rect.height / 2 + 27)
    context.stroke()
    context.globalAlpha = 1
  }

  context.fillStyle = '#352d35'
  context.font = '600 18px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const maxWidth = Math.max(1, rect.width - horizontalPadding * 2)
  const availableHeight = Math.max(1, rect.height - speakerHeight - 18)
  const lineHeight = 22
  const maxLines = Math.max(1, Math.min(8, Math.floor(availableHeight / lineHeight)))
  const lines = wrappedLines(context, element.text, maxWidth, maxLines)
  const textCenterY = speakerName ? speakerHeight / 2 + 4 : 0
  lines.forEach((line, index) => {
    const y = textCenterY + (index - (lines.length - 1) / 2) * lineHeight
    context.fillText(line, 0, y, maxWidth)
  })
  context.restore()
}

async function drawElementLayer(
  context: CanvasRenderingContext2D,
  layer: Extract<VideoSceneLayer, { type: 'element' }>,
  frame: VideoSceneFrame,
  resources: VideoCanvasFrameResources,
) {
  let element = layer.element
  let source = layer.assetDataUrl
  if (element.kind === 'character') {
    const override = resources.characterStates?.get(element.id)
    if (override) { element = override.element; source = override.imageDataUrl }
  }
  if ((element.kind === 'image' || element.kind === 'character') && source) {
    const image = await loadImage(source)
    const size = videoCharacterElementSize(element)
    drawTransformed(context, image, { ...element, ...size }, element.kind === 'character' && element.flipX === true, element.kind === 'image')
    return
  }
  if (element.kind === 'speech' || element.kind === 'thought' || element.kind === 'narrator') {
    const speakerId = element.speakerCharacterId
    const speakerLayer = speakerId
      ? frame.layers.find((candidate): candidate is Extract<VideoSceneLayer, { type: 'element' }> => candidate.type === 'element' && candidate.element.id === speakerId)
      : undefined
    drawTextLayer(context, element, speakerLayer?.element)
  }
}

/** Deterministic 1920×1080 compositor shared by export surface and future preview/print migration. */
export async function renderVideoSceneFrameToCanvas(
  frame: VideoSceneFrame,
  canvas: HTMLCanvasElement,
  resources: VideoCanvasFrameResources = {},
): Promise<CanvasRenderingContext2D> {
  if (canvas.width !== VIDEO_STAGE_WIDTH) canvas.width = VIDEO_STAGE_WIDTH
  if (canvas.height !== VIDEO_STAGE_HEIGHT) canvas.height = VIDEO_STAGE_HEIGHT
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D indisponível para o compositor do Video Studio.')
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.fillStyle = frame.background.color
  context.fillRect(0, 0, VIDEO_STAGE_WIDTH, VIDEO_STAGE_HEIGHT)
  if (frame.background.assetDataUrl) {
    const image = await loadImage(frame.background.assetDataUrl)
    drawTransformed(context, image, {
      x: frame.background.x, y: frame.background.y, width: frame.background.width,
      height: frame.background.height, rotation: frame.background.rotation,
    })
  }
  for (const layer of frame.layers) {
    if (layer.type === 'element') {
      await drawElementLayer(context, layer, frame, resources)
      continue
    }
    const videoFrame = resources.videoFrames?.get(layer.clipId)
    if (!videoFrame) continue
    const rect = videoClipStageRect(layer.transform)
    const transform = layer.transform ?? { x: 0, y: 0, width: 50, height: 50, rotation: 0 }
    drawTransformed(context, videoFrame, transform, false, true)
    void rect // validates canonical transform even when source is object-fit contained.
  }
  context.restore()
  return context
}

export function clearVideoCanvasImageCache(): void {
  for (const promise of imageCache.values()) void promise.then((image) => { image.src = '' }).catch(() => undefined)
  imageCache.clear()
}
