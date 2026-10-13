import { despillGreenFringes, sampleBackground } from './chroma'

type AdjustRequest = {
  id: number
  sourceDataUrl: string
  tolerance: number
  parts: Array<{ id: string; dataUrl: string }>
}
type AdjustedPart = { id: string; png: ArrayBuffer }
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AdjustRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

workerScope.onmessage = async (event: MessageEvent<AdjustRequest>) => {
  const { id, sourceDataUrl, tolerance, parts } = event.data
  try {
    const source = await createImageBitmap(await (await fetch(sourceDataUrl)).blob())
    const sampleCanvas = new OffscreenCanvas(128, 128)
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
    if (!sampleContext) throw new Error('Não foi possível analisar o fundo original.')
    sampleContext.drawImage(source, 0, 0, 128, 128)
    const sample = sampleContext.getImageData(0, 0, 128, 128)
    const background = sampleBackground(sample.data, sample.width, sample.height)
    source.close()

    const adjusted: AdjustedPart[] = []
    for (const part of parts) {
      const image = await createImageBitmap(await (await fetch(part.dataUrl)).blob())
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) { image.close(); continue }
      context.drawImage(image, 0, 0)
      image.close()
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const feather = 44
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        if (pixels.data[offset + 3] === 0) continue
        const distance = Math.hypot(pixels.data[offset] - background[0], pixels.data[offset + 1] - background[1], pixels.data[offset + 2] - background[2])
        if (distance <= tolerance) pixels.data[offset + 3] = 0
        else if (distance < tolerance + feather) {
          const matte = (distance - tolerance) / feather
          if (matte < 0.12) pixels.data[offset + 3] = 0
          else {
            const backgroundWeight = 1 - matte
            pixels.data[offset] = clampChannel((pixels.data[offset] - background[0] * backgroundWeight) / matte)
            pixels.data[offset + 1] = clampChannel((pixels.data[offset + 1] - background[1] * backgroundWeight) / matte)
            pixels.data[offset + 2] = clampChannel((pixels.data[offset + 2] - background[2] * backgroundWeight) / matte)
            pixels.data[offset + 3] = Math.round(pixels.data[offset + 3] * matte)
          }
        }
      }
      despillGreenFringes(pixels.data, background, tolerance)
      context.putImageData(pixels, 0, 0)
      adjusted.push({ id: part.id, png: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer() })
    }
    workerScope.postMessage({ type: 'complete', id, parts: adjusted }, adjusted.map((part) => part.png))
  } catch (error) {
    workerScope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : 'Não foi possível ajustar o chroma key.' })
  }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
