import { useEffect, useMemo, useRef, useState } from 'react'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { Icon, type IconName } from '../../ui/components/Icon'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceElementKind, FaceSet, FaceSheetKind, FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, HairStyle, HairStyleSummary, WardrobeCategory, WardrobeSet, WardrobeSetSummary } from '../../../../shared/fabricator'
import { resolvePoseCategory } from '../../../../shared/fabricator'
import type { CustomizerCharacter, CustomizerFaceAppearance, CustomizerWardrobeCategory, CustomizerWardrobeGroup } from '../../../../shared/customizer'
import { characterBodyDimensionLimits, characterProportionLimits, defaultCharacterBodyDimensions, defaultCharacterProportions, getCharacterBodyDimensions, getCharacterProportions, type CharacterBodyDimensions, type CharacterProportions } from '../../../../shared/customizer'
import type { StudioFaceTransforms } from '../../../../shared/studio'
import { usePreviewBackground } from '../fabricator/usePreviewBackground'
import { DesignBanner } from '../fabricator/DesignWorkspace'
import { mapWardrobeComponentToPose } from '../fabricator/wardrobe/poseTransform'
import { applyCharacterBodyShape } from './bodyShape'
import { tintSkinPixels } from './skinTint'

type CatalogArtwork = Pick<FabricatorProject, 'width' | 'height' | 'parts' | 'layerOrder' | 'hiddenPartIds'> & Partial<Pick<FabricatorProject, 'joints'>>
function withCharacterHeadSize(artwork: CatalogArtwork, proportions: CharacterProportions): CatalogArtwork {
  const scaleX = proportions.head * proportions.headWidth / 10000
  const scaleY = proportions.head * proportions.headHeight / 10000
  if (scaleX === 1 && scaleY === 1) return artwork
  const head = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!head) return artwork
  return {
    ...artwork,
    parts: artwork.parts.map((part) => part.id === head.id ? {
      ...part,
      x: part.x - (part.width * scaleX - part.width) / 2,
      y: part.y - (part.height * scaleY - part.height),
      width: part.width * scaleX,
      height: part.height * scaleY
    } : part)
  }
}

function characterShapeScale(proportions: CharacterProportions): { x: number; y: number } {
  return { x: proportions.scale * proportions.width / 10000, y: proportions.scale * proportions.height / 10000 }
}
const wardrobeImageCache = new Map<string, Promise<HTMLImageElement>>()
const skinTintImageCache = new Map<string, Promise<HTMLImageElement>>()
const hairTintImageCache = new Map<string, Promise<HTMLImageElement>>()
type HairColorRole = 'base' | 'fade' | 'outline' | 'highlight' | 'accent'
type HairColorOverrides = Partial<Record<HairColorRole, string>>
const hairColorControls: Array<{ id: HairColorRole; label: string; fallback: string }> = [
  { id: 'base', label: 'Cor base', fallback: '#9b563e' },
  { id: 'fade', label: 'Degradê', fallback: '#633b37' },
  { id: 'outline', label: 'Contorno', fallback: '#392b33' },
  { id: 'highlight', label: 'Luzes', fallback: '#e5ad83' },
  { id: 'accent', label: 'Acessório', fallback: '#cf6391' }
]
const faceElementOrder: FaceElementKind[] = ['brow-left', 'brow-right', 'eye-left', 'eye-right', 'nose', 'mouth']
const skinTonePresets = [
  { id: '#f5ddcb', name: 'Porcelana' },
  { id: '#edc5a5', name: 'Clara' },
  { id: '#dba47d', name: 'Pêssego' },
  { id: '#c88961', name: 'Dourada' },
  { id: '#a96d4c', name: 'Média' },
  { id: '#754a36', name: 'Escura' },
  { id: '#493027', name: 'Retinta' }
] as const
const customizerSkinTonePresets = [skinTonePresets[0], skinTonePresets[1], skinTonePresets[2], skinTonePresets[4], skinTonePresets[6]]
const proportionControls: Array<{ key: keyof CharacterProportions; label: string; description: string }> = [
  { key: 'scale', label: 'Escala geral', description: 'Aumenta ou diminui o personagem inteiro' },
  { key: 'head', label: 'Tamanho da cabeça', description: 'Altera apenas a cabeça, rosto e cabelo' },
  { key: 'headWidth', label: 'Largura da cabeça', description: 'Alarga ou estreita apenas a cabeça, rosto e cabelo' },
  { key: 'headHeight', label: 'Altura da cabeça', description: 'Alonga ou achata apenas a cabeça, rosto e cabelo' },
  { key: 'width', label: 'Largura', description: 'Estica ou comprime o personagem na horizontal' },
  { key: 'height', label: 'Altura', description: 'Estica ou comprime o personagem na vertical' }
]
function loadCachedImage(source: string): Promise<HTMLImageElement> {
  const cached = wardrobeImageCache.get(source)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem da roupa.'))
    image.src = source
  })
  wardrobeImageCache.set(source, promise)
  void promise.catch(() => wardrobeImageCache.delete(source))
  return promise
}

function hairPixelColorRole(red: number, green: number, blue: number): HairColorRole {
  const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum
  if (saturation > 0.38 && luminance > 0.13 && luminance < 0.9) return 'accent'
  if (luminance < 0.22) return 'outline'
  if (luminance < 0.43) return 'fade'
  if (luminance < 0.76) return 'base'
  return 'highlight'
}

function loadHairTintedImage(source: string, overrides: HairColorOverrides | undefined): Promise<HTMLImageElement> {
  if (!overrides || !Object.values(overrides).some(Boolean)) return loadCachedImage(source)
  const key = `${source}:${JSON.stringify(overrides)}`
  const cached = hairTintImageCache.get(key)
  if (cached) return cached
  const tinted = loadCachedImage(source).then((sourceImage) => {
    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.naturalWidth || sourceImage.width
    canvas.height = sourceImage.naturalHeight || sourceImage.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context || !canvas.width || !canvas.height) return sourceImage
    context.drawImage(sourceImage, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const parsed = new Map<HairColorRole, [number, number, number]>()
    for (const [role, value] of Object.entries(overrides) as Array<[HairColorRole, string]>) {
      if (!/^#[\da-f]{6}$/i.test(value)) continue
      parsed.set(role, [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)])
    }
    if (parsed.size === 0) return sourceImage
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue
      const role = hairPixelColorRole(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      const target = parsed.get(role)
      if (!target) continue
      const sourceLuminance = Math.max(1, pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722)
      const targetLuminance = Math.max(1, target[0] * 0.2126 + target[1] * 0.7152 + target[2] * 0.0722)
      const shade = sourceLuminance / targetLuminance
      pixels[offset] = Math.min(255, target[0] * shade)
      pixels[offset + 1] = Math.min(255, target[1] * shade)
      pixels[offset + 2] = Math.min(255, target[2] * shade)
    }
    context.putImageData(imageData, 0, 0)
    const output = new Image()
    output.src = canvas.toDataURL('image/png')
    if (output.decode) return output.decode().then(() => output)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      output.onload = () => resolve(output)
      output.onerror = () => reject(new Error('Não foi possível recolorir o cabelo.'))
    })
  })
  hairTintImageCache.set(key, tinted)
  void tinted.catch(() => hairTintImageCache.delete(key))
  return tinted
}

function loadSkinTintedImage(source: string, tone: string): Promise<HTMLImageElement> {
  const key = `${tone}:${source}`
  const cached = skinTintImageCache.get(key)
  if (cached) return cached
  const tinted = loadCachedImage(source).then((sourceImage) => {
    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.naturalWidth || sourceImage.width
    canvas.height = sourceImage.naturalHeight || sourceImage.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context || !canvas.width || !canvas.height) return sourceImage
    context.drawImage(sourceImage, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    tintSkinPixels(pixels, tone)
    context.putImageData(pixels, 0, 0)
    const output = new Image()
    output.src = canvas.toDataURL('image/png')
    if (output.decode) return output.decode().then(() => output)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      output.onload = () => resolve(output)
      output.onerror = () => reject(new Error('Não foi possível aplicar a cor de pele.'))
    })
  })
  skinTintImageCache.set(key, tinted)
  void tinted.catch(() => skinTintImageCache.delete(key))
  return tinted
}

type ClothingGroupCategory = CustomizerWardrobeCategory
type WardrobeEditHistory = { characterId: string; undo: CustomizerWardrobeGroup[][]; redo: CustomizerWardrobeGroup[][] }
type SelectedWardrobeComponent = { setId: string; category: ClothingGroupCategory; componentId: string }
type HairCatalogSide = 'front' | 'back'
type HairPartId = 'backHair' | 'rearHair' | 'ponytail' | 'frontHair' | 'ahoge'
type HairLayerReference = { style: HairStyle; side: HairCatalogSide }
const customizerHairParts: Array<{ id: HairPartId; label: string; side: HairCatalogSide }> = [
  { id: 'backHair', label: 'Cabelo de trás', side: 'back' },
  { id: 'rearHair', label: 'Cabelo posterior', side: 'back' },
  { id: 'ponytail', label: 'Rabo de cavalo', side: 'back' },
  { id: 'frontHair', label: 'Cabelo frontal', side: 'front' },
  { id: 'ahoge', label: 'Ahoge', side: 'front' }
]
const hairAppearanceStyleId = (appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, side: HairCatalogSide): string | null => {
  if (!appearance) return null
  const key = side === 'front' ? 'frontStyleId' : 'backStyleId'
  return key in appearance ? appearance[key] ?? null : appearance.styleId ?? null
}
function hairAppearanceStyleIds(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, side: HairCatalogSide): string[] {
  return customizerHairParts.filter((part) => part.side === side).flatMap((part) => {
    const hasPartOverride = Boolean(appearance?.parts && Object.prototype.hasOwnProperty.call(appearance.parts, part.id))
    const id = hasPartOverride ? appearance?.parts?.[part.id] ?? null : part.id === 'backHair' ? hairAppearanceStyleId(appearance, 'back') : part.id === 'frontHair' ? hairAppearanceStyleId(appearance, 'front') : null
    return id ? [id] : []
  })
}
function hairAppearancePartStyleId(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, part: HairPartId): string | null {
  if (appearance?.parts && Object.prototype.hasOwnProperty.call(appearance.parts, part)) return appearance.parts[part] ?? null
  if (part === 'backHair') return hairAppearanceStyleId(appearance, 'back')
  if (part === 'frontHair') return hairAppearanceStyleId(appearance, 'front')
  return null
}
async function loadHairAppearanceLayers(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, modelSlot: number, side: HairCatalogSide, cached: Record<string, HairStyle> = {}): Promise<HairLayerReference[]> {
  if (!appearance || appearance.modelSlot !== modelSlot) return []
  const ids = hairAppearanceStyleIds(appearance, side)
  const styles = await Promise.all(ids.map(async (id) => cached[`${modelSlot}:${id}`] ?? await window.desktop.loadHairStyle(modelSlot, id)))
  return styles.filter((style): style is HairStyle => Boolean(style)).map((style) => ({ style, side }))
}
const clothingCategories: Record<'Superior' | 'Inferior', Array<{ id: ClothingGroupCategory; label: string; source: WardrobeCategory[] }>> = {
  Superior: [
    { id: 'camisa', label: 'Camisas', source: ['camisa'] },
    { id: 'manga-superior', label: 'Mangas superiores', source: ['manga-superior'] },
    { id: 'manga-inferior', label: 'Mangas inferiores', source: ['manga-inferior'] }
  ],
  Inferior: [
    { id: 'calca', label: 'Calças', source: ['calca-coxa', 'calca-canela'] },
    { id: 'shorts', label: 'Shorts', source: ['shorts'] }
  ]
}

async function renderWardrobeThumbnail(set: WardrobeSet, categories: WardrobeCategory[]): Promise<string | null> {
  const pieces = set.components.filter((component) => categories.includes(component.category))
  if (!pieces.length) return null
  const left = Math.min(...pieces.map((piece) => piece.x))
  const top = Math.min(...pieces.map((piece) => piece.y))
  const right = Math.max(...pieces.map((piece) => piece.x + piece.width))
  const bottom = Math.max(...pieces.map((piece) => piece.y + piece.height))
  const scale = Math.min(112 / Math.max(1, right - left), 112 / Math.max(1, bottom - top))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((right - left) * scale))
  canvas.height = Math.max(1, Math.ceil((bottom - top) * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const piece of pieces) {
    try {
      const image = await loadCachedImage(piece.dataUrl)
      context.save()
      context.translate((piece.x - left + piece.width / 2) * scale, (piece.y - top + piece.height / 2) * scale)
      context.rotate(piece.rotation * Math.PI / 180)
      context.drawImage(image, -piece.width * scale / 2, -piece.height * scale / 2, piece.width * scale, piece.height * scale)
      context.restore()
    } catch { continue }
  }
  return canvas.toDataURL('image/png')
}

async function renderWardrobeOverlay(
  groups: CustomizerWardrobeGroup[],
  details: Record<string, WardrobeSet>,
  artwork: CatalogArtwork,
  modelSlot: number | null,
  source: FabricatorProject | null,
  selected: SelectedWardrobeComponent | null,
  skinTone?: string
): Promise<{ imageUrl: string | null; selectedUrl: string | null }> {
  if (!groups.length || modelSlot === null || !source) return { imageUrl: null, selectedUrl: null }
  const output = document.createElement('canvas')
  output.width = Math.max(1, artwork.width)
  output.height = Math.max(1, artwork.height)
  const outputContext = output.getContext('2d')
  if (!outputContext) return { imageUrl: null, selectedUrl: null }
  const selectionCanvas = document.createElement('canvas')
  selectionCanvas.width = output.width
  selectionCanvas.height = output.height
  const selectionContext = selectionCanvas.getContext('2d')
  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const bodyOrder = (artwork.layerOrder ?? []).filter((id, index, order) => artwork.parts.some((part) => part.id === id) && order.indexOf(id) === index)
  for (const part of artwork.parts) if (!bodyOrder.includes(part.id)) bodyOrder.push(part.id)
  const garmentLayers = new Map<string, Array<{ group: CustomizerWardrobeGroup; component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }>>()
  let sequence = 0

  // Match the wardrobe pose test: each garment is inserted immediately above
  // the model layer it is attached to, before the next body layer is drawn.
  for (const group of groups) {
    const set = details[`${group.modelSlot}:${group.setId}`]
    if (!set || group.modelSlot !== modelSlot) continue
    const accepted = clothingCategories[group.category === 'calca' || group.category === 'shorts' ? 'Inferior' : 'Superior']
      .find((category) => category.id === group.category)?.source
    if (!accepted) continue
    const components = set.components.filter((component) => accepted.includes(component.category) && (!group.componentId || group.componentId === component.id))
    if (!components.length) continue
    const mapped: Array<{ component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }> = []
    for (const component of components) {
      const sourceBone = source.parts.find((part) => part.id === component.attachedPartId)
      const targetBone = artwork.parts.find((part) => part.id === component.attachedPartId)
      if (!sourceBone || !targetBone) continue
      const hasThighAndCalf = components.some((piece) => piece.category === 'calca-coxa') && components.some((piece) => piece.category === 'calca-canela')
      const kneeOverlap = hasThighAndCalf && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
      const sleeveEdgePadding = component.category === 'manga-superior' || component.category === 'manga-inferior'
        ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06)))
        : 0
      const transform = mapWardrobeComponentToPose(component, sourceBone, targetBone, kneeOverlap, sleeveEdgePadding)
      mapped.push({ component, transform, center: transform.origin, sequence: sequence++ })
    }
    if (!mapped.length) continue
    const center = mapped.reduce((sum, item) => ({ x: sum.x + item.center.x / mapped.length, y: sum.y + item.center.y / mapped.length }), { x: 0, y: 0 })
    for (const item of mapped) {
      const layer = garmentLayers.get(item.component.attachedPartId) ?? []
      layer.push({ group, ...item, center })
      garmentLayers.set(item.component.attachedPartId, layer)
    }
  }

  for (const partId of bodyOrder) {
    const part = artwork.parts.find((item) => item.id === partId)
    if (!part) continue
    if (!hidden.has(part.id)) {
      try {
        // The wardrobe composite redraws the body to interleave garments with
        // model layers. Keep that duplicate body in sync with the tinted base
        // preview, otherwise the original skin pixels cover the selected tone.
        const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
        outputContext.save()
        outputContext.translate(part.x + part.width / 2, part.y + part.height / 2)
        outputContext.rotate(part.rotation * Math.PI / 180)
        outputContext.drawImage(image, -part.width / 2, -part.height / 2, part.width, part.height)
        outputContext.restore()
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
    const garments = (garmentLayers.get(part.id) ?? []).sort((a, b) => a.sequence - b.sequence)
    for (const garment of garments) {
      try {
        const image = await loadCachedImage(garment.component.dataUrl)
        const matrix = /^matrix\(([^)]+)\)$/.exec(garment.transform.matrix)?.[1].split(',').map(Number) ?? [1, 0, 0, 1, 0, 0]
        const drawGarment = (context: CanvasRenderingContext2D) => {
          context.save()
          context.translate(garment.center.x + garment.group.offsetX, garment.center.y + garment.group.offsetY)
          context.rotate(garment.group.rotation * Math.PI / 180)
          context.scale(garment.group.scaleX, garment.group.scaleY)
          context.translate(-garment.center.x, -garment.center.y)
          context.translate(garment.transform.origin.x, garment.transform.origin.y)
          context.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
          context.translate(garment.transform.localLeft + garment.transform.renderWidth / 2, garment.transform.localTop + garment.transform.renderHeight / 2)
          context.rotate(garment.transform.localRotation * Math.PI / 180)
          context.drawImage(image, -garment.transform.renderWidth / 2, -garment.transform.renderHeight / 2, garment.transform.renderWidth, garment.transform.renderHeight)
          context.restore()
        }
        drawGarment(outputContext)
        if (selectionContext && selected && garment.group.setId === selected.setId && garment.group.category === selected.category && garment.component.id === selected.componentId) drawGarment(selectionContext)
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
  }
  return { imageUrl: output.toDataURL('image/png'), selectedUrl: selectionContext && selected ? selectionCanvas.toDataURL('image/png') : null }
}

export async function renderArtwork(artwork: CatalogArtwork, maxSize: number, skinTone?: string, trimTransparent = false): Promise<string | null> {
  if (artwork.width <= 0 || artwork.height <= 0) return null
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale))
  canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null

  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const layerIndex = new Map((artwork.layerOrder ?? []).map((id, index) => [id, index]))
  const parts = artwork.parts
    .filter((part) => !hidden.has(part.id))
    .map((part, index) => ({ part, index }))
    .sort((a, b) => (layerIndex.get(a.part.id) ?? a.index) - (layerIndex.get(b.part.id) ?? b.index))

  for (const { part } of parts) {
    try {
      const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
      context.save()
      try {
        context.translate((part.x + part.width / 2) * scale, (part.y + part.height / 2) * scale)
        context.rotate(part.rotation * Math.PI / 180)
        context.drawImage(image, -part.width * scale / 2, -part.height * scale / 2, part.width * scale, part.height * scale)
      } finally {
        context.restore()
      }
    } catch {
      continue
    }
  }

  if (!trimTransparent) return canvas.toDataURL('image/png')

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width
  let top = canvas.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return canvas.toDataURL('image/png')
  const margin = 0
  const trimmed = document.createElement('canvas')
  trimmed.width = right - left + 1 + margin * 2
  trimmed.height = bottom - top + 1 + margin * 2
  trimmed.getContext('2d')?.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, margin, margin, right - left + 1, bottom - top + 1)
  return trimmed.toDataURL('image/png')
}

