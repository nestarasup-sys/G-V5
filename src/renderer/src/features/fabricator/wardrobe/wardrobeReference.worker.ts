import { despillGreenFringes, sampleBackground } from '../models/chroma'

type ReferenceRequest = { id: number; sourceDataUrl: string; tolerance: number }
type ReferenceMessage = { type: 'complete'; id: number; png: ArrayBuffer } | { type: 'error'; id: number; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReferenceRequest>) => void) | null
  postMessage: (message: ReferenceMessage, transfer?: Transferable[]) => void
}

scope.onmessage = async ({ data }: MessageEvent<ReferenceRequest>) => {
  let source: ImageBitmap | null = null
  try {
    source = await createImageBitmap(await (await fetch(data.sourceDataUrl)).blob())
    if (source.width * source.height > 32_000_000) throw new Error('A imagem de referência tem mais de 32 milhões de pixels.')
    const canvas = new OffscreenCanvas(source.width, source.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Não foi possível remover o fundo da referência.')
    context.drawImage(source, 0, 0)
    const image = context.getImageData(0, 0, source.width, source.height)
    const background = sampleBackground(image.data, image.width, image.height)
    const tolerance = Math.max(0, data.tolerance)
    const feather = 44

    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset + 3] === 0) continue
      const distance = Math.hypot(image.data[offset] - background[0], image.data[offset + 1] - background[1], image.data[offset + 2] - background[2])
      if (distance <= tolerance) image.data[offset + 3] = 0
      else if (distance < tolerance + feather) {
        const matte = (distance - tolerance) / feather
        if (matte < .12) image.data[offset + 3] = 0
        else {
          const backgroundWeight = 1 - matte
          image.data[offset] = clampChannel((image.data[offset] - background[0] * backgroundWeight) / matte)
          image.data[offset + 1] = clampChannel((image.data[offset + 1] - background[1] * backgroundWeight) / matte)
          image.data[offset + 2] = clampChannel((image.data[offset + 2] - background[2] * backgroundWeight) / matte)
          image.data[offset + 3] = Math.round(image.data[offset + 3] * matte)
        }
      }
    }
    despillGreenFringes(image.data, background, tolerance)
    context.putImageData(image, 0, 0)
    const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    scope.postMessage({ type: 'complete', id: data.id, png }, [png])
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Não foi possível processar o fundo da referência.' })
  } finally {
    source?.close()
  }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
