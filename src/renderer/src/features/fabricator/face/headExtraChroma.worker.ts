export {}

type Request = { id: number; dataUrl: string }
type Complete = { type: 'complete'; id: number; width: number; height: number; png: ArrayBuffer }
type Failure = { type: 'error'; id: number; message: string }

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: Complete | Failure, transfer?: Transferable[]) => void }
const hardTolerance = 105
const featherTolerance = 190

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? 0
}

function sampleGreenKey(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number] | null {
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 180))
  const samples: Array<[number, number, number]> = []
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    if (pixels[offset + 3] > 16 && green > red * 1.15 && green > blue * 1.08 && green - Math.max(red, blue) > 18) samples.push([red, green, blue])
  }
  for (let x = 0; x < width; x += stride) { add(x, 0); add(x, height - 1) }
  for (let y = 0; y < height; y += stride) { add(0, y); add(width - 1, y) }
  const perimeterSamples = Math.ceil(width / stride) * 2 + Math.ceil(height / stride) * 2
  if (samples.length < Math.max(4, perimeterSamples * .12)) return null
  return [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel]))) as [number, number, number]
}

function removeGreen(pixels: Uint8ClampedArray, key: [number, number, number]): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const originalAlpha = pixels[offset + 3]
    if (originalAlpha === 0) continue
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    if (green <= red * 1.12 || green <= blue * 1.06 || green - Math.max(red, blue) < 12) continue
    const distance = Math.hypot(red - key[0], green - key[1], blue - key[2])
    if (distance >= featherTolerance) continue
    const softness = Math.max(0, Math.min(1, (distance - hardTolerance) / (featherTolerance - hardTolerance)))
    pixels[offset + 3] = Math.round(originalAlpha * softness)
    const spill = green - Math.max(red, blue)
    if (spill > 0) pixels[offset + 1] = Math.round(green - spill * (1 - softness))
  }
}

function visibleBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] <= 8) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  if (maxX < minX || maxY < minY) throw new Error('Não restou nenhum desenho visível após remover o fundo verde.')
  const padding = Math.max(2, Math.round(Math.min(maxX - minX + 1, maxY - minY + 1) * .025))
  const left = Math.max(0, minX - padding), top = Math.max(0, minY - padding)
  return { x: left, y: top, width: Math.min(width - left, maxX - minX + 1 + padding * 2), height: Math.min(height - top, maxY - minY + 1 + padding * 2) }
}

scope.onmessage = async ({ data }: MessageEvent<Request>) => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(await (await fetch(data.dataUrl)).blob())
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('A imagem tem mais de 32 milhões de pixels. Reduza as dimensões para continuar.')
    const source = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível analisar a imagem dos óculos.')
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const key = sampleGreenKey(image.data, image.width, image.height)
    if (key) removeGreen(image.data, key)
    const bounds = visibleBounds(image.data, image.width, image.height)
    const output = new OffscreenCanvas(bounds.width, bounds.height)
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('Não foi possível preparar a imagem dos óculos.')
    const cropped = outputContext.createImageData(bounds.width, bounds.height)
    for (let row = 0; row < bounds.height; row++) {
      const start = ((bounds.y + row) * image.width + bounds.x) * 4
      cropped.data.set(image.data.subarray(start, start + bounds.width * 4), row * bounds.width * 4)
    }
    outputContext.putImageData(cropped, 0, 0)
    const png = await (await output.convertToBlob({ type: 'image/png' })).arrayBuffer()
    scope.postMessage({ type: 'complete', id: data.id, width: bounds.width, height: bounds.height, png }, [png])
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Não foi possível processar a imagem dos óculos.' })
  } finally { bitmap?.close() }
}
