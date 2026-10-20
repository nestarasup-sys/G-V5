/** Convert canonical Canvas RGBA bytes to the raw BGRA format consumed by FFmpeg.
 * The input is never mutated. Alpha remains byte-for-byte unchanged.
 */
export function rgbaToBgra(input: Uint8Array | Buffer): Buffer {
  if (input.byteLength % 4 !== 0) throw new Error('Buffer RGBA possui tamanho inválido.')
  const output = Buffer.allocUnsafe(input.byteLength)
  for (let offset = 0; offset < input.byteLength; offset += 4) {
    output[offset] = input[offset + 2]
    output[offset + 1] = input[offset + 1]
    output[offset + 2] = input[offset]
    output[offset + 3] = input[offset + 3]
  }
  return output
}