async function renderArtworkWithHair(artwork: CatalogArtwork, source: FabricatorProject, backStyles: HairStyle | HairLayerReference[] | null, maxSize: number, skinTone?: string, hairColors?: HairColorOverrides): Promise<string | null> {
  const hairLayers: HairLayerReference[] = Array.isArray(backStyles) ? backStyles : backStyles ? [{ style: backStyles, side: 'back' }] : []
  const validHairLayers = hairLayers.filter((layer) => layer.style.modelSlot === source.slot && Boolean(layer.style[layer.side]))
  if (!validHairLayers.length) return renderArtwork(artwork, maxSize, skinTone)
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || !sourceHead.width || !sourceHead.height) return renderArtwork(artwork, maxSize, skinTone)
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale)); canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const order = (artwork.layerOrder ?? []).filter((id, index, ids) => ids.indexOf(id) === index && artwork.parts.some((part) => part.id === id))
  for (const part of artwork.parts) if (!order.includes(part.id)) order.push(part.id)
  const drawBackHair = async (layer: HairLayerReference) => {
    const { style, side } = layer
    const asset = style[side]
    if (!asset) return
    try {
      const transform = style.transforms[side]
      const localX = transform.x / sourceHead.width * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height
      const radians = targetHead.rotation * Math.PI / 180
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
      const width = asset.width * transform.scaleX / sourceHead.width * targetHead.width
      const height = asset.height * transform.scaleY / sourceHead.height * targetHead.height
      const image = await loadHairTintedImage(asset.dataUrl, hairColors)
      context.save()
      context.translate(x * scale, y * scale)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.scale(transform.flipX ? -1 : 1, 1)
      context.drawImage(image, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
      context.restore()
    } catch { /* One missing hair layer must not hide the model preview. */ }
  }
  for (const id of order) {
    const part = artwork.parts.find((item) => item.id === id)
    if (!part) continue
    const isHead = part.id === targetHead.id
    if (isHead) for (const layer of validHairLayers) await drawBackHair(layer)
    if (!hidden.has(part.id)) {
      try {
        const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
        context.save()
        context.translate((part.x + part.width / 2) * scale, (part.y + part.height / 2) * scale)
        context.rotate(part.rotation * Math.PI / 180)
        context.drawImage(image, -part.width * scale / 2, -part.height * scale / 2, part.width * scale, part.height * scale)
        context.restore()
      } catch { /* Continue rendering the remaining model layers. */ }
    }
  }
  return canvas.toDataURL('image/png')
}

async function renderFrontHairOverlay(artwork: CatalogArtwork, source: FabricatorProject, frontStyles: HairStyle | HairLayerReference[] | null, maxSize: number, hairColors?: HairColorOverrides): Promise<string | null> {
  const hairLayers: HairLayerReference[] = Array.isArray(frontStyles) ? frontStyles : frontStyles ? [{ style: frontStyles, side: 'front' }] : []
  const validHairLayers = hairLayers.filter((layer) => layer.side === 'front' && layer.style.front && layer.style.modelSlot === source.slot)
  if (!validHairLayers.length) return null
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return null
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale))
  canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const layer of validHairLayers) {
    const asset = layer.style.front
    if (!asset) continue
    const transform = layer.style.transforms.front
    const localX = transform.x / sourceHead.width * targetHead.width
    const localY = transform.y / sourceHead.height * targetHead.height
    const radians = targetHead.rotation * Math.PI / 180
    const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
    const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
    const width = asset.width * transform.scaleX / sourceHead.width * targetHead.width
    const height = asset.height * transform.scaleY / sourceHead.height * targetHead.height
    try {
      const image = await loadHairTintedImage(asset.dataUrl, hairColors)
      context.save()
      context.translate(x * scale, y * scale)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.scale(transform.flipX ? -1 : 1, 1)
      context.drawImage(image, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
      context.restore()
    } catch { /* Continue drawing the remaining front hair layers. */ }
  }
  return canvas.toDataURL('image/png')
}

async function renderFaceOverlay(artwork: CatalogArtwork, source: FabricatorProject | null, face: FaceSet | null, appearance: CustomizerFaceAppearance | undefined): Promise<string | null> {
  if (!source || !face || !appearance || appearance.setId !== face.id || appearance.modelSlot !== source.slot) return null
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const element of faceElementOrder) {
    if (element.startsWith('brow') && !appearance.eyebrows) continue
    const sheet = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
    const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
    const piece = face.pieces.find((item) => item.sheet === sheet && item.index === index && item.side === side)
    if (!piece) continue
    const transform = face.transforms[element]
    try {
      const image = await loadCachedImage(piece.dataUrl)
      const localX = transform.x / sourceHead.width * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(targetHead.rotation * Math.PI / 180) - (localY - targetHead.height / 2) * Math.sin(targetHead.rotation * Math.PI / 180)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(targetHead.rotation * Math.PI / 180) + (localY - targetHead.height / 2) * Math.cos(targetHead.rotation * Math.PI / 180)
      const width = piece.width * transform.scaleX / sourceHead.width * targetHead.width
      const height = piece.height * transform.scaleY / sourceHead.height * targetHead.height
      context.save()
      context.translate(x, y)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.drawImage(image, -width / 2, -height / 2, width, height)
      context.restore()
    } catch { /* Skip a missing facial asset without hiding the character preview. */ }
  }
  return canvas.toDataURL('image/png')
}

async function drawFaceCatalogOverlay(context: CanvasRenderingContext2D, artwork: CatalogArtwork, source: FabricatorProject, items: Partial<Record<FaceSheetKind, FaceCatalogItem>>, appearance: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms): Promise<void> {
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return
  const categoryIds: Partial<Record<FaceSheetKind, string | undefined>> = {
    eyes: appearance.eyeCatalogId,
    eyebrows: appearance.eyebrowCatalogId,
    nose: appearance.noseCatalogId,
    'mouth-closed': appearance.mouthOpen ? undefined : appearance.mouthClosedCatalogId,
    'mouth-open': appearance.mouthOpen ? appearance.mouthOpenCatalogId : undefined
  }
  for (const element of faceElementOrder) {
    if (element.startsWith('brow') && !appearance.eyebrows) continue
    const sheet: FaceSheetKind = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const item = items[sheet]
    if (!item || item.id !== categoryIds[sheet]) continue
    const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
    const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
    const piece = item.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side)
    const transform = item.transforms[element]
    const studioCategory = sheet === 'eyes' ? 'eyes' : sheet === 'eyebrows' ? 'eyebrows' : sheet === 'nose' ? 'nose' : 'mouth'
    const studioTransform = studioFaceTransforms?.[`${sheet}:${item.id}`] ?? studioFaceTransforms?.[studioCategory]
    if (!piece || !transform) continue
    try {
      const image = await loadCachedImage(piece.dataUrl)
      const localX = transform.x / sourceHead.width * targetHead.width + (studioTransform?.x ?? 0) / 100 * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height + (studioTransform?.y ?? 0) / 100 * targetHead.height
      const radians = targetHead.rotation * Math.PI / 180
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
      const width = piece.width * transform.scaleX / sourceHead.width * targetHead.width * (studioTransform?.width ?? 100) / 100
      const height = piece.height * transform.scaleY / sourceHead.height * targetHead.height * (studioTransform?.height ?? 100) / 100
      context.save()
      context.translate(x, y)
      context.rotate((targetHead.rotation + transform.rotation + (studioTransform?.rotation ?? 0)) * Math.PI / 180)
      context.drawImage(image, -width / 2, -height / 2, width, height)
      context.restore()
    } catch { /* Keep the rest of the face visible if one catalog asset is missing. */ }
  }
}

async function renderFaceCatalogOverlay(artwork: CatalogArtwork, source: FabricatorProject, items: Partial<Record<FaceSheetKind, FaceCatalogItem>>, appearance: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms): Promise<string | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  await drawFaceCatalogOverlay(context, artwork, source, items, appearance, studioFaceTransforms)
  return canvas.toDataURL('image/png')
}

/** Render the selected Customizer character as one self-contained Studio actor image. */
export async function prepareSavedCharacterRenderer(character: CustomizerCharacter): Promise<{ width: number; height: number; render: (appearance?: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms) => Promise<{ dataUrl: string; width: number; height: number }> }> {
  const modelSlot = character.customization.modelSlot ?? 1
  const source = await window.desktop.loadFabricatorSlot(modelSlot)
  if (!source) throw new Error(`O modelo de ${character.name} não está disponível.`)
  const pose = character.customization.poseSlot === null ? null : await window.desktop.loadFabricatorPose(modelSlot, character.customization.poseSlot)
  const proportions = getCharacterProportions(character.customization)
  const artwork = applyCharacterBodyShape(withCharacterHeadSize(pose ?? source, proportions), getCharacterBodyDimensions(character.customization))
  const hairAppearance = character.customization.hairAppearance
  const [backStyles, frontStyles] = await Promise.all([
    loadHairAppearanceLayers(hairAppearance, modelSlot, 'back'),
    loadHairAppearanceLayers(hairAppearance, modelSlot, 'front')
  ])
  const baseUrl = await renderArtworkWithHair(artwork, source, backStyles, 960, character.customization.modelSkinTone, hairAppearance?.colors)
  if (!baseUrl) throw new Error(`Não foi possível montar a prévia de ${character.name}.`)

  const groups = (character.customization.wardrobeGroups ?? []).filter((group) => group.modelSlot === modelSlot)
  const details: Record<string, WardrobeSet> = {}
  await Promise.all(groups.map(async (group) => {
    const key = `${group.modelSlot}:${group.setId}`
    if (details[key]) return
    const set = await window.desktop.loadWardrobeSet(group.modelSlot, group.setId)
    if (set) details[key] = set
  }))
  const wardrobe = await renderWardrobeOverlay(groups, details, artwork, modelSlot, source, null, character.customization.modelSkinTone)

  const appearance = character.customization.faceAppearance
  let faceItems: Partial<Record<FaceSheetKind, FaceCatalogItem>> = {}
  const faceItemPromises = new Map<string, Promise<FaceCatalogItem | null>>()
  let legacyFaceUrl: string | null = null
  if (appearance?.modelSlot === modelSlot) {
    if (appearance.eyeCatalogId || appearance.eyebrowCatalogId || appearance.noseCatalogId || appearance.mouthClosedCatalogId || appearance.mouthOpenCatalogId) {
      const selections: Array<[FaceSheetKind, string | undefined]> = [
        ['eyes', appearance.eyeCatalogId], ['eyebrows', appearance.eyebrowCatalogId], ['nose', appearance.noseCatalogId],
        ['mouth-closed', appearance.mouthClosedCatalogId], ['mouth-open', appearance.mouthOpenCatalogId]
      ]
      const entries = await Promise.all(selections.filter((entry): entry is [FaceSheetKind, string] => Boolean(entry[1])).map(async ([category, id]) => [category, await window.desktop.loadFaceCatalogItem(modelSlot, id)] as const))
      for (const [category, item] of entries) if (item) faceItems[category] = item
    } else if (appearance.setId) {
      const face = await window.desktop.loadFaceSet(modelSlot, appearance.setId)
      if (face) legacyFaceUrl = await renderFaceOverlay(artwork, source, face, appearance)
    }
  }
  const frontHairUrl = frontStyles.length ? await renderFrontHairOverlay(artwork, source, frontStyles, 960, hairAppearance?.colors) : null
  const baseImage = await loadCachedImage(baseUrl)
  const wardrobeImage = wardrobe.imageUrl ? await loadCachedImage(wardrobe.imageUrl) : null
  const legacyFaceImage = legacyFaceUrl ? await loadCachedImage(legacyFaceUrl) : null
  const frontHairImage = frontHairUrl ? await loadCachedImage(frontHairUrl) : null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a imagem do personagem.')
  const shapeScale = characterShapeScale(proportions)
  const outputWidth = Math.max(canvas.width, Math.ceil(canvas.width * shapeScale.x))
  const outputHeight = Math.max(canvas.height, Math.ceil(canvas.height * shapeScale.y))
  const render = async (currentAppearance: CustomizerFaceAppearance | undefined = appearance, studioFaceTransforms?: StudioFaceTransforms) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height)
    if (wardrobeImage) context.drawImage(wardrobeImage, 0, 0, canvas.width, canvas.height)
    if (currentAppearance?.modelSlot === modelSlot) {
      const selections: Array<[FaceSheetKind, string | undefined]> = [
        ['eyes', currentAppearance.eyeCatalogId], ['eyebrows', currentAppearance.eyebrowCatalogId], ['nose', currentAppearance.noseCatalogId],
        ['mouth-closed', currentAppearance.mouthClosedCatalogId], ['mouth-open', currentAppearance.mouthOpenCatalogId]
      ]
      const hasCatalogSelection = selections.some(([, id]) => Boolean(id))
      const activeItems: Partial<Record<FaceSheetKind, FaceCatalogItem>> = {}
      await Promise.all(selections.filter((entry): entry is [FaceSheetKind, string] => Boolean(entry[1])).map(async ([category, id]) => {
        let item = faceItems[category]?.id === id ? faceItems[category] : null
        if (!item) {
          const key = `${category}:${id}`
          let pending = faceItemPromises.get(key)
          if (!pending) {
            pending = window.desktop.loadFaceCatalogItem(modelSlot, id)
            faceItemPromises.set(key, pending)
          }
          item = await pending ?? null
          if (item) faceItems[category] = item
        }
        if (item) activeItems[category] = item
      }))
      if (Object.keys(activeItems).length) await drawFaceCatalogOverlay(context, artwork, source, activeItems, currentAppearance, studioFaceTransforms)
      else if (!hasCatalogSelection && legacyFaceImage && currentAppearance.setId === appearance?.setId) context.drawImage(legacyFaceImage, 0, 0, canvas.width, canvas.height)
    } else if (legacyFaceImage) context.drawImage(legacyFaceImage, 0, 0, canvas.width, canvas.height)
    if (frontHairImage) context.drawImage(frontHairImage, 0, 0, canvas.width, canvas.height)
    if (shapeScale.x === 1 && shapeScale.y === 1) return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
    const output = document.createElement('canvas')
    output.width = outputWidth
    output.height = outputHeight
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('Não foi possível aplicar as proporções do personagem.')
    outputContext.translate(outputWidth / 2, outputHeight / 2)
    outputContext.scale(shapeScale.x, shapeScale.y)
    outputContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    return { dataUrl: output.toDataURL('image/png'), width: outputWidth, height: outputHeight }
  }
  return { width: outputWidth, height: outputHeight, render }
}

