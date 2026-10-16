export {}

type Request = { dataUrl: string; tolerance: number; mode: 'auto' | 'green' | 'checker' }
type HairCut = { png: ArrayBuffer; width: number; height: number }
type Response = { type: 'complete'; front: HairCut; back: HairCut } | { type: 'error'; message: string }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: Response, transfer?: Transferable[]) => void }

type Color = [number, number, number]

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? 0
}

function nearColor(data: Uint8ClampedArray, offset: number, color: Color, tolerance: number): boolean {
  return Math.hypot(data[offset] - color[0], data[offset + 1] - color[1], data[offset + 2] - color[2]) <= tolerance
}

function processHalf(source: ImageData, top: number, height: number, tolerance: number, mode: Request['mode']): ImageData {
  const { width } = source
  const image = new ImageData(width, height)
  for (let y = 0; y < height; y++) image.data.set(source.data.subarray(((top + y) * width) * 4, ((top + y) * width + width) * 4), y * width * 4)
  const { data } = image
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 180))
  const greenSamples: Color[] = []
  const neutralSamples: Color[] = []
  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * 4
    if (data[offset + 3] < 12) return
    const color: Color = [data[offset], data[offset + 1], data[offset + 2]]
    const [red, green, blue] = color
    if (green > red * 1.12 && green > blue * 1.06 && green - Math.max(red, blue) > 12) greenSamples.push(color)
    if (Math.max(red, green, blue) - Math.min(red, green, blue) < 28) neutralSamples.push(color)
  }
  for (let x = 0; x < width; x += stride) { sample(x, 0); sample(x, height - 1) }
  for (let y = 0; y < height; y += stride) { sample(0, y); sample(width - 1, y) }

  let green: Color | null = null
  if (mode !== 'checker' && greenSamples.length >= 4) green = [0, 1, 2].map((channel) => median(greenSamples.map((color) => color[channel]))) as Color

  // A common “transparent” checkerboard is actually baked into exported images.
  // Cluster neutral edge colors into its light and dark tiles, instead of keying
  // only the most frequent one; only boundary-connected pixels are removed.
  let checker: Color[] = []
  if (!green && mode !== 'green' && neutralSamples.length >= 6) {
    const luminance = neutralSamples.map(([r, g, b]) => (r + g + b) / 3)
    const low = median(luminance.filter((value) => value <= median([...luminance])))
    const high = median(luminance.filter((value) => value > median([...luminance])))
    if (Number.isFinite(low) && Number.isFinite(high) && high - low >= 24) {
      checker = [
        [median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 <= (low + high) / 2).map((c) => c[0])), median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 <= (low + high) / 2).map((c) => c[1])), median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 <= (low + high) / 2).map((c) => c[2]))],
        [median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 > (low + high) / 2).map((c) => c[0])), median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 > (low + high) / 2).map((c) => c[1])), median(neutralSamples.filter((c) => (c[0] + c[1] + c[2]) / 3 > (low + high) / 2).map((c) => c[2]))]
      ]
    }
  }

  const eligible = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  for (let index = 0; index < eligible.length; index++) {
    const offset = index * 4
    if (data[offset + 3] < 12) { eligible[index] = 1; continue }
    const red = data[offset], g = data[offset + 1], blue = data[offset + 2]
    const greenDistance = green ? Math.hypot(red - green[0], g - green[1], blue - green[2]) : Infinity
    const greenKey = tolerance > 0 && Boolean(green && g > red * 1.08 && g > blue * 1.04 && g - Math.max(red, blue) > 8 && greenDistance < 12 + tolerance * 1.65)
    const gray = Math.max(red, g, blue) - Math.min(red, g, blue) < 32
    const checkerKey = tolerance > 0 && checker.length === 2 && gray && checker.some((color) => nearColor(data, offset, color, 5 + tolerance * .48))
    eligible[index] = greenKey || checkerKey ? 1 : 0
  }
  let read = 0, write = 0
  const enqueue = (index: number) => { if (eligible[index] && !visited[index]) { visited[index] = 1; queue[write++] = index } }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
  while (read < write) {
    const index = queue[read++], x = index % width, y = Math.floor(index / width)
    if (x) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  for (let i = 0; i < visited.length; i++) if (visited[i]) data[i * 4 + 3] = 0

  // Soften only the one-pixel fringe around keyed green. This removes the green
  // outline while preserving opaque dark strokes and hair details.
  if (green && tolerance > 0) for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const red = data[i], g = data[i + 1], blue = data[i + 2]
    if (g > red * 1.08 && g > blue * 1.04 && g - Math.max(red, blue) > 5) {
      const spill = Math.min(1, (g - Math.max(red, blue)) / 80)
      data[i + 1] = Math.max(red, blue, Math.round(g * (1 - spill)))
    }
  }
  return image
}

async function crop(image: ImageData): Promise<HairCut> {
  const { width, height, data } = image
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error('Não encontrei cabelo nessa metade. Confira se a folha tem Posterior em cima e Traseiro embaixo.')
  const outWidth = right - left + 1, outHeight = bottom - top + 1
  const canvas = new OffscreenCanvas(outWidth, outHeight)
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(outWidth, outHeight)
  for (let row = 0; row < outHeight; row++) pixels.data.set(data.subarray(((row + top) * width + left) * 4, ((row + top) * width + right + 1) * 4), row * outWidth * 4)
  context.putImageData(pixels, 0, 0)
  return { png: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(), width: outWidth, height: outHeight }
}

scope.onmessage = async ({ data }: MessageEvent<Request>) => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(await (await fetch(data.dataUrl)).blob())
    if (bitmap.height < 2) throw new Error('A folha precisa ter o cabelo Posterior em cima e o Traseiro em baixo.')
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('A folha tem mais de 32 milhões de pixels. Reduza as dimensões para continuar.')
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível analisar a folha de cabelo.')
    context.drawImage(bitmap, 0, 0)
    const source = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const upperHeight = Math.floor(bitmap.height / 2)
    const tolerance = Math.max(0, Math.min(100, data.tolerance))
    const mode = ['auto', 'green', 'checker'].includes(data.mode) ? data.mode : 'auto'
    const front = await crop(processHalf(source, 0, upperHeight, tolerance, mode))
    const back = await crop(processHalf(source, upperHeight, bitmap.height - upperHeight, tolerance, mode))
    scope.postMessage({ type: 'complete', front, back }, [front.png, back.png])
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Falha ao remover o fundo e separar a folha de cabelo.' })
  } finally { bitmap?.close() }
}
