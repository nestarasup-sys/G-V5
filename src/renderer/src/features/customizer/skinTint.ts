/** Recolor body artwork without changing its alpha or dark ink contours. */
export function tintSkinPixels(image: ImageData, tone: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(tone)) return

  const { data, width, height } = image
  const count = width * height
  const mask = new Uint8Array(count)
  const target = [1, 3, 5].map((index) => Number.parseInt(tone.slice(index, index + 2), 16))
  let visibleCount = 0
  let warmCount = 0
  let warmLuminance = 0

  const luminanceAt = (offset: number) => data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4
    if (data[offset + 3] <= 16) continue
    visibleCount++
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    if (red <= 108 || red <= green || green <= blue || red - green < 2 || green - blue < 2 || red - blue >= 105) continue
    mask[pixel] = 1
    warmCount++
    warmLuminance += luminanceAt(offset)
  }

  // Fabricador body pieces contain skin inside a dark outline. Their chroma
  // cleanup leaves some fully opaque, nearly white or green-tinted skin pixels
  // that hue detection cannot recognize. On skin-dominant pieces, recolor the
  // entire bright interior so those pixels cannot remain in the old color.
  const skinDominant = warmCount > 128 && warmCount / Math.max(1, visibleCount) > 0.7
  if (skinDominant) {
    for (let pixel = 0; pixel < count; pixel++) {
      const offset = pixel * 4
      mask[pixel] = data[offset + 3] > 0 && luminanceAt(offset) >= 95 ? 1 : 0
    }
  } else {
    // Mixed artwork keeps hue selection. Recover only its immediate blended edge.
    const seeds = mask.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x
        if (mask[pixel]) continue
        const offset = pixel * 4
        const red = data[offset]
        const green = data[offset + 1]
        const blue = data[offset + 2]
        if (data[offset + 3] === 0 || red <= green || red - blue >= 150 || green < 45 || luminanceAt(offset) < 88) continue
        let touchesSkin = false
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && !touchesSkin; ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
            if (seeds[ny * width + nx]) { touchesSkin = true; break }
          }
        }
        if (touchesSkin) mask[pixel] = 1
      }
    }
  }

  const baseLuminance = warmCount ? warmLuminance / warmCount : 244
  for (let pixel = 0; pixel < count; pixel++) {
    if (!mask[pixel]) continue
    const offset = pixel * 4
    const shade = Math.min(1.08, Math.max(0.42, luminanceAt(offset) / baseLuminance))
    data[offset] = Math.min(255, Math.round(target[0] * shade))
    data[offset + 1] = Math.min(255, Math.round(target[1] * shade))
    data[offset + 2] = Math.min(255, Math.round(target[2] * shade))
  }
}
