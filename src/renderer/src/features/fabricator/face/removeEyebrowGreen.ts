type ProcessedEyebrow = { dataUrl: string; width: number; height: number; removedPixels: number }

function greenPixel(data: Uint8ClampedArray, offset: number): boolean {
  const red = data[offset], green = data[offset + 1], blue = data[offset + 2]
  return green > red * 1.16 && green > blue * 1.08 && green - Math.max(red, blue) > 18
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? 0
}

export async function removeEyebrowGreen(source: Blob | string, trim: boolean): Promise<ProcessedEyebrow> {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source
  const bitmap = await createImageBitmap(blob)
  try {
    const { width, height } = bitmap
    if (width * height > 32_000_000) throw new Error('A imagem da sobrancelha tem mais de 32 milhões de pixels.')
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível processar a sobrancelha.')
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, width, height)
    const { data } = image
    const samples: [number, number, number][] = []
    let opaqueBorderSamples = 0
    const step = Math.max(1, Math.floor(Math.min(width, height) / 160))
    const sample = (x: number, y: number) => {
      const offset = (y * width + x) * 4
      if (data[offset + 3] < 200) return
      opaqueBorderSamples++
      if (greenPixel(data, offset)) samples.push([data[offset], data[offset + 1], data[offset + 2]])
    }
    for (let x = 0; x < width; x += step) { sample(x, 0); sample(x, height - 1) }
    for (let y = 0; y < height; y += step) { sample(0, y); sample(width - 1, y) }
    let removedPixels = 0
    if (samples.length >= 4 && samples.length / opaqueBorderSamples >= .25) {
      const background = [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel])))
      const eligible = new Uint8Array(width * height)
      const visited = new Uint8Array(width * height)
      const queue = new Int32Array(width * height)
      for (let pixel = 0; pixel < eligible.length; pixel++) {
        const offset = pixel * 4
        const distance = Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2])
        eligible[pixel] = data[offset + 3] < 12 || greenPixel(data, offset) && distance < 105 ? 1 : 0
      }
      let read = 0, write = 0
      const enqueue = (pixel: number) => {
        if (eligible[pixel] && !visited[pixel]) { visited[pixel] = 1; queue[write++] = pixel }
      }
      for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
      for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
      while (read < write) {
        const pixel = queue[read++], x = pixel % width, y = Math.floor(pixel / width)
        if (x > 0) enqueue(pixel - 1)
        if (x + 1 < width) enqueue(pixel + 1)
        if (y > 0) enqueue(pixel - width)
        if (y + 1 < height) enqueue(pixel + width)
      }
      for (let pixel = 0; pixel <visited.length; pixel++) {
        if (!visited[pixel] || data[pixel * 4 + 3] === 0) continue
        data[pixel * 4 + 3] = 0
        removedPixels++
      }
      if (removedPixels > 0) for (let pixel = 0; pixel < visited.length; pixel++) {
        const offset = pixel * 4
        if (data[offset + 3] === 0 || !greenPixel(data, offset)) continue
        const x = pixel % width, y = Math.floor(pixel / width)
        const touchesBackground = x > 0 && visited[pixel - 1] || x + 1 < width && visited[pixel + 1]
          || y > 0 && visited[pixel - width] || y + 1 < height && visited[pixel + width]
        if (touchesBackground) data[offset + 1] = Math.max(data[offset], data[offset + 2])
      }
      context.putImageData(image, 0, 0)
    }
    if (!trim) return { dataUrl: canvas.toDataURL('image/png'), width, height, removedPixels }
    let left = width, top = height, right = -1, bottom = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 10) continue
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    if (right < left) throw new Error('A imagem da sobrancelha ficou vazia após remover o fundo verde.')
    const cropped = document.createElement('canvas')
    cropped.width = right - left + 1; cropped.height = bottom - top + 1
    const croppedContext = cropped.getContext('2d')
    if (!croppedContext) throw new Error('Não foi possível recortar a sobrancelha.')
    croppedContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
    return { dataUrl: cropped.toDataURL('image/png'), width: cropped.width, height: cropped.height, removedPixels }
  } finally { bitmap.close() }
}
