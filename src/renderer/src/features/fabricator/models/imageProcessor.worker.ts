type ProcessRequest = { id: number; sourceDataUrl: string; tolerance: number }
type ProcessedPart = { id: string; name: string; x: number; y: number; width: number; height: number; png: ArrayBuffer }
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

workerScope.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const { id, sourceDataUrl, tolerance } = event.data
  try {
    const source = await createImageBitmap(await (await fetch(sourceDataUrl)).blob())
    if (source.width * source.height > 32_000_000) throw new Error('Esta imagem tem mais de 32 milhões de pixels. Reduza suas dimensões para continuar com segurança.')
    const canvas = new OffscreenCanvas(source.width, source.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível preparar a imagem para edição.')
    context.drawImage(source, 0, 0)
    const image = context.getImageData(0, 0, source.width, source.height)
    const pixels = image.data
    const background = sampleBackground(pixels, source.width, source.height)
    const keyed = new Uint8Array(source.width * source.height)
    for (let offset = 0, pixel = 0; offset < pixels.length; offset += 4, pixel += 1) {
      const distance = Math.hypot(pixels[offset] - background[0], pixels[offset + 1] - background[1], pixels[offset + 2] - background[2])
      if (distance <= tolerance) pixels[offset + 3] = 0
      else if (distance < tolerance + 24) pixels[offset + 3] = Math.round(pixels[offset + 3] * ((distance - tolerance) / 24))
      keyed[pixel] = pixels[offset + 3] > 24 ? 1 : 0
    }
    context.putImageData(image, 0, 0)

    const total = source.width * source.height
    const visited = new Uint8Array(total)
    const queue = new Int32Array(total)
    const parts: ProcessedPart[] = []
    let progress = 0
    for (let start = 0; start < total; start += 1) {
      if (!keyed[start] || visited[start]) continue
      let read = 0
      let write = 0
      queue[write++] = start
      visited[start] = 1
      let minX = source.width; let minY = source.height; let maxX = 0; let maxY = 0
      while (read < write) {
        const index = queue[read++]
        const x = index % source.width
        const y = Math.floor(index / source.width)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x > 0) visit(index - 1)
        if (x + 1 < source.width) visit(index + 1)
        if (y > 0) visit(index - source.width)
        if (y + 1 < source.height) visit(index + source.width)
      }
      function visit(index: number): void {
        if (keyed[index] && !visited[index]) { visited[index] = 1; queue[write++] = index }
      }
      if (write < 80) continue
      const width = maxX - minX + 1
      const height = maxY - minY + 1
      const partCanvas = new OffscreenCanvas(width, height)
      const partContext = partCanvas.getContext('2d', { willReadFrequently: true })
      if (!partContext) continue
      const partImage = partContext.createImageData(width, height)
      for (let cursor = 0; cursor < write; cursor += 1) {
        const index = queue[cursor]
        const x = index % source.width
        const y = Math.floor(index / source.width)
        const sourceOffset = index * 4
        const targetOffset = ((y - minY) * width + x - minX) * 4
        partImage.data[targetOffset] = pixels[sourceOffset]
        partImage.data[targetOffset + 1] = pixels[sourceOffset + 1]
        partImage.data[targetOffset + 2] = pixels[sourceOffset + 2]
        partImage.data[targetOffset + 3] = pixels[sourceOffset + 3]
      }
      partContext.putImageData(partImage, 0, 0)
      const blob = await partCanvas.convertToBlob({ type: 'image/png' })
      const png = await blob.arrayBuffer()
      parts.push({ id: crypto.randomUUID(), name: guessName(minX, minY, maxX, maxY, source.width, source.height), x: minX, y: minY, width, height, png })
      progress += write
      if (parts.length % 2 === 0) workerScope.postMessage({ type: 'progress', id, value: Math.min(96, Math.round(progress / total * 100)) })
    }
    parts.sort((a, b) => a.y - b.y || a.x - b.x)
    workerScope.postMessage({ type: 'complete', id, width: source.width, height: source.height, parts }, parts.map((part) => part.png))
    source.close()
  } catch (error) {
    workerScope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : 'Falha ao processar imagem.' })
  }
}

function sampleBackground(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const samples: number[][] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120))
  for (let x = 0; x < width; x += step) {
    samples.push([0, x], [height - 1, x])
  }
  for (let y = 0; y < height; y += step) samples.push([y, 0], [y, width - 1])
  const green = samples.map(([y, x]) => {
    const offset = (y * width + x) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  }).filter(([r, g, b]) => g > r * 1.2 && g > b * 1.08)
  const chosen = green.length > 0 ? green : samples.map(([y, x]) => {
    const offset = (y * width + x) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  })
  const channels = [0, 1, 2].map((channel) => chosen.map((sample) => sample[channel]).sort((a, b) => a - b)[Math.floor(chosen.length / 2)])
  return channels as [number, number, number]
}

function guessName(minX: number, minY: number, maxX: number, maxY: number, width: number, height: number): string {
  const centerX = (minX + maxX) / 2 / width
  const centerY = (minY + maxY) / 2 / height
  if (centerY < 0.27) return 'Cabeça'
  if (centerY > 0.5) return centerX < 0.5 ? 'Perna esquerda' : 'Perna direita'
  if (centerY > 0.23 && centerY < 0.52 && centerX > 0.31 && centerX < 0.69) return 'Tronco'
  if (centerX < 0.35 || centerX > 0.65) return centerY < 0.48 ? `Braço ${centerX < 0.5 ? 'esquerdo' : 'direito'}` : `Antebraço ${centerX < 0.5 ? 'esquerdo' : 'direito'}`
  return 'Peça do modelo'
}