export async function renderSavedCharacter(character: CustomizerCharacter, studioFaceTransforms?: StudioFaceTransforms): Promise<{ dataUrl: string; width: number; height: number }> {
  const renderer = await prepareSavedCharacterRenderer(character)
  return renderer.render(character.customization.faceAppearance, studioFaceTransforms)
}

const modules: { name: string; icon: IconName; detail: string }[] = [
  { name: 'Modelos', icon: 'sparkles', detail: 'Looks prontos para começar' },
  { name: 'Poses', icon: 'body', detail: 'Pose, proporções e detalhes' },
  { name: 'Cabeça', icon: 'face', detail: 'Rosto, cabelo e expressões' },
  { name: 'Cabelos', icon: 'bow', detail: 'Biblioteca de cabelos do personagem' },
  { name: 'Roupas', icon: 'shirt', detail: 'Monte um visual único' },
  { name: 'Acessórios', icon: 'flower', detail: 'Peças e objetos de cena' },
  { name: 'Objetos', icon: 'box', detail: 'Itens para compor a cena' },
  { name: 'Perfil', icon: 'user', detail: 'Informações do personagem' }
]

const customizerTopTabs: { id: string; label: string }[] = [
  { id: 'modelos', label: 'Modelos' },
  { id: 'corpo', label: 'Corpo' },
  { id: 'cabeca', label: 'Cabeça' },
  { id: 'roupas', label: 'Roupas' },
  { id: 'outros', label: 'Outros' },
  { id: 'perfil', label: 'Perfil' }
]

const customizerHeadTabs = [
  { id: 'hair', label: 'Cabelo', icon: 'bow' },
  { id: 'eyes', label: 'Olhos', icon: 'face' },
  { id: 'face', label: 'Rosto', icon: 'face' },
  { id: 'extra', label: 'Extras', icon: 'sparkles' },
  { id: 'adjust', label: 'Ajustar', icon: 'sliders' }
] as const

const customizerClothesTabs = [
  { id: 'hats', label: 'Chapéus', icon: 'sparkles' },
  { id: 'accessories', label: 'Acess.', icon: 'bow' },
  { id: 'upper', label: 'Superior', icon: 'shirt' },
  { id: 'lower', label: 'Inferior', icon: 'body' },
  { id: 'other', label: 'Outros', icon: 'flower' },
  { id: 'extra', label: 'Extra', icon: 'sparkles' },
  { id: 'adjust', label: 'Ajustar', icon: 'sliders' }
] as const

const customizerOtherTabs = [
  { id: 'extra', label: 'Extra', icon: 'brush' },
  { id: 'extra2', label: 'Extra 2', icon: 'flower' },
  { id: 'hide', label: 'Ocultar', icon: 'eyeOff' },
  { id: 'text', label: 'Texto', icon: 'message' },
  { id: 'pets', label: 'Pets', icon: 'paw' },
  { id: 'objects', label: 'Objetos', icon: 'box' }
] as const

function CustomizerCategoryIcon({ category }: { category: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}>
    {category === 'modelos' && <>
      <rect x="13" y="8" width="27" height="32" rx="5" opacity=".65" />
      <rect x="7" y="12" width="27" height="32" rx="5" />
      <circle cx="20.5" cy="23" r="5" />
      <path d="M12.5 37c1.3-4.2 4.1-6.4 8-6.4s6.7 2.2 8 6.4" />
    </>}
    {category === 'corpo' && <>
      <circle cx="24" cy="9.5" r="5.5" />
      <path d="M17 18h14l4 10-5 3-2-4v15H20V27l-2 4-5-3 4-10Z" />
      <path d="m20 31-4 11m12-11 4 11M20 21l4 5 4-5" />
    </>}
    {category === 'cabeca' && <>
      <path d="M12 22c0-10 5-16 13-16 8.5 0 13 6.3 13 16v5c0 2.1-1.7 3.8-3.8 3.8-.7 4.7-4.8 8.2-9.2 8.2s-8.5-3.5-9.2-8.2A3.8 3.8 0 0 1 12 27v-5Z" />
      <path d="M12 22c.8-6 4.2-9 8-10 .4 3 2.4 4.8 5.5 5.4 2.7.5 5.3 2.1 7.2 4.6M19.5 27h.1m9-.1h.1M21 33c1.8 1.3 4.2 1.3 6 0" />
    </>}
    {category === 'roupas' && <>
      <path d="m17 9 7 3 7-3 10 7-5 9-5-2v18H17V23l-5 2-5-9 10-7Z" />
      <path d="m17 9 7 8 7-8M24 17v24" />
    </>}
    {category === 'outros' && <>
      <path d="m24 5 3.1 10.2L37 18.5l-9.9 3.2L24 32l-3.1-10.3-9.9-3.2 9.9-3.3L24 5Z" />
      <path d="m37 29 1.8 5.2L44 36l-5.2 1.8L37 43l-1.8-5.2L30 36l5.2-1.8L37 29ZM10 6l1.5 4.5L16 12l-4.5 1.5L10 18l-1.5-4.5L4 12l4.5-1.5L10 6Z" />
    </>}
    {category === 'perfil' && <>
      <rect x="7" y="6" width="34" height="36" rx="4" />
      <circle cx="18" cy="19" r="5" />
      <path d="M10.5 33c1.2-4 3.7-6 7.5-6s6.3 2 7.5 6M29 17h7m-7 6h7m-7 7h7m-18 8h18" />
    </>}
  </svg>
}

