import type { FaceComponentKind } from '../../../../../shared/fabricator'

export type EyeSheetPiece = { kind: Extract<FaceComponentKind, 'eye' | 'pupil' | 'eye-closed'>; dataUrl: string; width: number; height: number }

type Gap = { start: number; end: number; length: number }

function backgroundColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] | null {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1]
  const samples = corners.map((pixel) => [...data.subarray(pixel * 4, pixel * 4 + 4)])
  if (samples.some((sample) => sample[3] < 245)) return null
  const average = [0, 1, 2].map((channel) => Math.round(samples.reduce((total, sample) => total + sample[channel], 0) / samples.length)) as [number, number, number]
  return samples.every((sample) => Math.hypot(sample[0] - average[0], sample[1] - average[1], sample[2] - average[2]) < 25) ? average : null
}

function clearEdgeBackground(data: Uint8ClampedArray, width: number, height: number, background: [number, number, number]) {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let first = 0, last = 0
  const add = (pixel: number) => {
    if (visited[pixel]) return
    visited[pixel] = 1
    const offset = pixel * 4
    if (data[offset + 3] < 16 || Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) > 35) return
    queue[last++] = pixel
  }
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1) }
  while (first < last) {
    const pixel = queue[first++]
    data[pixel * 4 + 3] = 0
    const x = pixel % width, y = Math.floor(pixel / width)
    if (x > 0) add(pixel - 1)
    if (x + 1 < width) add(pixel + 1)
    if (y > 0) add(pixel - width)
    if (y + 1 < height) add(pixel + width)
  }
}

function findSeparators(data: Uint8ClampedArray, width: number, height: number): [number, number] {
  const occupied = new Uint8Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 20) continue
      occupied[y] = 1
      break
    }
  }
  const first = occupied.indexOf(1)
  const last = occupied.lastIndexOf(1)
  if (first < 0) throw new Error('A folha não contém peças visíveis.')
  const gaps: Gap[] = []
  for (let y = first + 1; y < last;) {
    if (occupied[y]) { y++; continue }
    const start = y
    while (y < last && !occupied[y]) y++
    gaps.push({ start, end: y, length: y - start })
  }
  const minimumPieceHeight = Math.max(2, Math.floor((last - first + 1) * .035))
  const candidates = gaps.filter((gap) => gap.length >= 2).sort((a, b) => b.length - a.length)
  for (const upper of candidates) for (const lower of candidates) {
    if (upper.start >= lower.start) continue
    if (upper.start - first < minimumPieceHeight || lower.start - upper.end < minimumPieceHeight || last - lower.end + 1 < minimumPieceHeight) continue
    return [Math.floor((upper.start + upper.end) / 2), Math.floor((lower.start + lower.end) / 2)]
  }
  throw new Error('Não consegui separar olho, pupila e olho fechado. Deixe um espaço vazio entre as três peças da imagem.')
}

function cropVisiblePiece(data: Uint8ClampedArray, width: number, top: number, bottom: number, kind: EyeSheetPiece['kind']): EyeSheetPiece {
  let minX = width, minY = bottom, maxX = -1, maxY = -1
  for (let y = top; y < bottom; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 20) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < minX) throw new Error('Uma das três áreas da folha está vazia.')
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1
  const canvas = document.createElement('canvas')
  canvas.width = cropWidth; canvas.height = cropHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível recortar a folha de olhos.')
  const pixels = context.createImageData(cropWidth, cropHeight)
  for (let row = 0; row < cropHeight; row++) {
    const start = ((minY + row) * width + minX) * 4
    pixels.data.set(data.subarray(start, start + cropWidth * 4), row * cropWidth * 4)
  }
  context.putImageData(pixels, 0, 0)
  return { kind, dataUrl: canvas.toDataURL('image/png'), width: cropWidth, height: cropHeight }
}

export async function splitEyeSheet(source: File | string): Promise<EyeSheetPiece[]> {
  const bitmap = typeof source === 'string'
    ? await createImageBitmap(await (await fetch(source)).blob())
    : await createImageBitmap(source)
  try {
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('A folha tem mais de 32 milhões de pixels.')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível abrir a folha de olhos.')
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const background = backgroundColor(data, bitmap.width, bitmap.height)
    if (background) clearEdgeBackground(data, bitmap.width, bitmap.height, background)
    const [firstCut, secondCut] = findSeparators(data, bitmap.width, bitmap.height)
    return [
      cropVisiblePiece(data, bitmap.width, 0, firstCut, 'eye'),
      cropVisiblePiece(data, bitmap.width, firstCut, secondCut, 'pupil'),
      cropVisiblePiece(data, bitmap.width, secondCut, bitmap.height, 'eye-closed')
    ]
  } finally { bitmap.close() }
}
