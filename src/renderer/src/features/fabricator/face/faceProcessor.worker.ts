import type { FaceCrop, FacePiece, FaceSheetKind } from '../../../../../shared/fabricator'
import { despillGreenFringes, sampleBackground } from '../models/chroma'

type Request = { id: number; kind: FaceSheetKind; sourceDataUrl: string; tolerance: number; crops?: Record<string, FaceCrop>; noseMode?: 'auto' | 'one' | 'six' }
type Result = { id: number; type: 'complete'; width: number; height: number; sheetPng: ArrayBuffer; pieces: Array<Omit<FacePiece, 'dataUrl'> & { png: ArrayBuffer }> }
type Failure = { id: number; type: 'error'; message: string }
type Box = FaceCrop

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: Result | Failure, transfer?: Transferable[]) => void }

function bounds(data: Uint8ClampedArray, width: number, height: number, region: Box): Box | null {
  let minX = width, minY = height, maxX = -1, maxY = -1
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y))
  const x1 = Math.min(width, Math.ceil(region.x + region.width)), y1 = Math.min(height, Math.ceil(region.y + region.height))
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (data[(y * width + x) * 4 + 3] < 20) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function bands(data: Uint8ClampedArray, width: number, box: Box, count: number, axis: 'x' | 'y'): Box[] {
  const start = Math.floor(axis === 'x' ? box.x : box.y)
  const length = Math.ceil(axis === 'x' ? box.width : box.height)
  const occupied = new Array<boolean>(length).fill(false)
  for (let i = 0; i < length; i++) {
    const region = axis === 'x' ? { x: start + i, y: box.y, width: 1, height: box.height } : { x: box.x, y: start + i, width: box.width, height: 1 }
    occupied[i] = bounds(data, width, Math.ceil(box.y + box.height), region) !== null
  }
  const gaps: Array<{ middle: number; length: number }> = []
  for (let i = 0; i < length;) {
    if (occupied[i]) { i++; continue }
    const first = i
    while (i < length && !occupied[i]) i++
    if (first > 0 && i < length) gaps.push({ middle: start + (first + i) / 2, length: i - first })
  }
  const separators = gaps.sort((a, b) => b.length - a.length).slice(0, count - 1).map((gap) => gap.middle).sort((a, b) => a - b)
  if (separators.length !== count - 1) return Array.from({ length: count }, (_, index) => axis === 'x'
    ? { x: box.x + index * box.width / count, y: box.y, width: box.width / count, height: box.height }
    : { x: box.x, y: box.y + index * box.height / count, width: box.width, height: box.height / count })
  const edges = [start, ...separators, start + length]
  return Array.from({ length: count }, (_, index) => axis === 'x'
    ? { x: edges[index], y: box.y, width: edges[index + 1] - edges[index], height: box.height }
    : { x: box.x, y: edges[index], width: box.width, height: edges[index + 1] - edges[index] })
}

function removeBackground(image: ImageData, tolerance: number): ImageData {
  const { data, width, height } = image
  const background = sampleBackground(data, width, height)
  const eligible = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  for (let i = 0; i < eligible.length; i++) {
    const offset = i * 4
    eligible[i] = data[offset + 3] < 12 || Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) <= tolerance ? 1 : 0
  }
  let head = 0, tail = 0
  const enqueue = (index: number) => { if (eligible[index] && !visited[index]) { visited[index] = 1; queue[tail++] = index } }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width)
    if (x) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  for (let i = 0; i < visited.length; i++) if (visited[i]) data[i * 4 + 3] = 0
  despillGreenFringes(data, background, tolerance)
  return image
}

async function cropPng(image: ImageData, crop: Box): Promise<ArrayBuffer> {
  const x = Math.max(0, Math.floor(crop.x)), y = Math.max(0, Math.floor(crop.y))
  const width = Math.max(1, Math.min(image.width - x, Math.ceil(crop.width)))
  const height = Math.max(1, Math.min(image.height - y, Math.ceil(crop.height)))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(width, height)
  for (let row = 0; row < height; row++) pixels.data.set(image.data.subarray(((row + y) * image.width + x) * 4, ((row + y) * image.width + x + width) * 4), row * width * 4)
  context.putImageData(pixels, 0, 0)
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
}

scope.onmessage = async ({ data }: MessageEvent<Request>) => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(await (await fetch(data.sourceDataUrl)).blob())
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('A folha tem mais de 32 milhões de pixels.')
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível analisar a folha.')
    context.drawImage(bitmap, 0, 0)
    const originalPng = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    const image = removeBackground(context.getImageData(0, 0, bitmap.width, bitmap.height), Math.max(0, Math.min(280, data.tolerance)))
    context.putImageData(image, 0, 0)
    const whole = bounds(image.data, image.width, image.height, { x: 0, y: 0, width: image.width, height: image.height })
    if (!whole) throw new Error('Nenhuma peça visível após remover o fundo. Reduza o chroma.')
    const regions: Array<{ id: string; index: number; side?: 'left' | 'right'; crop: Box }> = []
    const add = (index: number, crop: Box, side?: 'left' | 'right') => {
      const id = `${data.kind}-${index}${side ? `-${side}` : ''}`
      const chosen = data.crops?.[id] ?? bounds(image.data, image.width, image.height, crop) ?? crop
      regions.push({ id, index, side, crop: chosen })
    }
    if (data.kind === 'eyes' || data.kind === 'eyebrows') {
      const rows = data.kind === 'eyes' ? bands(image.data, image.width, whole, 3, 'y') : [whole]
      rows.forEach((row, index) => {
        const rowBounds = bounds(image.data, image.width, image.height, row) ?? row
        const columns = bands(image.data, image.width, rowBounds, 2, 'x')
        add(index, columns[0], 'left'); add(index, columns[1], 'right')
      })
    } else {
      const count = data.kind === 'nose' ? (data.noseMode === 'one' ? 1 : data.noseMode === 'six' ? 6 : bands(image.data, image.width, whole, 2, 'y').every((row) => bands(image.data, image.width, row, 3, 'x').every((cell) => bounds(image.data, image.width, image.height, cell))) ? 6 : 1) : 21
      if (count === 1) add(0, whole)
      else {
        const rows = bands(image.data, image.width, whole, count === 6 ? 2 : 3, 'y')
        rows.forEach((row, r) => bands(image.data, image.width, row, count === 6 ? 3 : 7, 'x').forEach((cell, c) => add(r * (count === 6 ? 3 : 7) + c, cell)))
      }
    }
    const pieces = await Promise.all(regions.map(async (region) => ({ id: region.id, sheet: data.kind, index: region.index, side: region.side, crop: region.crop, width: region.crop.width, height: region.crop.height, png: await cropPng(image, region.crop) })))
    scope.postMessage({ type: 'complete', id: data.id, width: bitmap.width, height: bitmap.height, sheetPng: originalPng, pieces }, [originalPng, ...pieces.map((piece) => piece.png)])
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Falha ao recortar a folha.' })
  } finally { bitmap?.close() }
}
