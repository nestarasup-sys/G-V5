export type RGB = [number, number, number]

export function sampleBackground(pixels: Uint8ClampedArray, width: number, height: number): RGB {
  const samples: number[][] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120))
  for (let x = 0; x < width; x += step) samples.push([0, x], [height - 1, x])
  for (let y = 0; y < height; y += step) samples.push([y, 0], [y, width - 1])

  const borderColors = samples.map(([y, x]) => {
    const offset = (y * width + x) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  })
  const greenColors = borderColors.filter(([red, green, blue]) => green > red * 1.2 && green > blue * 1.08)
  const chosen = greenColors.length > 0 ? greenColors : borderColors
  return [0, 1, 2].map((channel) => chosen.map((sample) => sample[channel]).sort((a, b) => a - b)[Math.floor(chosen.length / 2)]) as RGB
}

/** Reduces green contamination in edge pixels without changing their alpha. */
export function despillGreenFringes(pixels: Uint8ClampedArray, background: RGB, tolerance: number): number {
  if (background[1] <= background[0] * 1.2 || background[1] <= background[2] * 1.08) return 0
  let changed = 0
  const radius = 150
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const distance = Math.hypot(red - background[0], green - background[1], blue - background[2])
    if (distance >= tolerance + radius) continue
    const nonGreen = Math.max(red, blue)
    const spill = green - nonGreen
    if (spill <= 0) continue
    const weight = Math.max(0, Math.min(1, (tolerance + radius - distance) / radius))
    const cleaned = Math.round(green - spill * weight)
    if (cleaned !== green) { pixels[offset + 1] = cleaned; changed += 1 }
  }
  return changed
}
