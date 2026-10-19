import type { StudioElement, VideoClipTransform } from './studio'
import { defaultVideoTransform } from './videoMedia'

export const VIDEO_STAGE_WIDTH = 1920 as const
export const VIDEO_STAGE_HEIGHT = 1080 as const

export type VideoStageRect = Readonly<{
  centerX: number
  centerY: number
  width: number
  height: number
  left: number
  top: number
  right: number
  bottom: number
}>

export function videoStageRect(x: number, y: number, width: number, height: number): VideoStageRect {
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) throw new Error('Geometria de palco inválida.')
  const pixelWidth = width / 100 * VIDEO_STAGE_WIDTH
  const pixelHeight = height / 100 * VIDEO_STAGE_HEIGHT
  const centerX = (50 + x) / 100 * VIDEO_STAGE_WIDTH
  const centerY = (50 + y) / 100 * VIDEO_STAGE_HEIGHT
  return {
    centerX, centerY, width: pixelWidth, height: pixelHeight,
    left: centerX - pixelWidth / 2,
    top: centerY - pixelHeight / 2,
    right: centerX + pixelWidth / 2,
    bottom: centerY + pixelHeight / 2,
  }
}

export function videoCharacterElementSize(element: StudioElement): { width: number; height: number } {
  if (element.kind !== 'character') return { width: element.width, height: element.height }
  const scale = (element.characterScale ?? 100) / 100
  return {
    width: element.width * scale * (element.characterWidthScale ?? 100) / 100,
    height: element.height * scale * (element.characterHeightScale ?? 100) / 100,
  }
}

export function videoElementStageRect(element: StudioElement): VideoStageRect {
  const size = videoCharacterElementSize(element)
  return videoStageRect(element.x, element.y, size.width, size.height)
}

export function videoClipStageRect(transform: VideoClipTransform | undefined): VideoStageRect {
  const value = transform ?? defaultVideoTransform
  return videoStageRect(value.x, value.y, value.width, value.height)
}

export function videoStageCssTransform(
  x: number, y: number, width: number, height: number, rotation: number, flipX = false,
): Readonly<Record<'left' | 'top' | 'width' | 'height' | 'transform', string>> {
  if (![rotation].every(Number.isFinite)) throw new Error('Rotação de palco inválida.')
  return {
    left: `calc(50% + ${x}%)`,
    top: `calc(50% + ${y}%)`,
    width: `${width}%`,
    height: `${height}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1})`,
  }
}
