import type { FabricatorProject, ModelPart } from '../../../../../shared/fabricator'
import sourceUrl from './wardrobe-reference-v2.png?inline'

export const wardrobeV2SourceUrl = sourceUrl

type Frame = { x: number; y: number; width: number; height: number }

/** The fourteen visible pieces are grouped into the ten bones of the saved rig. */
const frames: Frame[] = [
  { x: 399, y: 29, width: 319, height: 294 },
  { x: 238, y: 306, width: 119, height: 194 },
  { x: 765, y: 306, width: 119, height: 194 },
  { x: 463, y: 338, width: 217, height: 332 },
  { x: 130, y: 504, width: 148, height: 290 },
  { x: 845, y: 504, width: 147, height: 290 },
  { x: 382, y: 672, width: 160, height: 275 },
  { x: 601, y: 676, width: 169, height: 272 },
  { x: 346, y: 960, width: 156, height: 431 },
  { x: 646, y: 960, width: 198, height: 431 }
]

export function supportsWardrobeV2(model: FabricatorProject): boolean {
  if (model.width !== 1122 || model.height !== 1402 || model.parts.length !== frames.length) return false
  // Checking only the first four bones allowed the other six parts to be
  // reordered while still looking "compatible". splitWardrobeV2Reference
  // indexes all TEN frames and would silently assign wrong images to IDs.
  // Validate the entire ordered source sheet; do not try to guess identity.
  return frames.every((frame, index) => {
    const part = model.parts[index]
    const origin = part?.sourceTransform
    return Boolean(origin
      && Number.isFinite(origin.x) && Number.isFinite(origin.y)
      && Math.abs(origin.x - frame.x) < 35 && Math.abs(origin.y - frame.y) < 35)
  })
}

export async function splitWardrobeV2Reference(cleanDataUrl: string, model: FabricatorProject): Promise<Record<string, Frame & { imageDataUrl: string }>> {
  if (!supportsWardrobeV2(model)) throw new Error('O modelo não corresponde à folha de referência de Roupas Dev 2.0.')
  const bitmap = await createImageBitmap(await (await fetch(cleanDataUrl)).blob())
  try {
    if (bitmap.width !== model.width || bitmap.height !== model.height) throw new Error('A folha de referência 2.0 tem dimensões inesperadas.')
    return Object.fromEntries(model.parts.map((part: ModelPart, index) => {
      const frame = frames[index]
      const canvas = document.createElement('canvas')
      canvas.width = frame.width; canvas.height = frame.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Não foi possível preparar a referência de Roupas Dev 2.0.')
      context.drawImage(bitmap, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
      return [part.id, { ...frame, imageDataUrl: canvas.toDataURL('image/png') }]
    }))
  } finally { bitmap.close() }
}
