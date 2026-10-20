import type { StudioElement, VideoCharacterState } from '../../../../shared/studio'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { VideoSceneFrame, VideoSceneLayer } from '../../../../shared/videoSceneIR'
import { videoCharacterElementSize, videoClipStageRect, videoStageRect, VIDEO_STAGE_HEIGHT, VIDEO_STAGE_WIDTH } from '../../../../shared/videoStageGeometry'
import { matchingVideoVisualPlugin } from './videoVisualPluginRegistry'
import type { VideoCanvasLayerCache } from './videoCanvasLayerCache'

export type VideoCanvasFrameResources = Readonly<{
  /** Transition/blink/mouth renderer output keyed by Studio character element id. */
  characterStates?: ReadonlyMap<string, VideoCharacterState>
  /** Exact source video frame keyed by clip id. */
  videoFrames?: ReadonlyMap<string, CanvasImageSource>
  layerCache?: VideoCanvasLayerCache
  /** Export reads every frame back to RGBA; ask Chromium for a CPU-readback friendly backing store. */
  willReadFrequently?: boolean
}>

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const MAX_IMAGE_CACHE = 256
const sourceTokens=new Map<string,number>()
let nextSourceToken=0
function sourceToken(source:string|undefined):number{
  if(!source)return 0
  let token=sourceTokens.get(source)
  if(!token){token=++nextSourceToken;sourceTokens.set(source,token);if(sourceTokens.size>512)sourceTokens.delete(sourceTokens.keys().next().value!)}
  return token
}

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
  context.fillStyle = element.kind === 'thought' ? '#fffafd' : '#fffffff0'
  context.strokeStyle = '#624d5b'
  context.lineWidth = 1

  const balloonRadius = element.kind === 'speech' ? .45 : element.kind === 'thought' ? .48 : null
  context.beginPath()
  context.roundRect(
    -rect.width / 2 + .5,
    -rect.height / 2 + .5,
    Math.max(0, rect.width - 1),
    Math.max(0, rect.height - 1),
    balloonRadius === null ? 9 : { x: rect.width * balloonRadius, y: rect.height * balloonRadius },
  )
  context.fill()
  context.stroke()

  const horizontalPadding = 9
  const innerTop = -rect.height / 2 + 6
  const innerBottom = rect.height / 2 - 6
  const speakerFontSize = 18 * .68
  const speakerHeight = speakerName ? speakerFontSize * 1.1 + 4 : 0
  const contentTop = innerTop + speakerHeight + (speakerName ? 2 : 0)
  const contentHeight = Math.max(1, innerBottom - contentTop)
  const maxWidth = Math.max(1, rect.width - horizontalPadding * 2)
  const lineHeight = 18 * 1.2
  const maxLines = Math.max(1, Math.min(8, Math.floor(contentHeight / lineHeight)))
  if (speakerName) {
    context.fillStyle = speakerColor
    context.font = '850 12.24px Aptos, "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(speakerName, 0, innerTop + speakerFontSize * .55, maxWidth)
    context.strokeStyle = speakerColor
    context.globalAlpha = .55
    context.beginPath()
    context.moveTo(-rect.width / 2 + horizontalPadding, innerTop + speakerHeight - 1)
    context.lineTo(rect.width / 2 - horizontalPadding, innerTop + speakerHeight - 1)
    context.stroke()
    context.globalAlpha = 1
  }

  context.fillStyle = '#352d35'
  context.font = '400 18px Aptos, "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const lines = wrappedLines(context, element.text, maxWidth, maxLines)
  const textCenterY = (contentTop + innerBottom) / 2
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
  const characterState = resources.characterStates?.get(element.id)
  const pluginContext = { frame, layer, element, imageDataUrl: source, characterState }
  const plugin = matchingVideoVisualPlugin(pluginContext)
  if (plugin?.renderCanvas && await plugin.renderCanvas(pluginContext, context)) return
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
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: resources.willReadFrequently === true })
  if (!context) throw new Error('Canvas 2D indisponível para o compositor do Video Studio.')
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  const layerCache=resources.layerCache
  const backgroundKey=JSON.stringify(['background',frame.background.color,sourceToken(frame.background.assetDataUrl),frame.background.x,frame.background.y,frame.background.width,frame.background.height,frame.background.rotation])
  const drawBackground=async(target:CanvasRenderingContext2D)=>{
    target.fillStyle=frame.background.color
    target.fillRect(0,0,VIDEO_STAGE_WIDTH,VIDEO_STAGE_HEIGHT)
    if(frame.background.assetDataUrl){
      const image=await loadImage(frame.background.assetDataUrl)
      drawTransformed(target,image,{x:frame.background.x,y:frame.background.y,width:frame.background.width,height:frame.background.height,rotation:frame.background.rotation})
    }
  }
  if(layerCache){
    const background=await layerCache.create(backgroundKey,VIDEO_STAGE_WIDTH,VIDEO_STAGE_HEIGHT,drawBackground)
    context.drawImage(background,0,0)
  }else await drawBackground(context)

  for (const layer of frame.layers) {
    if (layer.type === 'element') {
      const override=resources.characterStates?.get(layer.element.id)
      const effective=override?.element??layer.element
      // Character output is intentionally excluded from the full-stage raster
      // cache. Blink/mouth/transition state can change its source every frame;
      // caching those states caused thousands of 1920x1080 misses/evictions
      // and >10s of extra compose work in the static-heavy CI profile. Repeated
      // character states are already handled by the semantic frame cache.
      if(layerCache && effective.kind !== 'character'){
        const source=override?.imageDataUrl??layer.assetDataUrl
        const speaker=effective.speakerCharacterId
          ? frame.layers.find((candidate)=>candidate.type==='element'&&candidate.element.id===effective.speakerCharacterId)
          : undefined
        const key=JSON.stringify(['element',effective,sourceToken(source),speaker?.type==='element'?speaker.element:null,layer.clipId??'',layer.zOrder])
        const raster=await layerCache.create(key,VIDEO_STAGE_WIDTH,VIDEO_STAGE_HEIGHT,(target)=>drawElementLayer(target,layer,frame,resources))
        context.drawImage(raster,0,0)
      }else await drawElementLayer(context, layer, frame, resources)
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
  sourceTokens.clear()
  nextSourceToken=0
}
