import type { StudioElement } from '../../../../shared/studio'

export type TrimmedImage = { dataUrl: string; width: number; height: number; left: number; top: number; sourceWidth: number; sourceHeight: number }

export function trimTransparentImage(dataUrl: string): Promise<TrimmedImage | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context || !canvas.width || !canvas.height) return resolve(null)
      context.drawImage(image, 0, 0)
      let pixels: Uint8ClampedArray
      try { pixels = context.getImageData(0, 0, canvas.width, canvas.height).data } catch { return resolve(null) }
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
      if (right < left || bottom < top) return resolve(null)
      const width = right - left + 1
      const height = bottom - top + 1
      if (left === 0 && top === 0 && width === canvas.width && height === canvas.height) return resolve(null)
      const cropped = document.createElement('canvas')
      cropped.width = width
      cropped.height = height
      cropped.getContext('2d')?.drawImage(image, left, top, width, height, 0, 0, width, height)
      resolve({ dataUrl: cropped.toDataURL('image/png'), width, height, left, top, sourceWidth: canvas.width, sourceHeight: canvas.height })
    }
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

export function faceRenderGeometry(element: StudioElement, rendered: { width: number; height: number }, crop: { width: number; height: number } | null, stageWidth: number, stageHeight: number) {
  const cropWidth = crop?.width ?? rendered.width
  const cropHeight = crop?.height ?? rendered.height
  const characterCanvasWidth = element.characterCanvasWidth ?? element.width * rendered.width / Math.max(1, cropWidth)
  return {
    characterCanvasWidth,
    width: characterCanvasWidth * cropWidth / rendered.width,
    height: characterCanvasWidth * stageWidth / Math.max(1, stageHeight) * cropHeight / rendered.width
  }
}

