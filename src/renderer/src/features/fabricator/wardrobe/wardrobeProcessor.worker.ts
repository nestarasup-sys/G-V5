type WardrobeProcessRequest = { id: number; dataUrl: string; normalizeTo?: { width: number; height: number } }
type Piece = { id: string; name: string; x: number; y: number; width: number; height: number; png: ArrayBuffer }
const scope = self as unknown as { onmessage: ((event: MessageEvent<WardrobeProcessRequest>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void }
scope.onmessage = async ({ data }: MessageEvent<WardrobeProcessRequest>) => {
  try {
    const bitmap = await createImageBitmap(await (await fetch(data.dataUrl)).blob())
    let width = bitmap.width
    let height = bitmap.height
    if (width * height > 32_000_000) throw new Error('A imagem tem mais de 32 milhões de pixels. Reduza as dimensões para continuar.')
    let canvas = new OffscreenCanvas(width, height)
    let context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível analisar a folha de roupas.')
    let image: ImageData
    let pixels: Uint8ClampedArray
    context.drawImage(bitmap, 0, 0)
    image = context.getImageData(0, 0, width, height)
    pixels = image.data
    const border: number[][] = []
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 120))
    for (let x = 0; x < width; x += stride) { border.push([x, 0], [x, height - 1]) }
    for (let y = 0; y < height; y += stride) { border.push([0, y], [width - 1, y]) }
    const greenBorder = border.flatMap(([x, y]) => {
      const at = (y * width + x) * 4
      return pixels[at + 3] > 24 && pixels[at + 1] > pixels[at] * 1.2 && pixels[at + 1] > pixels[at + 2] * 1.08
        ? [[pixels[at], pixels[at + 1], pixels[at + 2]]]
        : []
    })
    const chromaGreen = greenBorder.length >= Math.max(4, border.length * .2)
      ? [0, 1, 2].map((channel) => greenBorder.map((color) => color[channel]).sort((a, b) => a - b)[Math.floor(greenBorder.length / 2)])
      : null
    for (let i = 0; i < width * height; i += 1) {
      const at = i * 4
      if (pixels[at + 3] <= 24) { pixels[at + 3] = 0; continue }
      if (chromaGreen) {
        const red = pixels[at]; const green = pixels[at + 1]; const blue = pixels[at + 2]
        const greenish = green > red * 1.2 && green > blue * 1.08
        const distance = Math.hypot(red - chromaGreen[0], green - chromaGreen[1], blue - chromaGreen[2])
        if (greenish && distance <= 118) pixels[at + 3] = 0
        else if (greenish && distance < 166) pixels[at + 3] = Math.round(pixels[at + 3] * (distance - 118) / 48)
      }
    }
    if (data.normalizeTo) {
      let minX = width; let minY = height; let maxX = -1; let maxY = -1
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] <= 24) continue
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      if (maxX < minX || maxY < minY) throw new Error('Não encontrei conteúdo visível para normalizar. Confira a transparência ou o fundo verde da imagem.')
      // Fit the visible sheet as a whole into the model canvas. Uniform scale preserves proportions;
      // centering removes arbitrary outer margins while leaving room around the content.
      const contentWidth = maxX - minX + 1; const contentHeight = maxY - minY + 1
      const padding = 0.06
      const scale = Math.min(data.normalizeTo.width * (1 - padding * 2) / contentWidth, data.normalizeTo.height * (1 - padding * 2) / contentHeight)
      width = data.normalizeTo.width; height = data.normalizeTo.height
      const normalized = new OffscreenCanvas(width, height)
      const normalizedContext = normalized.getContext('2d', { willReadFrequently: true })
      if (!normalizedContext) throw new Error('Não foi possível normalizar a folha de roupas.')
      context.putImageData(image, 0, 0)
      normalizedContext.drawImage(canvas, minX, minY, contentWidth, contentHeight,
        (width - contentWidth * scale) / 2, (height - contentHeight * scale) / 2, contentWidth * scale, contentHeight * scale)
      canvas = normalized
      context = normalizedContext
      image = context.getImageData(0, 0, width, height)
      pixels = image.data
    } else context.putImageData(image, 0, 0)
    const visible = new Uint8Array(width * height)
    for (let i = 0; i < visible.length; i += 1) visible[i] = pixels[i * 4 + 3] > 24 ? 1 : 0
    const visited = new Uint8Array(visible.length)
    const queue = new Int32Array(visible.length)
    const pieces: Piece[] = []
    for (let start = 0; start < visible.length; start += 1) {
      if (!visible[start] || visited[start]) continue
      let read = 0; let write = 0; let minX = width; let minY = height; let maxX = 0; let maxY = 0
      queue[write++] = start; visited[start] = 1
      while (read < write) {
        const at = queue[read++]
        const x = at % width; const y = Math.floor(at / width)
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        const visit = (index: number) => { if (visible[index] && !visited[index]) { visited[index] = 1; queue[write++] = index } }
        if (x > 0) visit(at - 1)
        if (x + 1 < width) visit(at + 1)
        if (y > 0) visit(at - width)
        if (y + 1 < height) visit(at + width)
      }
      if (write < 120) continue
      const pad = 3; const left = Math.max(0, minX - pad); const top = Math.max(0, minY - pad)
      const w = Math.min(width - left, maxX - minX + 1 + pad * 2); const h = Math.min(height - top, maxY - minY + 1 + pad * 2)
      const crop = new OffscreenCanvas(w, h); const cropContext = crop.getContext('2d')
      if (!cropContext) continue
      const cut = cropContext.createImageData(w, h)
      for (let cursor = 0; cursor < write; cursor += 1) {
        const sourceIndex = queue[cursor]; const sx = sourceIndex % width; const sy = Math.floor(sourceIndex / width)
        const sourceOffset = sourceIndex * 4; const targetOffset = ((sy - top) * w + sx - left) * 4
        cut.data[targetOffset] = pixels[sourceOffset]; cut.data[targetOffset + 1] = pixels[sourceOffset + 1]; cut.data[targetOffset + 2] = pixels[sourceOffset + 2]; cut.data[targetOffset + 3] = pixels[sourceOffset + 3]
      }
      cropContext.putImageData(cut, 0, 0)
      const png = await (await crop.convertToBlob({ type: 'image/png' })).arrayBuffer()
      pieces.push({ id: crypto.randomUUID(), name: 'Peça de roupa', x: left, y: top, width: w, height: h, png })
    }
    bitmap.close()
    pieces.sort((a, b) => a.y - b.y || a.x - b.x)
    scope.postMessage({ type: 'complete', id: data.id, width, height, pieces }, pieces.map((piece) => piece.png))
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Falha ao detectar as peças de roupa.' })
  }
}