export function CustomizerPage() {
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const charactersRef = useRef<CustomizerCharacter[]>([])
  const characterSaveQueue = useRef(new Map<string, Promise<void>>())
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [charactersLoading, setCharactersLoading] = useState(true)
  const [charactersError, setCharactersError] = useState('')
  const [characterSaveState, setCharacterSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [savingCharacter, setSavingCharacter] = useState(false)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [selectedCustomizerTopTab, setSelectedCustomizerTopTab] = useState('corpo')
  const [previewBackground, setPreviewBackground] = usePreviewBackground()
  const [rosterQuery, setRosterQuery] = useState('')
  const [catalogModels, setCatalogModels] = useState<FabricatorSlotSummary[]>([])
  const [catalogPoses, setCatalogPoses] = useState<FabricatorPoseSummary[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCatalogModelSlot, setSelectedCatalogModelSlot] = useState<number | null>(null)
  const [selectedCatalogPoseSlot, setSelectedCatalogPoseSlot] = useState<number | null>(null)
  const [selectedPoseCategory, setSelectedPoseCategory] = useState('Parado')
  const [selectedPosePage, setSelectedPosePage] = useState(0)
  const [modelThumbnails, setModelThumbnails] = useState<Record<number, string>>({})
  const [poseThumbnails, setPoseThumbnails] = useState<Record<string, string>>({})
  const [clothingSection, setClothingSection] = useState<'Customizar' | 'Superior' | 'Inferior'>('Superior')
  const [clothesPanelTab, setClothesPanelTab] = useState<(typeof customizerClothesTabs)[number]['id']>('upper')
  const [otherPanelTab, setOtherPanelTab] = useState<(typeof customizerOtherTabs)[number]['id']>('extra')
  const [wardrobeSets, setWardrobeSets] = useState<WardrobeSetSummary[]>([])
  const [wardrobeLoading, setWardrobeLoading] = useState(false)
  const [wardrobeDetails, setWardrobeDetails] = useState<Record<string, WardrobeSet>>({})
  const [wardrobeThumbnails, setWardrobeThumbnails] = useState<Record<string, string>>({})
  const [faceCatalogItems, setFaceCatalogItems] = useState<FaceCatalogItemSummary[]>([])
  const [faceCatalogDetails, setFaceCatalogDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [faceDetails, setFaceDetails] = useState<Record<string, FaceSet>>({})
  const [faceLoading, setFaceLoading] = useState(false)
  const [hairStyles, setHairStyles] = useState<HairStyleSummary[]>([])
  const [hairDetails, setHairDetails] = useState<Record<string, HairStyle>>({})
  const [hairCatalogSide, setHairCatalogSide] = useState<HairCatalogSide>('front')
  const [hairLoading, setHairLoading] = useState(false)
  const [headPanelTab, setHeadPanelTab] = useState<'hair' | 'eyes' | 'face' | 'extra' | 'adjust'>('hair')
  const [activeHairColorRole, setActiveHairColorRole] = useState<HairColorRole>('base')
  const [faceCategory, setFaceCategory] = useState<'eyes' | 'eyebrows' | 'nose' | 'mouth'>('eyes')
  const [selectedClothing, setSelectedClothing] = useState<SelectedWardrobeComponent | null>(null)
  const [wardrobeTransformDraft, setWardrobeTransformDraft] = useState<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'> | null>(null)
  const [wardrobeHistory, setWardrobeHistory] = useState<WardrobeEditHistory>({ characterId: '', undo: [], redo: [] })
  const [selectedWardrobeUrl, setSelectedWardrobeUrl] = useState<string | null>(null)
  const [selectedWardrobeHighlightUrl, setSelectedWardrobeHighlightUrl] = useState<string | null>(null)
  const [wardrobeHighlightVisible, setWardrobeHighlightVisible] = useState(false)
  const [selectedArtworkProject, setSelectedArtworkProject] = useState<CatalogArtwork | null>(null)
  const [proportionEdit, setProportionEdit] = useState<{ characterId: string; values: CharacterProportions } | null>(null)
  const [bodyDimensionEdit, setBodyDimensionEdit] = useState<{ characterId: string; values: CharacterBodyDimensions } | null>(null)
  const [selectedSourceModelProject, setSelectedSourceModelProject] = useState<FabricatorProject | null>(null)
  const [selectedArtworkUrl, setSelectedArtworkUrl] = useState<string | null>(null)
  const [selectedFaceUrl, setSelectedFaceUrl] = useState<string | null>(null)
  const [selectedFrontHairUrl, setSelectedFrontHairUrl] = useState<string | null>(null)
  const [selectedArtworkLabel, setSelectedArtworkLabel] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const thumbnailCache = useRef(new Set<string>())
  const previewLoadRequest = useRef(0)
  const clothingDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; scaleX: number; scaleY: number; startX: number; startY: number; groupKey: string; characterId: string; beforeGroups: CustomizerWardrobeGroup[]; latest: CustomizerCharacter | null } | null>(null)
  const wardrobeTransformDirty = useRef(false)
  const wardrobeHistoryRef = useRef<WardrobeEditHistory>({ characterId: '', undo: [], redo: [] })
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0] ?? null
  const activeProportions = proportionEdit && selectedCharacter && proportionEdit.characterId === selectedCharacter.id
    ? proportionEdit.values
    : getCharacterProportions(selectedCharacter?.customization)
  const activeBodyDimensions = useMemo(() => bodyDimensionEdit && selectedCharacter && bodyDimensionEdit.characterId === selectedCharacter.id
    ? bodyDimensionEdit.values
    : getCharacterBodyDimensions(selectedCharacter?.customization), [bodyDimensionEdit, selectedCharacter?.id, selectedCharacter?.customization.bodyDimensions])
  const activeShapeScale = characterShapeScale(activeProportions)
  const displayArtworkProject = useMemo(() => selectedArtworkProject ? applyCharacterBodyShape(withCharacterHeadSize(selectedArtworkProject, activeProportions), activeBodyDimensions) : null, [selectedArtworkProject, activeProportions.head, activeProportions.headWidth, activeProportions.headHeight, activeBodyDimensions])
  const previewStyle = { '--preview-background': previewBackground, '--character-scale-x': activeShapeScale.x, '--character-scale-y': activeShapeScale.y } as import('react').CSSProperties
  const characterWardrobeGroups = selectedCharacter?.customization.wardrobeGroups ?? []
  const characterFaceAppearance = selectedCharacter?.customization.faceAppearance
  const characterHairAppearance = selectedCharacter?.customization.hairAppearance
  const characterWardrobeHydrationKey = characterWardrobeGroups.map((group) => `${group.modelSlot}:${group.setId}:${group.category}:${group.componentId ?? ''}`).sort().join('|')
  const visibleCharacters = characters
    .filter((character) => character.name.toLowerCase().includes(rosterQuery.trim().toLowerCase()))

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((loaded) => {
      if (cancelled) return
      charactersRef.current = loaded
      setCharacters(loaded)
      let remembered = ''
      try { remembered = localStorage.getItem('nymi.customizer.activeCharacter') ?? '' } catch { /* Storage preferences are optional. */ }
      setSelectedCharacterId(loaded.some((character) => character.id === remembered) ? remembered : loaded[0]?.id ?? '')
    }).catch((reason: unknown) => {
      if (!cancelled) setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível carregar os personagens.')
    }).finally(() => { if (!cancelled) setCharactersLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try {
      if (selectedCharacterId) localStorage.setItem('nymi.customizer.activeCharacter', selectedCharacterId)
      else localStorage.removeItem('nymi.customizer.activeCharacter')
    } catch { /* Selection persistence is best-effort; character data is stored by Electron. */ }
  }, [selectedCharacterId])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listFabricatorPoseSlots()])
      .then(async ([models, poses]) => {
        if (cancelled) return
        setCatalogModels(models)
        setCatalogPoses(poses)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo.')
          setPreviewLoading(false)
        }
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => {
      cancelled = true
      previewLoadRequest.current += 1
    }
  }, [])

  useEffect(() => {
    if (catalogLoading) return
    if (!selectedCharacter) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedPoseCategory('Parado')
      setSelectedPosePage(0)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const model = catalogModels.find((item) => item?.slot === selectedCharacter.customization.modelSlot)
      ?? catalogModels.find((item) => item?.slot === 1)
      ?? catalogModels.find((item) => item !== null)
    if (!model) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedPoseCategory('Parado')
      setSelectedPosePage(0)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const requestedPose = selectedCharacter.customization.poseSlot
    const pose = requestedPose === null ? null : catalogPoses.find((item) => item?.sourceModelSlot === model.slot && item.slot === requestedPose)
    const requestId = ++previewLoadRequest.current
    let cancelled = false
    setSelectedCatalogModelSlot(model.slot)
    setSelectedPosePage(0)
    setSelectedCatalogPoseSlot(pose?.slot ?? null)
    setSelectedPoseCategory(pose ? resolvePoseCategory(pose) : 'Parado')
    setSelectedArtworkLabel(pose?.name ?? model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    void (async () => {
      try {
        const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
        if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
        const artwork = pose ? await window.desktop.loadFabricatorPose(model.slot, pose.slot) : sourceProject
        if (!artwork) throw new Error('Não foi possível carregar a prévia deste personagem.')
        if (!cancelled && previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject) }
        const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter.customization.modelSkinTone)
        if (!cancelled && previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
      } catch (reason) {
        if (!cancelled && previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar a prévia.')
      } finally {
        if (!cancelled && previewLoadRequest.current === requestId) setPreviewLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [catalogLoading, catalogModels, catalogPoses, selectedCharacter?.id, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    if (!displayArtworkProject) return
    let cancelled = false
    void renderArtwork(displayArtworkProject, 720, selectedCharacter?.customization.modelSkinTone).then((url) => {
      if (!cancelled) setSelectedArtworkUrl(url)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a forma do corpo.')
    })
    return () => { cancelled = true }
  }, [displayArtworkProject, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    setSelectedClothing(null)
    setWardrobeHighlightVisible(false)
  }, [selectedCharacter?.id])

  useEffect(() => {
    if (!selectedCharacter || selectedClothing) return
    const firstGroup = selectedCharacter?.customization.wardrobeGroups?.[0]
    const firstSet = firstGroup ? wardrobeDetails[`${firstGroup.modelSlot}:${firstGroup.setId}`] : undefined
    const firstDefinition = firstGroup ? Object.values(clothingCategories).flat().find((item) => item.id === firstGroup.category) : undefined
    const firstComponent = firstGroup && firstSet
      ? firstGroup.componentId
        ? firstSet.components.find((component) => component.id === firstGroup.componentId)
        : firstSet.components.find((component) => firstDefinition?.source.includes(component.category))
      : undefined
    setSelectedClothing(firstGroup && firstComponent ? { setId: firstGroup.setId, category: firstGroup.category, componentId: firstComponent.id } : null)
    setWardrobeHighlightVisible(Boolean(firstComponent))
  }, [selectedCharacter?.id, selectedCharacter?.customization.wardrobeGroups, selectedClothing, wardrobeDetails])

  useEffect(() => {
    const group = selectedClothing
      ? selectedCharacter?.customization.wardrobeGroups?.find((item) => item.setId === selectedClothing.setId && item.category === selectedClothing.category && (item.componentId === selectedClothing.componentId || !item.componentId))
      : undefined
    wardrobeTransformDirty.current = false
    setWardrobeTransformDraft(group ? { offsetX: group.offsetX, offsetY: group.offsetY, scaleX: group.scaleX, scaleY: group.scaleY, rotation: group.rotation } : null)
  }, [selectedCharacter?.id, selectedCharacter?.customization.wardrobeGroups, selectedClothing?.setId, selectedClothing?.category, selectedClothing?.componentId])

  useEffect(() => {
    const next: WardrobeEditHistory = { characterId: activeModule === 'Roupas' && clothingSection === 'Customizar' ? selectedCharacter?.id ?? '' : '', undo: [], redo: [] }
    wardrobeHistoryRef.current = next
    setWardrobeHistory(next)
  }, [activeModule, clothingSection, selectedCharacter?.id])

  useEffect(() => {
    if (activeModule !== 'Modelos' || catalogLoading) return
    let cancelled = false
    void (async () => {
      for (const model of catalogModels) {
        if (!model || thumbnailCache.current.has(`model:${model.slot}`)) continue
        let artwork: CatalogArtwork | null = null
        const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
        try {
          if (firstPose) artwork = await window.desktop.loadFabricatorPose(model.slot, 1)
          if (!artwork) artwork = await window.desktop.loadFabricatorSlot(model.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 144)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(`model:${model.slot}`)
            setModelThumbnails((current) => ({ ...current, [model.slot]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura do modelo.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogModels, catalogPoses])

  useEffect(() => {
    if ((activeModule !== 'Poses' && selectedCustomizerTopTab !== 'modelos') || selectedCatalogModelSlot === null || catalogLoading) return
    let cancelled = false
    const modelPoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
    void (async () => {
      for (const pose of modelPoses) {
        const key = `${pose.sourceModelSlot}:${pose.slot}`
        const cacheKey = `pose-tight-v2:${key}:${pose.updatedAt}`
        if (thumbnailCache.current.has(cacheKey)) continue
        try {
          const artwork: FabricatorPose | null = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 420, undefined, true)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(cacheKey)
            setPoseThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura da pose.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogPoses, selectedCatalogModelSlot, selectedCustomizerTopTab])

  useEffect(() => {
    if (activeModule !== 'Roupas' || selectedCatalogModelSlot === null) return
    let cancelled = false
    setWardrobeLoading(true)
    void window.desktop.listWardrobeSets(selectedCatalogModelSlot).then((sets) => {
      if (!cancelled) setWardrobeSets(sets)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de roupas.')
    }).finally(() => { if (!cancelled) setWardrobeLoading(false) })
    return () => { cancelled = true }
  }, [activeModule, selectedCatalogModelSlot])

  useEffect(() => {
    if (selectedCatalogModelSlot === null) { setFaceCatalogItems([]); return }
    let cancelled = false
    setFaceLoading(true)
    void window.desktop.listFaceCatalog(selectedCatalogModelSlot).then(async (summaries) => {
      if (cancelled) return
      setFaceCatalogItems(summaries)
      const loaded = await Promise.all(summaries.map(async (summary) => ({ key: `${summary.modelSlot}:${summary.id}`, item: await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id) })))
      if (cancelled) return
      setFaceCatalogDetails((current) => {
        const next = { ...current }
        for (const entry of loaded) if (entry.item) next[entry.key] = entry.item
        return next
      })
    }).catch((reason: unknown) => {
      if (!cancelled && activeModule === 'Cabeça') setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar os rostos salvos.')
    }).finally(() => { if (!cancelled) setFaceLoading(false) })
    return () => { cancelled = true }
  }, [selectedCatalogModelSlot, activeModule])

  useEffect(() => {
    const appearance = characterFaceAppearance
    if (!appearance?.setId || appearance.modelSlot !== selectedCatalogModelSlot) return
    let cancelled = false
    const key = `${appearance.modelSlot}:${appearance.setId}`
    if (faceDetails[key]) return
    void window.desktop.loadFaceSet(appearance.modelSlot, appearance.setId).then((face) => {
      if (!cancelled && face) setFaceDetails((current) => ({ ...current, [key]: face }))
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o rosto legado.')
    })
    return () => { cancelled = true }
  }, [characterFaceAppearance, faceDetails, selectedCatalogModelSlot])

  useEffect(() => {
    if (selectedCatalogModelSlot === null || !(activeModule === 'Cabelos' || activeModule === 'Cabeça' && headPanelTab === 'hair')) { setHairStyles([]); return }
    let cancelled = false
    setHairLoading(true)
    void window.desktop.listHairStyles(selectedCatalogModelSlot).then(async (summaries) => {
      const styles = await Promise.all(summaries.map((summary) => window.desktop.loadHairStyle(selectedCatalogModelSlot, summary.id)))
      if (cancelled) return
      setHairStyles(summaries)
      setHairDetails((current) => {
        const next = { ...current }
        for (const style of styles) if (style) next[`${selectedCatalogModelSlot}:${style.id}`] = style
        return next
      })
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de cabelos.')
    }).finally(() => { if (!cancelled) setHairLoading(false) })
    return () => { cancelled = true }
  }, [activeModule, headPanelTab, selectedCatalogModelSlot])

  useEffect(() => {
    let cancelled = false
    const appearance = characterFaceAppearance
    const hasCatalogSelection = Boolean(appearance?.eyeCatalogId || appearance?.eyebrowCatalogId || appearance?.noseCatalogId || appearance?.mouthClosedCatalogId || appearance?.mouthOpenCatalogId)
    const face = appearance?.setId ? faceDetails[`${appearance.modelSlot}:${appearance.setId}`] : null
    const catalogItems: Partial<Record<FaceSheetKind, FaceCatalogItem>> = {}
    if (appearance && hasCatalogSelection) {
      const ids: Partial<Record<FaceSheetKind, string | undefined>> = { eyes: appearance.eyeCatalogId, eyebrows: appearance.eyebrowCatalogId, nose: appearance.noseCatalogId, 'mouth-closed': appearance.mouthClosedCatalogId, 'mouth-open': appearance.mouthOpenCatalogId }
      for (const [category, id] of Object.entries(ids) as Array<[FaceSheetKind, string | undefined]>) {
        if (!id) continue
        const item = faceCatalogDetails[`${appearance.modelSlot}:${id}`]
        if (item) catalogItems[category] = item
      }
    }
    if (!displayArtworkProject || !selectedSourceModelProject || !appearance || (!hasCatalogSelection && !face)) { setSelectedFaceUrl(null); return }
    const render = hasCatalogSelection
      ? renderFaceCatalogOverlay(displayArtworkProject, selectedSourceModelProject, catalogItems, appearance)
      : renderFaceOverlay(displayArtworkProject, selectedSourceModelProject, face, appearance)
    void render.then((url) => {
      if (!cancelled) setSelectedFaceUrl(url)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar o rosto do personagem.')
    })
    return () => { cancelled = true }
  }, [characterFaceAppearance, faceCatalogDetails, faceDetails, displayArtworkProject, selectedSourceModelProject])

  useEffect(() => {
    let cancelled = false
    const artwork = displayArtworkProject
    const source = selectedSourceModelProject
    const appearance = selectedCharacter?.customization.hairAppearance
    if (!artwork || !source) return
    void (async () => {
      const [backStyles, frontStyles] = await Promise.all([
        loadHairAppearanceLayers(appearance, source.slot, 'back', hairDetails),
        loadHairAppearanceLayers(appearance, source.slot, 'front', hairDetails)
      ])
      if (cancelled) return
      const newlyLoaded: Record<string, HairStyle> = {}
      for (const layer of [...backStyles, ...frontStyles]) if (!hairDetails[`${source.slot}:${layer.style.id}`]) newlyLoaded[`${source.slot}:${layer.style.id}`] = layer.style
      if (Object.keys(newlyLoaded).length) setHairDetails((current) => ({ ...current, ...newlyLoaded }))
      const [url, frontUrl] = await Promise.all([
        renderArtworkWithHair(artwork, source, backStyles, 720, selectedCharacter?.customization.modelSkinTone, appearance?.modelSlot === source.slot ? appearance.colors : undefined),
        renderFrontHairOverlay(artwork, source, frontStyles, 720, appearance?.modelSlot === source.slot ? appearance.colors : undefined)
      ])
      if (!cancelled) { setSelectedArtworkUrl(url); setSelectedFrontHairUrl(frontUrl) }
    })().catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar o cabelo do personagem.')
    })
    return () => { cancelled = true }
  }, [displayArtworkProject, selectedSourceModelProject, selectedCharacter?.id, selectedCharacter?.customization.hairAppearance, selectedCharacter?.customization.modelSkinTone, hairDetails])

  useEffect(() => {
    if (activeModule !== 'Roupas' || !wardrobeSets.length) return
    let cancelled = false
    void (async () => {
      for (const summary of wardrobeSets) {
        let set: WardrobeSet | null = null
        try {
          set = await window.desktop.loadWardrobeSet(summary.modelSlot, summary.id)
          if (!set || cancelled) continue
          setWardrobeDetails((current) => ({ ...current, [`${summary.modelSlot}:${summary.id}`]: set! }))
          for (const group of Object.values(clothingCategories).flat()) {
            if (!set.components.some((component) => group.source.includes(component.category))) continue
            const key = `${summary.modelSlot}:${summary.id}:${group.id}`
            if (wardrobeThumbnails[key]) continue
            const thumbnail = await renderWardrobeThumbnail(set, group.source)
            if (cancelled) return
            if (thumbnail) setWardrobeThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar a miniatura da roupa.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, wardrobeSets])

  useEffect(() => {
    if (!selectedCharacter || !characterWardrobeGroups.length) return
    let cancelled = false
    const groupsToRestore = [...characterWardrobeGroups]
    void (async () => {
      const restored = await Promise.all(groupsToRestore.map(async (group) => {
        const key = `${group.modelSlot}:${group.setId}`
        const set = await window.desktop.loadWardrobeSet(group.modelSlot, group.setId)
        return { group, key, set }
      }))
      if (cancelled) return
      setWardrobeDetails((current) => {
        const next = { ...current }
        for (const { key, set } of restored) if (set) next[key] = set
        return next
      })
      const migratedGroups = restored.flatMap(({ group, set }) => {
        if (group.componentId || !set) return [group]
        const definition = Object.values(clothingCategories).flat().find((item) => item.id === group.category)
        const components = set.components.filter((component) => definition?.source.includes(component.category))
        return components.length ? components.map((component) => ({ ...group, componentId: component.id })) : [group]
      })
      if (migratedGroups.some((group, index) => group.componentId !== groupsToRestore[index]?.componentId) || migratedGroups.length !== groupsToRestore.length) {
        const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
        await saveCharacter({ ...current, customization: { ...current.customization, wardrobeGroups: migratedGroups }, updatedAt: new Date().toISOString() })
      }
      for (const { group, set } of restored) {
        if (!set) continue
        const category = Object.values(clothingCategories).flat().find((definition) => definition.id === group.category)
        if (!category) continue
        const thumbnailKey = `${group.modelSlot}:${group.setId}:${group.category}`
        if (wardrobeThumbnails[thumbnailKey]) continue
        const thumbnail = await renderWardrobeThumbnail(set, category.source)
        if (cancelled) return
        if (thumbnail) setWardrobeThumbnails((current) => ({ ...current, [thumbnailKey]: thumbnail }))
      }
    })().catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível restaurar as roupas deste personagem.')
    })
    return () => { cancelled = true }
  }, [selectedCharacter?.id, characterWardrobeHydrationKey])

  useEffect(() => {
    let cancelled = false
    const groups = selectedCharacter?.customization.wardrobeGroups ?? []
    if (!displayArtworkProject || !groups.length) {
      setSelectedWardrobeUrl(null)
      return
    }
    const previewGroups = wardrobeTransformDraft && selectedClothing
      ? groups.map((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category && (group.componentId === selectedClothing.componentId || !group.componentId) ? { ...group, componentId: selectedClothing.componentId, ...wardrobeTransformDraft } : group)
      : groups
    void renderWardrobeOverlay(previewGroups, wardrobeDetails, displayArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject, wardrobeHighlightVisible ? selectedClothing : null, selectedCharacter?.customization.modelSkinTone).then((result) => {
      if (!cancelled) { setSelectedWardrobeUrl(result.imageUrl); setSelectedWardrobeHighlightUrl(result.selectedUrl) }
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível compor as roupas do personagem.')
    })
    return () => { cancelled = true }
  }, [selectedCharacter?.id, selectedCharacter?.customization.modelSkinTone, selectedCharacter?.customization.wardrobeGroups, wardrobeDetails, displayArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject, selectedClothing?.setId, selectedClothing?.category, selectedClothing?.componentId, wardrobeTransformDraft, wardrobeHighlightVisible])

  function selectCharacter(id: string) {
    setSelectedCharacterId(id)
    setActiveModule(null)
  }

  async function saveCharacter(next: CustomizerCharacter) {
    setCharactersError('')
    setCharacterSaveState('saving')
    charactersRef.current = charactersRef.current.map((character) => character.id === next.id ? next : character)
    setCharacters(charactersRef.current)
    const previousWrite = characterSaveQueue.current.get(next.id)
    const write = (previousWrite ? previousWrite.catch(() => undefined) : Promise.resolve())
      .then(() => window.desktop.saveCustomizerCharacter(next))
    characterSaveQueue.current.set(next.id, write)
    try {
      await write
      setCharacterSaveState('saved')
    } catch (reason) {
      setCharacterSaveState('error')
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
      if (characterSaveQueue.current.get(next.id) === write) {
        const latest = await window.desktop.listCustomizerCharacters().catch(() => null)
        if (latest) {
          charactersRef.current = latest
          setCharacters(latest)
        }
      }
    } finally {
      if (characterSaveQueue.current.get(next.id) === write) characterSaveQueue.current.delete(next.id)
    }
  }

  async function saveCharacterCustomization(patch: Partial<CustomizerCharacter['customization']> | ((current: CustomizerCharacter['customization']) => Partial<CustomizerCharacter['customization']>)) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const changes = typeof patch === 'function' ? patch(current.customization) : patch
    await saveCharacter({ ...current, customization: { ...current.customization, ...changes }, updatedAt: new Date().toISOString() })
  }

  function changeProportion(key: keyof CharacterProportions, value: number) {
    if (!selectedCharacter) return
    const { min, max } = characterProportionLimits[key]
    setProportionEdit({ characterId: selectedCharacter.id, values: { ...activeProportions, [key]: Math.min(max, Math.max(min, Math.round(value))) } })
  }

  function commitProportions(values: CharacterProportions) {
    if (!selectedCharacter) return
    setProportionEdit({ characterId: selectedCharacter.id, values })
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const saved = getCharacterProportions(current.customization)
    if ((Object.keys(values) as Array<keyof CharacterProportions>).every((key) => saved[key] === values[key])) return
    void saveCharacterCustomization({ proportions: values })
  }

  function commitProportion(key: keyof CharacterProportions, value: number) {
    const { min, max } = characterProportionLimits[key]
    commitProportions({ ...activeProportions, [key]: Math.min(max, Math.max(min, Math.round(value))) })
  }

  function commitBodyDimensions(values: CharacterBodyDimensions) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const saved = getCharacterBodyDimensions(current.customization)
    if ((Object.keys(values) as Array<keyof CharacterBodyDimensions>).every((key) => saved[key] === values[key])) return
    void saveCharacterCustomization({ bodyDimensions: values })
  }

  function commitBodyDimension(key: keyof CharacterBodyDimensions, value: number) {
    const { min, max } = characterBodyDimensionLimits[key]
    const values = { ...activeBodyDimensions, [key]: Math.min(max, Math.max(min, Math.round(value))) }
    setBodyDimensionEdit(selectedCharacter ? { characterId: selectedCharacter.id, values } : null)
    commitBodyDimensions(values)
  }

  function changeBodyDimension(key: keyof CharacterBodyDimensions, value: number) {
    if (!selectedCharacter) return
    const { min, max } = characterBodyDimensionLimits[key]
    setBodyDimensionEdit({ characterId: selectedCharacter.id, values: { ...activeBodyDimensions, [key]: Math.min(max, Math.max(min, Math.round(value))) } })
  }

  async function chooseFaceCatalogItem(summary: FaceCatalogItemSummary) {
    const item = faceCatalogDetails[`${summary.modelSlot}:${summary.id}`] ?? await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id)
    if (!item || !selectedCharacter) return
    setFaceCatalogDetails((current) => ({ ...current, [`${summary.modelSlot}:${summary.id}`]: item }))
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    const field: Record<FaceSheetKind, keyof CustomizerFaceAppearance> = {
      eyes: 'eyeCatalogId', eyebrows: 'eyebrowCatalogId', nose: 'noseCatalogId',
      'mouth-closed': 'mouthClosedCatalogId', 'mouth-open': 'mouthOpenCatalogId'
    }
    const sameModel = previous?.modelSlot === item.modelSlot
    const migrated: Partial<Pick<CustomizerFaceAppearance, 'eyeCatalogId' | 'eyebrowCatalogId' | 'noseCatalogId' | 'mouthClosedCatalogId' | 'mouthOpenCatalogId'>> = {}
    if (sameModel && previous?.setId) {
      const legacySet = await window.desktop.loadFaceSet(previous.modelSlot, previous.setId)
      for (const kind of Object.keys(field) as FaceSheetKind[]) {
        if (!legacySet?.sheets[kind]) continue
        const legacyItemId = `legacy_${legacySet.id}_${kind}`
        if (!faceCatalogItems.some((entry) => entry.id === legacyItemId)) continue
        if (kind === 'eyes') migrated.eyeCatalogId = legacyItemId
        else if (kind === 'eyebrows') migrated.eyebrowCatalogId = legacyItemId
        else if (kind === 'nose') migrated.noseCatalogId = legacyItemId
        else if (kind === 'mouth-closed') migrated.mouthClosedCatalogId = legacyItemId
        else migrated.mouthOpenCatalogId = legacyItemId
      }
    }
    const appearance: CustomizerFaceAppearance = {
      ...(sameModel ? previous : undefined),
      ...migrated,
      modelSlot: item.modelSlot,
      setId: undefined,
      [field[item.category]]: item.id,
      eyeState: sameModel ? previous.eyeState : 0,
      eyebrows: sameModel ? previous.eyebrows : true,
      noseIndex: item.category === 'nose' ? item.selectedNose : sameModel ? previous.noseIndex : item.selectedNose,
      expressionIndex: item.category.startsWith('mouth') ? item.selectedExpression : sameModel ? previous.expressionIndex : item.selectedExpression,
      mouthOpen: item.category === 'mouth-open' ? true : item.category === 'mouth-closed' ? false : sameModel ? previous.mouthOpen : false
    }
    if (item.category === 'eyes' || item.category === 'eyebrows') {
      setHeadPanelTab('eyes')
      setFaceCategory(item.category)
    } else {
      setHeadPanelTab('face')
      setFaceCategory(item.category.startsWith('mouth') ? 'mouth' : 'nose')
    }
    await saveCharacterCustomization({ faceAppearance: appearance })
  }

  async function chooseHairStyle(summary: HairStyleSummary | null, side: HairCatalogSide) {
    if (!selectedCharacter) return
    const modelSlot = summary?.modelSlot ?? selectedCatalogModelSlot
    if (modelSlot === null || modelSlot === undefined) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === modelSlot
    const frontStyleId = side === 'front' ? summary?.id ?? null : sameModel ? hairAppearanceStyleId(previous, 'front') : null
    const backStyleId = side === 'back' ? summary?.id ?? null : sameModel ? hairAppearanceStyleId(previous, 'back') : null
    const colors = sameModel ? previous?.colors : undefined
    await saveCharacterCustomization({ hairAppearance: frontStyleId || backStyleId || colors && Object.keys(colors).length ? { modelSlot, frontStyleId, backStyleId, colors } : undefined })
  }

  async function chooseHairPartStyle(part: HairPartId, summary: HairStyleSummary | null) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    const parts = { ...(sameModel ? previous?.parts : undefined), [part]: summary?.id ?? null }
    await saveCharacterCustomization({ hairAppearance: { ...(sameModel ? previous : undefined), modelSlot: selectedCatalogModelSlot, parts } })
  }

  async function setHairColor(role: HairColorRole, value: string) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    await saveCharacterCustomization({ hairAppearance: {
      ...(sameModel ? previous : undefined),
      modelSlot: selectedCatalogModelSlot,
      colors: { ...(sameModel ? previous?.colors : undefined), [role]: value }
    } })
  }

  async function setFaceCatalogVariant(patch: Partial<CustomizerFaceAppearance>) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const old = current.customization.faceAppearance
    if (!old || old.modelSlot !== selectedCatalogModelSlot) return
    await saveCharacterCustomization({ faceAppearance: { ...old, ...patch } })
  }

  function wardrobeGroupKey(group: Pick<CustomizerWardrobeGroup, 'modelSlot' | 'setId' | 'category' | 'componentId'>) {
    return `${group.modelSlot}:${group.setId}:${group.category}:${group.componentId ?? ''}`
  }

  async function applyWardrobeGroup(set: WardrobeSetSummary, category: ClothingGroupCategory) {
    if (!selectedCharacter) return
    const detail = wardrobeDetails[`${set.modelSlot}:${set.id}`] ?? await window.desktop.loadWardrobeSet(set.modelSlot, set.id)
    if (!detail) return
    const accepted = clothingCategories[category === 'calca' || category === 'shorts' ? 'Inferior' : 'Superior'].find((item) => item.id === category)?.source ?? []
    const components = detail.components.filter((component) => accepted.includes(component.category))
    if (!components.length) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const groups = current.customization.wardrobeGroups ?? []
    const existing = groups.filter((group) => group.modelSlot === set.modelSlot && group.setId === set.id && group.category === category)
    const existingIds = new Set(existing.flatMap((group) => group.componentId ? [group.componentId] : components.map((component) => component.id)))
    const missingComponents = components.filter((component) => !existingIds.has(component.id))
    if (existing.length && !missingComponents.length) {
      const selected = existing.find((group) => group.componentId) ?? existing[0]
      const componentId = selected.componentId ?? components[0].id
      setSelectedClothing({ setId: set.id, category, componentId })
      setWardrobeHighlightVisible(true)
      return
    }
    const nextGroups = missingComponents.map((component): CustomizerWardrobeGroup => ({ modelSlot: set.modelSlot, setId: set.id, category, componentId: component.id, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 }))
    setSelectedClothing({ setId: set.id, category, componentId: missingComponents[0]?.id ?? components[0].id })
    setWardrobeHighlightVisible(true)
    await saveCharacterCustomization((latest) => {
      const latestGroups = latest.wardrobeGroups ?? []
      return { wardrobeGroups: [...latestGroups.filter((group) => group.category !== category || group.modelSlot !== set.modelSlot || group.setId === set.id), ...nextGroups] }
    })
  }

  async function removeWardrobeGroup(setId: string, category: ClothingGroupCategory, componentId?: string) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const before = current.customization.wardrobeGroups ?? []
    const after = before.filter((group) => !(group.setId === setId && group.category === category && (!componentId || !group.componentId || group.componentId === componentId)))
    recordWardrobeHistory(before, after)
    await saveCharacterCustomization({ wardrobeGroups: after })
    if (selectedClothing?.setId === setId && selectedClothing.category === category && (!componentId || selectedClothing.componentId === componentId)) {
      const fallback = after.find((group) => group.modelSlot === selectedCatalogModelSlot)
      setSelectedClothing(fallback?.componentId ? { setId: fallback.setId, category: fallback.category, componentId: fallback.componentId } : null)
      setWardrobeHighlightVisible(Boolean(fallback?.componentId))
    }
  }

  async function adjustWardrobeGroup(patch: Partial<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>>) {
    if (!selectedCharacter || !selectedClothing) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const before = current.customization.wardrobeGroups ?? []
    const after = before.map((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category && (group.componentId === selectedClothing.componentId || !group.componentId) ? { ...group, componentId: selectedClothing.componentId, ...patch } : group)
    setWardrobeHighlightVisible(false)
    recordWardrobeHistory(before, after)
    await saveCharacterCustomization({ wardrobeGroups: after })
  }

  function recordWardrobeHistory(before: CustomizerWardrobeGroup[], after: CustomizerWardrobeGroup[]) {
    if (activeModule !== 'Roupas' || clothingSection !== 'Customizar' || !selectedCharacter || JSON.stringify(before) === JSON.stringify(after)) return
    const current = wardrobeHistoryRef.current.characterId === selectedCharacter.id
      ? wardrobeHistoryRef.current
      : { characterId: selectedCharacter.id, undo: [], redo: [] }
    const next: WardrobeEditHistory = {
      characterId: selectedCharacter.id,
      undo: [...current.undo, before.map((group) => ({ ...group }))].slice(-20),
      redo: []
    }
    wardrobeHistoryRef.current = next
    setWardrobeHistory(next)
  }

  async function restoreWardrobeHistory(direction: 'undo' | 'redo') {
    if (!selectedCharacter) return
    const current = wardrobeHistoryRef.current
    if (current.characterId !== selectedCharacter.id) return
    const source = direction === 'undo' ? current.undo : current.redo
    if (!source.length) return
    const character = charactersRef.current.find((item) => item.id === selectedCharacter.id) ?? selectedCharacter
    const currentGroups = (character.customization.wardrobeGroups ?? []).map((group) => ({ ...group }))
    const restored = source[source.length - 1].map((group) => ({ ...group }))
    const next: WardrobeEditHistory = direction === 'undo'
      ? { characterId: current.characterId, undo: current.undo.slice(0, -1), redo: [...current.redo, currentGroups].slice(-20) }
      : { characterId: current.characterId, undo: [...current.undo, currentGroups].slice(-20), redo: current.redo.slice(0, -1) }
    wardrobeHistoryRef.current = next
    setWardrobeHistory(next)
    const selectedStillExists = selectedClothing && restored.some((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category && (group.componentId === selectedClothing.componentId || !group.componentId))
    const fallback = restored[restored.length - 1]
    if (!selectedStillExists) setSelectedClothing(fallback?.componentId ? { setId: fallback.setId, category: fallback.category, componentId: fallback.componentId } : null)
    setWardrobeHighlightVisible(Boolean(selectedStillExists))
    await saveCharacter({ ...character, customization: { ...character.customization, wardrobeGroups: restored }, updatedAt: new Date().toISOString() })
  }

  function changeWardrobeTransform(patch: Partial<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>>) {
    setWardrobeTransformDraft((current) => current ? { ...current, ...patch } : current)
    wardrobeTransformDirty.current = true
    setWardrobeHighlightVisible(false)
  }

  function commitWardrobeTransform() {
    if (!wardrobeTransformDirty.current || !wardrobeTransformDraft) return
    wardrobeTransformDirty.current = false
    void adjustWardrobeGroup(wardrobeTransformDraft)
  }

  function beginWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    if (activeModule !== 'Roupas' || clothingSection !== 'Customizar' || !selectedCharacter || !selectedClothing || !selectedArtworkProject) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const beforeGroups = (current.customization.wardrobeGroups ?? []).map((item) => ({ ...item }))
    const group = beforeGroups.find((item) => item.setId === selectedClothing.setId && item.category === selectedClothing.category && (item.componentId === selectedClothing.componentId || !item.componentId))
    setWardrobeHighlightVisible(false)
    if (!group) return
    const scene = event.currentTarget.closest('.stage-scene')
    const rect = scene?.getBoundingClientRect()
    if (!rect) return
    const previewScale = Math.min((rect.width - 136) / selectedArtworkProject.width, (rect.height - 130) / selectedArtworkProject.height)
    clothingDragRef.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      scaleX: Math.max(.01, previewScale * activeShapeScale.x), scaleY: Math.max(.01, previewScale * activeShapeScale.y),
      startX: group.offsetX, startY: group.offsetY, groupKey: wardrobeGroupKey(group), characterId: selectedCharacter.id, beforeGroups, latest: null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (activeModule !== 'Roupas' || clothingSection !== 'Customizar' || !drag || drag.pointerId !== event.pointerId || !selectedCharacter || selectedCharacter.id !== drag.characterId) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    const nextGroups = groups.map((group) => wardrobeGroupKey(group) === drag.groupKey ? {
      ...group,
      offsetX: drag.startX + (event.clientX - drag.clientX) / drag.scaleX,
      offsetY: drag.startY + (event.clientY - drag.clientY) / drag.scaleY
    } : group)
    const nextCharacter = { ...selectedCharacter, customization: { ...selectedCharacter.customization, wardrobeGroups: nextGroups }, updatedAt: new Date().toISOString() }
    drag.latest = nextCharacter
    charactersRef.current = charactersRef.current.map((character) => character.id === nextCharacter.id ? nextCharacter : character)
    setCharacters((current) => current.map((character) => character.id === nextCharacter.id ? nextCharacter : character))
  }

  function finishWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clothingDragRef.current = null
    if (drag.latest) {
      recordWardrobeHistory(drag.beforeGroups, drag.latest.customization.wardrobeGroups ?? [])
      void saveCharacter(drag.latest)
    }
  }

  async function submitCharacterDialog(event: import('react').FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = nameDraft.trim()
    if (!name || savingCharacter) return
    setSavingCharacter(true)
    setCharactersError('')
    try {
      if (dialogMode === 'create') {
        const character = await window.desktop.createCustomizerCharacter(name)
        charactersRef.current = [...charactersRef.current, character]
        setCharacters((current) => [...current, character])
        setSelectedCharacterId(character.id)
        setActiveModule(null)
      } else if (dialogMode === 'rename' && selectedCharacter) {
        await saveCharacter({ ...selectedCharacter, name, updatedAt: new Date().toISOString() })
      }
      setDialogMode(null)
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
    } finally {
      setSavingCharacter(false)
    }
  }

  async function deleteSelectedCharacter() {
    if (!selectedCharacter || !window.confirm(`Excluir ${selectedCharacter.name}? Esta ação não remove modelos nem poses do Fabricador Dev.`)) return
    try {
      await window.desktop.deleteCustomizerCharacter(selectedCharacter.id)
      const remaining = characters.filter((character) => character.id !== selectedCharacter.id)
      charactersRef.current = remaining
      setCharacters(remaining)
      setSelectedCharacterId(remaining[0]?.id ?? '')
      setActiveModule(null)
      setCharactersError('')
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível excluir o personagem.')
    }
  }

  async function selectCatalogModel(model: NonNullable<FabricatorSlotSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogModelSlot(model.slot)
    setSelectedPosePage(0)
    setSelectedArtworkLabel(model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
      setSelectedCatalogPoseSlot(firstPose?.slot ?? null)
      setSelectedPoseCategory(firstPose ? resolvePoseCategory(firstPose) : 'Parado')
      await saveCharacterCustomization({ modelSlot: model.slot, poseSlot: firstPose?.slot ?? null })
      const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
      if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
      let artwork: CatalogArtwork | null = firstPose ? await window.desktop.loadFabricatorPose(model.slot, 1) : null
      if (!artwork) artwork = sourceProject
      if (!artwork) throw new Error('Não foi possível abrir este modelo.')
      const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter?.customization.modelSkinTone)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  async function selectCatalogPose(pose: NonNullable<FabricatorPoseSummary>) {
    const requestId = ++previewLoadRequest.current
    const nextCategory = resolvePoseCategory(pose)
    if (nextCategory !== selectedPoseCategory) setSelectedPosePage(0)
    setSelectedCatalogPoseSlot(pose.slot)
    setSelectedPoseCategory(nextCategory)
    setSelectedArtworkLabel(pose.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      await saveCharacterCustomization({ modelSlot: pose.sourceModelSlot, poseSlot: pose.slot })
      const sourceProject = selectedSourceModelProject?.slot === pose.sourceModelSlot ? selectedSourceModelProject : await window.desktop.loadFabricatorSlot(pose.sourceModelSlot)
      if (!sourceProject) throw new Error('O modelo de referência desta pose não está disponível.')
      const artwork = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
      if (!artwork) throw new Error('Não foi possível abrir esta pose.')
      const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter?.customization.modelSkinTone)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  const availableModels = catalogModels.filter((model): model is NonNullable<typeof model> => model !== null)
  const availablePoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot).sort((a, b) => a.slot - b.slot)
  const poseCategories = ['Parado', 'Sentado', ...new Set(availablePoses.map(resolvePoseCategory).filter((category) => category !== 'Parado' && category !== 'Sentado'))]
  const categoryPoses = availablePoses.filter((pose) => resolvePoseCategory(pose) === selectedPoseCategory)
  const posePageCount = Math.max(1, Math.ceil(categoryPoses.length / 5))
  const activePosePage = Math.min(selectedPosePage, posePageCount - 1)
  const visibleCategoryPoses = categoryPoses.slice(activePosePage * 5, activePosePage * 5 + 5)
  const showAdjacentPoseCategory = (direction: -1 | 1) => {
    const categoryIndex = poseCategories.indexOf(selectedPoseCategory)
    const nextCategory = poseCategories[(categoryIndex + direction + poseCategories.length) % poseCategories.length]
    setSelectedPoseCategory(nextCategory)
    setSelectedPosePage(0)
  }
  const showAdjacentPosePage = (direction: -1 | 1) => {
    setSelectedPosePage((current) => Math.max(0, Math.min(posePageCount - 1, current + direction)))
  }
  const selectedModelName = availableModels.find((model) => model.slot === selectedCatalogModelSlot)?.name
  const activeFaceAppearance = characterFaceAppearance?.modelSlot === selectedCatalogModelSlot ? characterFaceAppearance : undefined
  const wardrobeGroupDefinitions = clothingSection === 'Customizar' ? [] : clothingCategories[clothingSection]
  const wardrobeCategoryLabels: Record<ClothingGroupCategory, string> = { calca: 'Calças', shorts: 'Shorts', 'manga-inferior': 'Mangas inferiores', 'manga-superior': 'Mangas superiores', camisa: 'Camisas' }
  const activeWardrobeGroup = selectedClothing ? (selectedCharacter?.customization.wardrobeGroups ?? []).find((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category && (group.componentId === selectedClothing.componentId || !group.componentId)) : undefined
  const activeWardrobeTransform = wardrobeTransformDraft ?? activeWardrobeGroup
  const activeWardrobeComponent = selectedClothing ? wardrobeDetails[`${activeWardrobeGroup?.modelSlot ?? selectedCatalogModelSlot}:${selectedClothing.setId}`]?.components.find((component) => component.id === selectedClothing.componentId) : undefined
  const activeWardrobePartName = selectedSourceModelProject?.parts.find((part) => part.id === activeWardrobeComponent?.attachedPartId)?.name ?? activeWardrobeComponent?.name ?? 'Peça'
  const wardrobePreviewDraggable = activeModule === 'Roupas' && clothingSection === 'Customizar' && Boolean(activeWardrobeGroup)
  const appliedWardrobeEntries = [...(selectedCharacter?.customization.wardrobeGroups ?? [])]
    .filter((group) => group.modelSlot === selectedCatalogModelSlot)
    .flatMap((group) => {
      const set = wardrobeDetails[`${group.modelSlot}:${group.setId}`]
      const definition = Object.values(clothingCategories).flat().find((item) => item.id === group.category)
      if (!set || !definition) return []
      const components = set.components.filter((component) => definition.source.includes(component.category) && (!group.componentId || group.componentId === component.id))
      return components.map((component) => {
        const bodyPart = selectedSourceModelProject?.parts.find((part) => part.id === component.attachedPartId)
        const key = `${group.modelSlot}:${group.setId}:${group.category}:${component.id}`
        return { group, component, key, bodyPartName: bodyPart?.name ?? component.name }
      })
    })
    .sort((a, b) => ['calca', 'shorts', 'manga-inferior', 'manga-superior', 'camisa'].indexOf(a.group.category) - ['calca', 'shorts', 'manga-inferior', 'manga-superior', 'camisa'].indexOf(b.group.category))

  const renderHairCatalog = () => (
    <div className="customizer-hair-catalog">
      {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver os cabelos salvos.</div>
        : hairLoading ? <div className="customizer-catalog-empty">Carregando cabelos…</div>
          : hairStyles.length === 0 ? <div className="customizer-catalog-empty">Este modelo ainda não tem cabelos no catálogo. Importe e salve um cabelo em Cabelos Dev.</div>
            : <>
              <div className="customizer-hair-heading"><span><strong>Cabelos do Modelo {String(selectedCatalogModelSlot).padStart(2, '0')}</strong><small>Aplicação salva somente em {selectedCharacter?.name ?? 'este personagem'}.</small></span>
                {characterHairAppearance?.modelSlot === selectedCatalogModelSlot && hairAppearanceStyleId(characterHairAppearance, hairCatalogSide) && <button onClick={() => void chooseHairStyle(null, hairCatalogSide)} type="button"><Icon name="eyeOff" /> Remover {hairCatalogSide === 'front' ? 'frontal' : 'traseiro'}</button>}
              </div>
              <nav className="customizer-hair-tabs" aria-label="Categoria de cabelo">
                {([{ id: 'front', label: 'Frontal' }, { id: 'back', label: 'Traseiro' }] as const).map((category) => <button key={category.id} className={hairCatalogSide === category.id ? 'active' : ''} onClick={() => setHairCatalogSide(category.id)} aria-pressed={hairCatalogSide === category.id} type="button">{category.label}</button>)}
              </nav>
              <div className="customizer-hair-grid">{hairStyles.filter((summary) => summary[hairCatalogSide] !== null).map((summary) => {
                const detail = hairDetails[String(summary.modelSlot) + ':' + summary.id]
                const selected = characterHairAppearance?.modelSlot === summary.modelSlot && hairAppearanceStyleId(characterHairAppearance, hairCatalogSide) === summary.id
                const asset = detail?.[hairCatalogSide]
                return <button className={'customizer-hair-card' + (selected ? ' selected' : '')} key={summary.id} onClick={() => void chooseHairStyle(summary, hairCatalogSide)} aria-pressed={selected} title={'Aplicar cabelo ' + (hairCatalogSide === 'front' ? 'frontal' : 'traseiro') + ' em ' + (selectedCharacter?.name ?? 'personagem')} type="button">
                  <span className="customizer-hair-art">{asset && <img src={asset.dataUrl} alt="" />}{!asset && <span><Icon name="bow" /></span>}</span>
                  <b>{summary.name}</b><small>{selected ? 'Aplicado' : `Usar ${hairCatalogSide === 'front' ? 'frontal' : 'traseiro'}`}</small>
                </button>
              })}{hairStyles.every((summary) => summary[hairCatalogSide] === null) && <p className="customizer-face-empty">Nenhum cabelo {hairCatalogSide === 'front' ? 'frontal' : 'traseiro'} salvo para este modelo.</p>}</div>
            </>}
    </div>
  )

  const renderHairCustomizer = () => {
    const appearance = characterHairAppearance?.modelSlot === selectedCatalogModelSlot ? characterHairAppearance : undefined
    const colorOverrides = appearance?.colors ?? {}
    const renderPieceSelector = (part: typeof customizerHairParts[number]) => {
      const { side } = part
      const options = hairStyles.filter((summary) => summary[side] !== null)
      const selectedId = hairAppearancePartStyleId(appearance, part.id)
      const selectedIndex = options.findIndex((summary) => summary.id === selectedId)
      const selected = selectedIndex >= 0 ? options[selectedIndex] : null
      const asset = selected ? hairDetails[`${selected.modelSlot}:${selected.id}`]?.[side] : null
      const chooseAt = (index: number) => {
        if (!options.length) return
        const bounded = Math.max(0, Math.min(options.length - 1, index))
        void chooseHairPartStyle(part.id, options[bounded])
      }
      return <article className="customizer-hair-piece" key={part.id}>
        <header><strong>{part.label} {selectedIndex >= 0 ? `${selectedIndex + 1}/${options.length}` : `0/${options.length}`}</strong></header>
        <div className="customizer-hair-piece-selector">
          <button aria-label={`Peça anterior: ${part.label}`} onClick={() => chooseAt(selectedIndex < 0 ? options.length - 1 : selectedIndex - 1)} disabled={!options.length || selectedIndex <= 0} type="button"><Icon name="chevronRight" /></button>
          <div className="customizer-hair-piece-preview" aria-live="polite">
            {asset ? <img src={asset.dataUrl} alt={selected?.name ?? ''} /> : <span>{options.length ? 'Escolha uma peça' : 'Sem peças salvas'}</span>}
          </div>
          <button aria-label={`Próxima peça: ${part.label}`} onClick={() => chooseAt(selectedIndex < 0 ? 0 : selectedIndex + 1)} disabled={!options.length || selectedIndex >= options.length - 1} type="button"><Icon name="chevronRight" /></button>
          <div className="customizer-hair-piece-colors" aria-label={`Cores de ${part.label}`}>
            {hairColorControls.slice(0, 3).map((color) => <button key={color.id} className={activeHairColorRole === color.id ? 'active' : ''} style={{ '--hair-color-swatch': colorOverrides[color.id] ?? color.fallback } as React.CSSProperties} aria-label={`Editar ${color.label} de ${part.label}`} title={`Editar ${color.label}`} onClick={() => setActiveHairColorRole(color.id)} type="button"><Icon name="star" /></button>)}
          </div>
        </div>
      </article>
    }
    return <section className="customizer-hair-workspace" aria-label="Personalização do cabelo">
      {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para carregar os cabelos do Fabricador Dev.</div>
        : hairLoading ? <div className="customizer-catalog-empty">Carregando cabelos do Fabricador Dev…</div>
          : <>
            <div className="customizer-hair-layout">
            <div className="customizer-hair-color-controls" aria-label="Cores do cabelo">
              {hairColorControls.map((color) => <label className="customizer-hair-color-control" data-role={color.id} key={color.id} title={`${color.label} · recolore a faixa de tons correspondente da imagem`}>
                <span>{color.id === 'base' ? 'Todas base' : color.id === 'fade' ? 'Todas degradê' : color.id === 'outline' ? 'Contorno' : color.id === 'highlight' ? 'High. Color' : 'Acc. Color'}</span><input className={activeHairColorRole === color.id ? 'active' : ''} type="color" aria-label={color.label} value={colorOverrides[color.id] ?? color.fallback} disabled={!selectedCharacter} onFocus={() => setActiveHairColorRole(color.id)} onChange={(event) => void setHairColor(color.id, event.target.value)} />
              </label>)}
            </div>
            {customizerHairParts.map(renderPieceSelector)}
            </div>
          </>}
    </section>
  }

  if (activeModule !== null && modules.some((module) => module.name === activeModule)) {
    return (
      <div className="customizer-models-view">
        <div className="customizer-models-columns">
          <section className="customizer-model-preview" aria-label="Prévia do personagem">
            <div className="stage-wrap">
              <div className="stage-scene" style={previewStyle}>
                <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
                <button className="customizer-back-button customizer-preview-back" onClick={() => setActiveModule(null)} type="button"><span aria-hidden="true">←</span> Customizar</button>
                <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                  <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                  <span className="preview-color-label">Fundo da prévia</span>
                  <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
                </label>
                <div className="stage-tools" aria-label="Controles do preview">
                  <button aria-label="Ajustar enquadramento" type="button"><Icon name="frame" /></button>
                  <button aria-label="Aproximar" type="button"><Icon name="zoomIn" /></button>
                  <button aria-label="Afastar" type="button"><Icon name="zoomOut" /></button>
                </div>
                {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>Nenhum modelo salvo para mostrar.</span></div>}
              {selectedWardrobeUrl && selectedArtworkUrl && <img className={'customizer-wardrobe-overlay' + (wardrobePreviewDraggable ? ' draggable' : '')} src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={wardrobePreviewDraggable ? beginWardrobeDrag : undefined} onPointerMove={wardrobePreviewDraggable ? moveWardrobeDrag : undefined} onPointerUp={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} onPointerCancel={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} />}
              {selectedFaceUrl && selectedArtworkUrl && <img className="customizer-face-overlay" src={selectedFaceUrl} alt="Rosto do personagem" draggable={false} />}
              {activeModule === 'Roupas' && clothingSection === 'Customizar' && wardrobeHighlightVisible && selectedWardrobeHighlightUrl && <img className="customizer-wardrobe-selection-halo" src={selectedWardrobeHighlightUrl} alt="Peça de roupa selecionada" draggable={false} />}
              {selectedFrontHairUrl && selectedArtworkUrl && <img className="customizer-front-hair-overlay" src={selectedFrontHairUrl} alt="Cabelo frontal" draggable={false} />}
                {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
                <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'DO CATÁLOGO' : 'PERSONAGEM ATIVO'}</small></div>
              </div>
            </div>
          </section>
          <section className="customizer-models-sidebar" aria-label="Categorias de personalização">
            <nav className="customizer-top-tabs" aria-label="Áreas do Customizar" role="tablist">
              {customizerTopTabs.map((tab) => <button
                key={tab.id}
                className={selectedCustomizerTopTab === tab.id ? 'active' : ''}
                onClick={() => {
                  setSelectedCustomizerTopTab(tab.id)
                  const moduleByTab: Record<string, string> = { modelos: 'Modelos', corpo: 'Modelos', cabeca: 'Cabeça', roupas: 'Roupas', outros: 'Acessórios', perfil: 'Perfil' }
                  setActiveModule(moduleByTab[tab.id])
                }}
                aria-selected={selectedCustomizerTopTab === tab.id}
                role="tab"
                type="button"
              ><CustomizerCategoryIcon category={tab.id} /><span>{tab.label}</span></button>)}
            </nav>
            {selectedCustomizerTopTab === 'cabeca' && <nav className="customizer-head-category-tabs" aria-label="Categorias de cabeça" role="tablist">
              {customizerHeadTabs.map((tab) => <button key={tab.id} className={headPanelTab === tab.id ? 'active' : ''} onClick={() => {
                setHeadPanelTab(tab.id)
                if (tab.id === 'eyes') setFaceCategory('eyes')
                else if (tab.id === 'face') setFaceCategory('nose')
              }} aria-selected={headPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
            </nav>}
            {selectedCustomizerTopTab === 'roupas' && <nav className="customizer-clothes-category-tabs" aria-label="Categorias de roupas" role="tablist">
              {customizerClothesTabs.map((tab) => <button key={tab.id} className={clothesPanelTab === tab.id ? 'active' : ''} onClick={() => {
                setClothesPanelTab(tab.id)
                if (tab.id === 'upper') setClothingSection('Superior')
                else if (tab.id === 'lower') setClothingSection('Inferior')
                else if (tab.id === 'adjust') setClothingSection('Customizar')
              }} aria-selected={clothesPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
            </nav>}
            {selectedCustomizerTopTab === 'outros' && <nav className="customizer-other-category-tabs" aria-label="Categorias de outros itens" role="tablist">
              {customizerOtherTabs.map((tab) => <button key={tab.id} className={otherPanelTab === tab.id ? 'active' : ''} onClick={() => setOtherPanelTab(tab.id)} aria-selected={otherPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
            </nav>}
            <div className={`customizer-sidebar-scroll-content${selectedCustomizerTopTab === 'cabeca' && headPanelTab === 'hair' ? ' customizer-sidebar-scroll-content-hair' : ''}`} aria-label={`Conteúdo de ${customizerTopTabs.find((tab) => tab.id === selectedCustomizerTopTab)?.label ?? 'personalização'}`}>
            {selectedCustomizerTopTab === 'cabeca' && headPanelTab === 'hair' && renderHairCustomizer()}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-model-skin-tones" aria-label="Cor de pele do modelo">
              <strong>Cor de pele</strong>
              <div className="customizer-model-skin-tone-row" role="group" aria-label="Escolher cor de pele">
                {customizerSkinTonePresets.map((preset) => {
                  const selected = (selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id) === preset.id
                  return <button key={preset.id} className={'customizer-model-skin-tone' + (selected ? ' selected' : '')} style={{ '--skin-tone': preset.id } as React.CSSProperties} onClick={() => void saveCharacterCustomization({ modelSkinTone: preset.id })} aria-label={`Tom de pele ${preset.name}`} aria-pressed={selected} title={preset.name} type="button" disabled={!selectedCharacter}><span />{selected && <Icon name="check" />}</button>
                })}
                <label className={'customizer-model-skin-picker' + (selectedCharacter && !customizerSkinTonePresets.some((preset) => preset.id === (selectedCharacter.customization.modelSkinTone ?? skinTonePresets[0].id)) ? ' selected' : '')} title="Escolher uma cor personalizada">
                  <input type="color" aria-label="Escolher cor de pele personalizada" value={selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id} onChange={(event) => void saveCharacterCustomization({ modelSkinTone: event.target.value })} disabled={!selectedCharacter} />
                  <span className="customizer-model-skin-picker-swatch" style={{ '--skin-tone': selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id } as React.CSSProperties}><Icon name="brush" /></span>
                </label>
              </div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-pose-carousel" aria-label="Pose do modelo">
              <header className="customizer-pose-carousel-heading" aria-live="polite">
                <strong>{selectedPoseCategory} · Página {activePosePage + 1}{posePageCount > 1 ? ` de ${posePageCount}` : ''}</strong>
              </header>
              <div className="customizer-pose-carousel-body">
                <div className="customizer-pose-carousel-nav" role="group" aria-label="Navegação à esquerda">
                  <button className="customizer-pose-carousel-arrow category" aria-label="Categoria anterior" title="Categoria anterior" onClick={() => showAdjacentPoseCategory(-1)} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 2 0 16l13 14v-8h19V10H13z" /></svg></button>
                  <button className="customizer-pose-carousel-arrow page" aria-label="Página anterior de poses" title="Página anterior" onClick={() => showAdjacentPosePage(-1)} disabled={activePosePage === 0} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 2 0 16l13 14v-8h19V10H13z" /></svg></button>
                </div>
                <div className="customizer-pose-carousel-poses">
                  {visibleCategoryPoses.map((pose) => <button className={`customizer-pose-carousel-image${selectedCatalogPoseSlot === pose.slot ? ' selected' : ''}`} key={`${pose.sourceModelSlot}:${pose.slot}`} onClick={() => void selectCatalogPose(pose)} disabled={!selectedCharacter || previewLoading} title={`Pose ${String(pose.slot).padStart(2, '0')}: ${pose.name}`} aria-label={`Selecionar pose ${String(pose.slot).padStart(2, '0')}`} aria-pressed={selectedCatalogPoseSlot === pose.slot} type="button">{poseThumbnails[`${pose.sourceModelSlot}:${pose.slot}`] ? <img src={poseThumbnails[`${pose.sourceModelSlot}:${pose.slot}`]} alt="" /> : <span>Pose {String(pose.slot).padStart(2, '0')}</span>}</button>)}
                  {Array.from({ length: Math.max(0, 5 - visibleCategoryPoses.length) }, (_, index) => <span className="customizer-pose-carousel-empty" key={`empty-${index}`} />)}
                </div>
                <div className="customizer-pose-carousel-nav" role="group" aria-label="Navegação à direita">
                  <button className="customizer-pose-carousel-arrow category" aria-label="Próxima categoria" title="Próxima categoria" onClick={() => showAdjacentPoseCategory(1)} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 2 32 16 19 30v-8H0V10h19z" /></svg></button>
                  <button className="customizer-pose-carousel-arrow page" aria-label="Próxima página de poses" title="Próxima página" onClick={() => showAdjacentPosePage(1)} disabled={activePosePage >= posePageCount - 1} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 2 32 16 19 30v-8H0V10h19z" /></svg></button>
                </div>
              </div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-proportions" aria-label="Proporções do personagem">
              <header><strong>Proporções</strong><button onClick={() => commitProportions({ ...defaultCharacterProportions })} disabled={!selectedCharacter} type="button">Restaurar</button></header>
              <div className="customizer-proportions-grid">{proportionControls.map(({ key, label, description }) => {
                const limits = characterProportionLimits[key]
                return <div className="customizer-proportion-control" key={key} title={description}>
                  <div className="customizer-proportion-heading"><label htmlFor={`character-proportion-${key}`}>{label}</label><output>{activeProportions[key]}%</output></div>
                  <div className="customizer-proportion-inputs">
                    <button aria-label={`Diminuir ${label.toLowerCase()}`} disabled={!selectedCharacter || activeProportions[key] <= limits.min} onClick={() => commitProportion(key, activeProportions[key] - 1)} type="button">−</button>
                    <input id={`character-proportion-${key}`} type="range" min={limits.min} max={limits.max} step="1" value={activeProportions[key]} disabled={!selectedCharacter} onChange={(event) => changeProportion(key, Number(event.target.value))} onPointerUp={(event) => commitProportion(key, Number(event.currentTarget.value))} onPointerCancel={(event) => commitProportion(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitProportion(key, Number(event.currentTarget.value))} onBlur={(event) => commitProportion(key, Number(event.currentTarget.value))} />
                    <button aria-label={`Aumentar ${label.toLowerCase()}`} disabled={!selectedCharacter || activeProportions[key] >= limits.max} onClick={() => commitProportion(key, activeProportions[key] + 1)} type="button">+</button>
                  </div>
                </div>
              })}</div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-body-shape" aria-label="Ajuste de largura e altura das partes do corpo">
              <header><span><strong>Corpo · tronco e membros</strong><small>As peças acompanham as juntas, com ajustes separados para coxas e pernas inferiores.</small></span><button onClick={() => { setBodyDimensionEdit(selectedCharacter ? { characterId: selectedCharacter.id, values: { ...defaultCharacterBodyDimensions } } : null); commitBodyDimensions({ ...defaultCharacterBodyDimensions }) }} disabled={!selectedCharacter} type="button">Restaurar</button></header>
              <div className="customizer-body-shape-grid">{([
                { name: 'Tronco', width: 'torsoWidth', height: 'torsoHeight' },
                { name: 'Braços', width: 'armsWidth', height: 'armsHeight' },
                { name: 'Coxas', width: 'thighsWidth', height: 'thighsHeight' },
                { name: 'Pernas inferiores', width: 'lowerLegsWidth', height: 'lowerLegsHeight' }
              ] as const).map(({ name, width, height }) => <fieldset className="customizer-body-part" key={name}>
                <legend>{name}</legend>
                {([['width', width, 'Largura'], ['height', height, 'Altura']] as const).map(([axis, key, label]) => {
                  const limits = characterBodyDimensionLimits[key]
                  const finish = (value: number) => commitBodyDimension(key, value)
                  return <label className="customizer-body-axis" key={axis}><span>{label}<output>{activeBodyDimensions[key]}%</output></span><div className="customizer-proportion-inputs"><button aria-label={`Diminuir ${label.toLowerCase()} de ${name}`} disabled={!selectedCharacter || activeBodyDimensions[key] <= limits.min} onClick={() => finish(activeBodyDimensions[key] - 1)} type="button">−</button><input aria-label={`${label} de ${name}`} type="range" min={limits.min} max={limits.max} step="1" value={activeBodyDimensions[key]} disabled={!selectedCharacter} onChange={(event) => changeBodyDimension(key, Number(event.target.value))} onPointerUp={(event) => finish(Number(event.currentTarget.value))} onPointerCancel={(event) => finish(Number(event.currentTarget.value))} onKeyUp={(event) => finish(Number(event.currentTarget.value))} onBlur={(event) => finish(Number(event.currentTarget.value))} /><button aria-label={`Aumentar ${label.toLowerCase()} de ${name}`} disabled={!selectedCharacter || activeBodyDimensions[key] >= limits.max} onClick={() => finish(activeBodyDimensions[key] + 1)} type="button">+</button></div></label>
                })}
              </fieldset>)}</div>
              <label className="customizer-body-balance"><span><b>Harmonia corporal</b><output>{activeBodyDimensions.balance}%</output></span><small>Coxas maiores aumentam um pouco o tronco; tronco maior aumenta um pouco braços e pernas. Em 0%, só o controle escolhido muda de tamanho.</small><input aria-label="Harmonia corporal" type="range" min="0" max="100" step="1" value={activeBodyDimensions.balance} disabled={!selectedCharacter} onChange={(event) => changeBodyDimension('balance', Number(event.target.value))} onPointerUp={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onPointerCancel={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onKeyUp={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onBlur={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} /></label>
            </section>}
            </div>
            <div className="customizer-models-content" hidden>
            <div className="customizer-models-options-grid">
              {modules.map((module, index) => (
                <button
                  className={`customizer-model-option${activeModule === module.name ? ' selected' : ''}`}
                  key={module.name}
                  onClick={() => {
                    setActiveModule(module.name)
                    if (module.name === 'Modelos' && selectedCatalogModelSlot !== null) {
                      const selectedModel = availableModels.find((model) => model.slot === selectedCatalogModelSlot)
                      if (selectedModel) void selectCatalogModel(selectedModel)
                    }
                  }}
                  aria-pressed={activeModule === module.name}
                  title={module.detail}
                  type="button"
                >
                  <span className="customizer-model-option-icon"><Icon name={module.icon} /></span>
                  <span className="customizer-model-option-name">{module.name}</span>
                  {index === 0 && <span className="customizer-model-option-new">NOVO</span>}
                </button>
              ))}
            </div>
            <section className="customizer-catalog-panel" aria-label={'Catálogo de ' + activeModule}>
              <header className="customizer-catalog-heading">
                <div><p className="eyebrow">CATÁLOGO</p><h2>{activeModule === 'Poses' ? selectedModelName ?? 'Escolha um modelo' : activeModule}</h2></div>
                {activeModule === 'Modelos' && <small>{availableModels.length} modelos</small>}
                {activeModule === 'Poses' && selectedCatalogModelSlot !== null && <small>{availablePoses.length} poses</small>}
              </header>
              {catalogError && <p className="customizer-catalog-error" role="alert">{catalogError}</p>}
              {activeModule === 'Modelos' && (
                catalogLoading ? <div className="customizer-catalog-empty">Carregando modelos…</div>
                  : availableModels.length === 0 ? <div className="customizer-catalog-empty">Nenhum modelo salvo ainda.</div>
                    : <div className="customizer-catalog-grid customizer-model-catalog">
                      {availableModels.map((model) => (
                        <button className={'customizer-catalog-card model-catalog-card' + (selectedCatalogModelSlot === model.slot ? ' selected' : '')} key={model.slot} onClick={() => void selectCatalogModel(model)} aria-label={'Selecionar ' + model.name} aria-pressed={selectedCatalogModelSlot === model.slot} title={model.name} type="button">
                          {modelThumbnails[model.slot] ? <img src={modelThumbnails[model.slot]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                        </button>
                      ))}
                    </div>
              )}
              {activeModule === 'Modelos' && selectedCharacter && selectedCatalogModelSlot !== null && <section className="customizer-skin-tones" aria-label="Cor de pele do personagem">
                <header><strong>Cor da pele</strong><small>Salva somente em {selectedCharacter.name}</small></header>
                <div className="customizer-skin-tone-options" role="group" aria-label="Escolher tom de pele">
                  {skinTonePresets.map((preset) => {
                    const selected = selectedCharacter.customization.modelSkinTone === preset.id
                    return <button key={preset.id} className={'customizer-skin-tone' + (selected ? ' selected' : '')} style={{ '--skin-tone': preset.id } as React.CSSProperties} onClick={() => void saveCharacterCustomization({ modelSkinTone: preset.id })} aria-label={`Tom de pele ${preset.name}`} aria-pressed={selected} title={preset.name} type="button"><span />{selected && <Icon name="check" />}</button>
                  })}
                </div>
              </section>}
              {activeModule === 'Poses' && (
                selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty"><span>Selecione um modelo para ver as poses dele.</span><button onClick={() => setActiveModule('Modelos')} type="button">Ver modelos</button></div>
                  : catalogLoading ? <div className="customizer-catalog-empty">Carregando poses…</div>
                    : availablePoses.length === 0 ? <div className="customizer-catalog-empty">Este modelo ainda não tem poses salvas.</div>
                      : <div className="customizer-catalog-grid customizer-pose-catalog">
                        {availablePoses.map((pose) => {
                          const key = pose.sourceModelSlot + ':' + pose.slot
                          return <button className={'customizer-catalog-card pose-catalog-card' + (selectedCatalogPoseSlot === pose.slot ? ' selected' : '')} key={key} onClick={() => void selectCatalogPose(pose)} aria-pressed={selectedCatalogPoseSlot === pose.slot} title={pose.name} type="button">
                            {poseThumbnails[key] ? <img src={poseThumbnails[key]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                            <span className="customizer-pose-caption"><b>Pose {String(pose.slot).padStart(2, '0')}</b><small>{pose.name}</small></span>
                          </button>
                        })}
                      </div>
              )}
              {activeModule === 'Cabeça' && <div className="customizer-head-workspace">
                <nav className="customizer-head-tabs" aria-label="Categorias da cabeça" role="tablist">
                  {customizerHeadTabs.map((tab) => <button key={tab.id} className={headPanelTab === tab.id ? 'active' : ''} onClick={() => {
                    setHeadPanelTab(tab.id)
                    if (tab.id === 'eyes') setFaceCategory('eyes')
                    else if (tab.id === 'face') setFaceCategory('nose')
                  }} aria-selected={headPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
                </nav>
                {headPanelTab === 'hair' && renderHairCatalog()}
                {(headPanelTab === 'eyes' || headPanelTab === 'face') && <div className="customizer-face-catalog">
                {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver as peças faciais.</div>
                  : faceLoading ? <div className="customizer-catalog-empty">Carregando catálogo facial…</div>
                    : <>
                      <nav className="customizer-face-tabs" aria-label="Categorias do rosto">
                        {(headPanelTab === 'eyes' ? [{ id: 'eyes', label: 'Olhos' }, { id: 'eyebrows', label: 'Sobrancelhas' }] : [{ id: 'nose', label: 'Nariz' }, { id: 'mouth', label: 'Boca' }]).map((category) => <button key={category.id} className={faceCategory === category.id ? 'active' : ''} onClick={() => setFaceCategory(category.id as typeof faceCategory)} type="button">{category.label}</button>)}
                      </nav>
                      {faceCategory === 'mouth' && <div className="customizer-face-mouth-tabs"><button className={!activeFaceAppearance?.mouthOpen ? 'active' : ''} onClick={() => void setFaceCatalogVariant({ mouthOpen: false })} type="button">Fechadas</button><button className={activeFaceAppearance?.mouthOpen ? 'active' : ''} onClick={() => void setFaceCatalogVariant({ mouthOpen: true })} type="button">Abertas</button></div>}
                      {(() => {
                        const category: FaceSheetKind = faceCategory === 'mouth' ? activeFaceAppearance?.mouthOpen ? 'mouth-open' : 'mouth-closed' : faceCategory
                        const selectedId = category === 'eyes' ? activeFaceAppearance?.eyeCatalogId : category === 'eyebrows' ? activeFaceAppearance?.eyebrowCatalogId : category === 'nose' ? activeFaceAppearance?.noseCatalogId : category === 'mouth-open' ? activeFaceAppearance?.mouthOpenCatalogId : activeFaceAppearance?.mouthClosedCatalogId
                        const items = faceCatalogItems.filter((item) => item.category === category)
                        const activeItem = selectedId ? faceCatalogDetails[`${selectedCatalogModelSlot}:${selectedId}`] : null
                        return <>
                          <section className="customizer-face-sets" aria-label={`Catálogo de ${category}`}>
                            <header><h3>{category === 'eyes' ? 'Folhas de olhos' : category === 'eyebrows' ? 'Folhas de sobrancelhas' : category === 'nose' ? 'Folhas de nariz' : category === 'mouth-open' ? 'Folhas de bocas abertas' : 'Folhas de bocas fechadas'}</h3><small>Variantes e encaixe salvos em cada folha</small></header>
                            {items.length === 0 ? <p className="customizer-face-empty">Nenhuma folha salva nesta categoria no Fabricador Dev.</p> : <div className="customizer-face-set-list">{items.map((summary) => {
                              const detail = faceCatalogDetails[`${summary.modelSlot}:${summary.id}`]
                              const selected = selectedId === summary.id
                              const samples = detail?.pieces.filter((piece) => piece.index === 0 && (category !== 'eyes' && category !== 'eyebrows' || piece.side === 'left' || piece.side === 'right')) ?? []
                              return <button className={'customizer-face-set' + (selected ? ' selected' : '')} key={summary.id} onClick={() => void chooseFaceCatalogItem(summary)} aria-pressed={selected} title={summary.name} type="button"><span>{samples.slice(0, 2).map((piece) => <img key={piece.id} src={piece.dataUrl} alt="" />)}{samples.length === 0 && <Icon name="face" />}</span><b>{summary.name}</b></button>
                            })}</div>}
                          </section>
                          {activeItem && activeFaceAppearance && <section className="customizer-face-options" aria-label="Variantes da folha selecionada">
                            {category === 'eyes' && <div className="customizer-face-grid">{[0, 1, 2].map((index) => {
                              const pieces = activeItem.pieces.filter((piece) => piece.index === index)
                              const labels = ['Olhando para direita', 'Olhando para esquerda', 'Olhos fechados']
                              return <button className={'customizer-face-option' + (activeFaceAppearance.eyeState === index ? ' selected' : '')} key={index} onClick={() => void setFaceCatalogVariant({ eyeState: index as 0 | 1 | 2 })} aria-pressed={activeFaceAppearance.eyeState === index} type="button"><span>{pieces.map((piece) => <img key={piece.id} src={piece.dataUrl} alt="" />)}</span><b>{labels[index]}</b></button>
                            })}</div>}
                            {category === 'eyebrows' && <button className={'customizer-face-option customizer-face-toggle' + (activeFaceAppearance.eyebrows ? ' selected' : '')} onClick={() => void setFaceCatalogVariant({ eyebrows: !activeFaceAppearance.eyebrows })} aria-pressed={activeFaceAppearance.eyebrows} type="button"><span>{activeItem.pieces.filter((piece) => piece.index === 0).map((piece) => <img key={piece.id} src={piece.dataUrl} alt="" />)}</span><b>{activeFaceAppearance.eyebrows ? 'Sobrancelhas visíveis' : 'Sobrancelhas ocultas'}</b></button>}
                            {category === 'nose' && <div className="customizer-face-grid">{activeItem.pieces.map((piece) => <button className={'customizer-face-option' + (activeFaceAppearance.noseIndex === piece.index ? ' selected' : '')} key={piece.id} onClick={() => void setFaceCatalogVariant({ noseIndex: piece.index })} aria-pressed={activeFaceAppearance.noseIndex === piece.index} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>Nariz {piece.index + 1}</b></button>)}</div>}
                            {category.startsWith('mouth') && <div className="customizer-face-grid">{activeItem.pieces.map((piece) => <button className={'customizer-face-option' + (activeFaceAppearance.expressionIndex === piece.index ? ' selected' : '')} key={piece.id} onClick={() => void setFaceCatalogVariant({ expressionIndex: piece.index })} aria-pressed={activeFaceAppearance.expressionIndex === piece.index} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>Boca {String(piece.index + 1).padStart(2, '0')}</b></button>)}</div>}
                          </section>}
                          {activeFaceAppearance && <p className="customizer-face-empty">As escolhas e os encaixes são salvos somente para {selectedCharacter?.name ?? 'este personagem'}.</p>}
                        </>
                      })()}
                    </>}
                </div>}
                {headPanelTab === 'extra' && <div className="customizer-head-placeholder"><Icon name="sparkles" /><strong>Extras da cabeça</strong><span>Esta área ficará pronta quando o catálogo de extras estiver integrado.</span></div>}
                {headPanelTab === 'adjust' && <div className="customizer-head-placeholder"><Icon name="sliders" /><strong>Ajustes da cabeça</strong><span>Os controles de ajuste por peça serão organizados aqui.</span></div>}
              </div>}
              {activeModule === 'Cabelos' && renderHairCatalog()}
              {activeModule === 'Roupas' && <div className="customizer-wardrobe-catalog">
                {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver as roupas salvas dele.</div>
                  : wardrobeLoading ? <div className="customizer-catalog-empty">Carregando roupas…</div>
                    : <>
                      <div className="customizer-wardrobe-toolbar">
                        <button className={`customizer-wardrobe-customize-tab${clothingSection === 'Customizar' ? ' active' : ''}`} onClick={() => setClothingSection((current) => current === 'Customizar' ? 'Superior' : 'Customizar')} aria-pressed={clothingSection === 'Customizar'} type="button"><Icon name="sliders" /> Customizar</button>
                        {clothingSection === 'Customizar' && <div className="customizer-wardrobe-history" aria-label="Histórico da customização">
                          <button className="model-history-button" title="Desfazer" aria-label="Desfazer" disabled={!wardrobeHistory.undo.length || wardrobeHistory.characterId !== selectedCharacter?.id} onClick={() => void restoreWardrobeHistory('undo')} type="button"><Icon name="undo" /></button>
                          <button className="model-history-button" title="Refazer" aria-label="Refazer" disabled={!wardrobeHistory.redo.length || wardrobeHistory.characterId !== selectedCharacter?.id} onClick={() => void restoreWardrobeHistory('redo')} type="button"><Icon name="redo" /></button>
                        </div>}
                      </div>
                      <div className="customizer-wardrobe-tabs" role="tablist" aria-label="Tipo de roupa">
                        {(['Superior', 'Inferior'] as const).map((section) => <button key={section} className={clothingSection === section ? 'active' : ''} role="tab" aria-selected={clothingSection === section} onClick={() => setClothingSection(section)} type="button">{section}</button>)}
                      </div>
                      {clothingSection === 'Customizar' ? <div className="customizer-wardrobe-editor">
                        <section className="customizer-wardrobe-applied" aria-label="Roupas aplicadas neste personagem">
                          <header><h3>Itens selecionados</h3><small>De baixo para cima</small></header>
                          {appliedWardrobeEntries.length === 0 ? <p className="customizer-wardrobe-empty">Escolha roupas em Superior ou Inferior para começar.</p>
                            : <div className="customizer-wardrobe-applied-grid">{appliedWardrobeEntries.map(({ group, component, key, bodyPartName }) => {
                              const selected = selectedClothing?.setId === group.setId && selectedClothing.category === group.category && selectedClothing.componentId === component.id
                              return <article className={'customizer-wardrobe-applied-item' + (selected ? ' selected' : '')} key={key}>
                                <button onClick={() => { setSelectedClothing({ setId: group.setId, category: group.category, componentId: component.id }); setWardrobeHighlightVisible(true) }} aria-pressed={selected} title={`${wardrobeCategoryLabels[group.category]} · ${bodyPartName}`} type="button">
                                  <img src={component.dataUrl} alt="" />
                                  <span className="customizer-wardrobe-piece-label"><b>{wardrobeCategoryLabels[group.category]}</b><small>{bodyPartName}</small></span>
                                </button>
                                <button className="customizer-wardrobe-applied-remove" onClick={() => void removeWardrobeGroup(group.setId, group.category, component.id)} aria-label={`Remover ${wardrobeCategoryLabels[group.category]} · ${bodyPartName}`} title="Remover" type="button"><Icon name="trash" /></button>
                              </article>
                            })}</div>}
                        </section>
                        <section className="customizer-wardrobe-controls" aria-label="Controles da roupa selecionada">
                          {activeWardrobeGroup && activeWardrobeTransform ? <>
                            <header><h3>{wardrobeCategoryLabels[activeWardrobeGroup.category]} · {activeWardrobePartName}</h3><small>Esta peça e este personagem serão alterados.</small></header>
                            <div className="customizer-wardrobe-position-grid">
                              {([['offsetX', 'Posição X'], ['offsetY', 'Posição Y']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step="1" value={Number(activeWardrobeTransform[field].toFixed(1))} onChange={(event) => changeWardrobeTransform({ [field]: Number(event.target.value) })} onBlur={commitWardrobeTransform} onKeyDown={(event) => { if (event.key === 'Enter') { commitWardrobeTransform(); event.currentTarget.blur() } }} /></label>)}
                            </div>
                            {([['scaleX', 'Escala horizontal'], ['scaleY', 'Escala vertical']] as const).map(([field, label]) => <label className="customizer-wardrobe-range" key={field}><span><b>{label}</b><output>{Math.round(activeWardrobeTransform[field] * 100)}%</output></span><input type="range" min="10" max="500" step="1" value={Math.max(10, Math.min(500, Math.round(activeWardrobeTransform[field] * 100)))} onChange={(event) => changeWardrobeTransform({ [field]: Number(event.target.value) / 100 })} onPointerUp={commitWardrobeTransform} onBlur={commitWardrobeTransform} /></label>)}
                            <label className="customizer-wardrobe-range"><span><b>Rotação</b><output>{Math.round(activeWardrobeTransform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={Math.max(-180, Math.min(180, Math.round(activeWardrobeTransform.rotation)))} onChange={(event) => changeWardrobeTransform({ rotation: Number(event.target.value) })} onPointerUp={commitWardrobeTransform} onBlur={commitWardrobeTransform} /></label>
                            <div className="customizer-wardrobe-nudge" aria-label="Mover roupa">
                              <button aria-label="Mover para cima" onClick={() => void adjustWardrobeGroup({ offsetY: activeWardrobeTransform.offsetY - 4 })} type="button">↑</button>
                              <button aria-label="Mover para esquerda" onClick={() => void adjustWardrobeGroup({ offsetX: activeWardrobeTransform.offsetX - 4 })} type="button">←</button>
                              <span>Mover</span>
                              <button aria-label="Mover para direita" onClick={() => void adjustWardrobeGroup({ offsetX: activeWardrobeTransform.offsetX + 4 })} type="button">→</button>
                              <button aria-label="Mover para baixo" onClick={() => void adjustWardrobeGroup({ offsetY: activeWardrobeTransform.offsetY + 4 })} type="button">↓</button>
                            </div>
                            <button className="customizer-wardrobe-reset" onClick={() => void adjustWardrobeGroup({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 })} type="button">Resetar ajustes desta roupa</button>
                          </> : <div className="customizer-wardrobe-empty">Selecione uma roupa na lista para ajustar.</div>}
                        </section>
                      </div> : <div className="customizer-wardrobe-groups">
                          {wardrobeGroupDefinitions.map((definition) => {
                            const matches = wardrobeSets.filter((summary) => wardrobeDetails[`${summary.modelSlot}:${summary.id}`]?.components.some((component) => definition.source.includes(component.category)))
                            return <section className="customizer-wardrobe-category" key={definition.id} aria-label={definition.label}>
                              <header><h3>{definition.label}</h3><span>{matches.length}</span></header>
                              {matches.length === 0 ? <p className="customizer-wardrobe-empty">Nenhum conjunto salvo nesta categoria.</p>
                                : <div className="customizer-wardrobe-items">{matches.map((summary) => {
                                  const key = `${summary.modelSlot}:${summary.id}:${definition.id}`
                                  const applied = (selectedCharacter?.customization.wardrobeGroups ?? []).some((group) => group.modelSlot === summary.modelSlot && group.setId === summary.id && group.category === definition.id)
                                  const selected = selectedClothing?.setId === summary.id && selectedClothing.category === definition.id
                                  return <article className={'customizer-wardrobe-item' + (selected ? ' selected' : '')} key={key}>
                                    <button className="customizer-wardrobe-select" onClick={() => void applyWardrobeGroup(summary, definition.id)} aria-label={`${applied ? 'Selecionar' : 'Usar'} conjunto de ${definition.label.toLowerCase()}`} aria-pressed={selected} title={definition.id === 'calca' ? 'Calça completa: coxas e canelas juntas' : definition.label} type="button">
                                      {wardrobeThumbnails[key] ? <img src={wardrobeThumbnails[key]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="shirt" /></span>}
                                    </button>
                                    {applied && <button className="customizer-wardrobe-remove" onClick={() => void removeWardrobeGroup(summary.id, definition.id)} aria-label="Remover roupa deste personagem" title="Remover" type="button"><Icon name="trash" /></button>}
                                  </article>
                                })}</div>}
                            </section>
                          })}
                      </div>}
                    </>}
              </div>}
              {activeModule !== 'Modelos' && activeModule !== 'Poses' && activeModule !== 'Roupas' && <div className="customizer-catalog-empty">O catálogo de {activeModule} aparecerá aqui.</div>}
            </section>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="home-layout">
        <aside className="roster-panel panel" aria-label="Personagens">
          <div className="panel-heading roster-heading">
            <div>
              <p className="eyebrow">SUA COLEÇÃO</p>
              <h2>Personagens <span>{characters.length.toString().padStart(2, '0')}</span></h2>
            </div>
            {selectedCharacter && <button className="icon-button roster-delete-button" aria-label={'Excluir ' + selectedCharacter.name} title="Excluir personagem" onClick={() => void deleteSelectedCharacter()} type="button"><Icon name="trash" /></button>}
            <button className="icon-button add-button" aria-label="Adicionar personagem" onClick={() => { setNameDraft(''); setDialogMode('create') }} type="button">
              <Icon name="plus" />
            </button>
          </div>
          <label className="roster-search">
            <Icon name="search" />
            <input aria-label="Buscar personagem" placeholder="Buscar personagem" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} />
            <kbd>/</kbd>
          </label>
          <div className="character-grid">
            {visibleCharacters.map((character) => (
              <button
                className={`character-card ${selectedCharacter?.id === character.id ? 'selected' : ''}`}
                key={character.id}
                onClick={() => selectCharacter(character.id)}
                aria-pressed={selectedCharacter?.id === character.id}
              >
                <CharacterPortrait character={character} />
                <span>{character.name}</span>
              </button>
            ))}
            {charactersLoading && <p className="empty-roster">Carregando personagens…</p>}
            {!charactersLoading && characters.length === 0 && <p className="empty-roster">Sua coleção está vazia. Use + para criar o primeiro personagem.</p>}
            {!charactersLoading && characters.length > 0 && visibleCharacters.length === 0 && <p className="empty-roster">Nenhum personagem encontrado.</p>}
          </div>
          <div className="roster-footer"><span className={'online-dot' + (charactersError || characterSaveState === 'error' ? ' roster-error-dot' : '')} /> {charactersError || (characterSaveState === 'saving' ? `Salvando ${selectedCharacter?.name ?? 'personagem'}…` : characterSaveState === 'error' ? 'Falha ao salvar personagem' : selectedCharacter ? `Alterações de ${selectedCharacter.name} salvas` : 'Personagens salvos neste dispositivo')}</div>
        </aside>

        <section className="preview-column" aria-label="Preview do personagem">
          <div className="preview-heading">
            <div className="preview-title">
              <p className="eyebrow">CUSTOMIZAR <span>/</span> PERSONAGEM</p>
              <h1>{selectedCharacter?.name ?? (charactersLoading ? 'Carregando personagens…' : 'Crie um personagem')}<button className="rename-button" aria-label="Editar nome do personagem" disabled={!selectedCharacter} onClick={() => { setNameDraft(selectedCharacter?.name ?? ''); setDialogMode('rename') }} type="button"><Icon name="edit" /></button></h1>
            </div>
            <div className="preview-actions">
              <button className="quiet-button" aria-live="polite"><Icon name={characterSaveState === 'error' ? 'warning' : characterSaveState === 'saving' ? 'reset' : 'check'} /> {characterSaveState === 'saving' ? 'Salvando' : characterSaveState === 'error' ? 'Falha ao salvar' : 'Salvo'}</button>
              <button className="icon-button" aria-label="Tela cheia"><Icon name="expand" /></button>
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage-scene" style={previewStyle}>
              <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
              <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                <span className="preview-color-label">Fundo da prévia</span>
                <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
              </label>
              <div className="stage-tools" aria-label="Controles do preview">
                <button aria-label="Ajustar enquadramento"><Icon name="frame" /></button>
                <button aria-label="Aproximar"><Icon name="zoomIn" /></button>
                <button aria-label="Afastar"><Icon name="zoomOut" /></button>
              </div>
              {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>{selectedCharacter ? 'Importe um modelo no Fabricador Dev para começar.' : 'Crie um personagem para começar a personalizar.'}</span></div>}
                {selectedWardrobeUrl && selectedArtworkUrl && <img className={'customizer-wardrobe-overlay' + (wardrobePreviewDraggable ? ' draggable' : '')} src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={wardrobePreviewDraggable ? beginWardrobeDrag : undefined} onPointerMove={wardrobePreviewDraggable ? moveWardrobeDrag : undefined} onPointerUp={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} onPointerCancel={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} />}
                {selectedFaceUrl && selectedArtworkUrl && <img className="customizer-face-overlay" src={selectedFaceUrl} alt="Rosto do personagem" draggable={false} />}
                {activeModule === 'Roupas' && clothingSection === 'Customizar' && wardrobeHighlightVisible && selectedWardrobeHighlightUrl && <img className="customizer-wardrobe-selection-halo" src={selectedWardrobeHighlightUrl} alt="Peça de roupa selecionada" draggable={false} />}
                {selectedFrontHairUrl && selectedArtworkUrl && <img className="customizer-front-hair-overlay" src={selectedFrontHairUrl} alt="Cabelo frontal" draggable={false} />}
              {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
              <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'MODELO DE REFERÊNCIA' : 'SEM MODELO'}</small></div>
            </div>
            <div className="stage-underbar">
              <div className="background-picker"><span className="background-swatch" /><span>Fundo do preview</span><Icon name="chevronDown" /></div>
              <button className="text-action" onClick={() => setActiveModule('Personalização')}><Icon name="sliders" /> Personalizar</button>
            </div>
          </div>

        </section>

        <aside className="modules-panel panel" aria-label="Áreas do Customizar">
          <DesignBanner />
          <nav className="customizer-top-tabs home-customizer-top-tabs" aria-label="Áreas do Customizar">
            {customizerTopTabs.map((tab) => <button
              key={tab.id}
              onClick={() => {
                setSelectedCustomizerTopTab(tab.id)
                const moduleByTab: Record<string, string> = {
                  modelos: 'Modelos',
                  corpo: 'Modelos',
                  cabeca: 'Cabeça',
                  roupas: 'Roupas',
                  outros: 'Acessórios',
                  perfil: 'Perfil'
                }
                setActiveModule(moduleByTab[tab.id])
              }}
              type="button"
            ><CustomizerCategoryIcon category={tab.id} /><span>{tab.label}</span></button>)}
          </nav>
        </aside>
      {dialogMode && <div className="character-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null) }}>
        <form className="character-dialog" onSubmit={(event) => void submitCharacterDialog(event)} aria-labelledby="character-dialog-title">
          <p className="eyebrow">SUA COLEÇÃO</p>
          <h2 id="character-dialog-title">{dialogMode === 'create' ? 'Novo personagem' : 'Renomear personagem'}</h2>
          <label htmlFor="character-name">Nome</label>
          <input id="character-name" autoFocus maxLength={80} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Ex.: Chloe" />
          {charactersError && <p className="character-dialog-error" role="alert">{charactersError}</p>}
          <div className="character-dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={!nameDraft.trim() || savingCharacter}>{savingCharacter ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </div>}
    </div>
  )
}
