'use strict'

const sharp = require('sharp')

const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_PIXELS = 32_000_000
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp'])

/** Decode a user-selected static raster and encode a metadata-free, lossless PNG. */
async function normalizeImageBuffer(input, limits = {}) {
  const maxBytes = limits.maxBytes ?? MAX_IMAGE_BYTES
  const maxPixels = limits.maxPixels ?? MAX_IMAGE_PIXELS
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? [])
  if (!bytes.length) throw new Error('O arquivo de imagem está vazio.')
  if (bytes.length > maxBytes) throw new Error(`A imagem excede o limite permitido de ${Math.floor(maxBytes / 1024 / 1024)} MB.`)
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) throw new Error('Limite de pixels inválido.')

  const options = { limitInputPixels: maxPixels, failOn: 'error', animated: false }
  let metadata
  try { metadata = await sharp(bytes, options).metadata() }
  catch (reason) {
    if (String(reason?.message ?? '').toLowerCase().includes('pixel limit')) throw new Error(`A imagem excede o limite de ${maxPixels.toLocaleString('pt-BR')} pixels.`)
    throw new Error('Não foi possível decodificar a imagem. O arquivo pode estar corrompido ou usar um formato incompatível.')
  }
  if ((metadata.pages ?? 1) !== 1) throw new Error('Imagens animadas não são aceitas neste import. Exporte um quadro estático como PNG.')
  if (!ACCEPTED_FORMATS.has(metadata.format)) throw new Error('Formato não compatível. Use PNG, JPG ou WebP estático.')
  if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
    || metadata.width < 1 || metadata.height < 1 || metadata.width * metadata.height > maxPixels) {
    throw new Error(`A imagem excede o limite de ${maxPixels.toLocaleString('pt-BR')} pixels.`)
  }

  // Preserve 16-bit samples when present. Palette encoding is deliberately disabled:
  // palette quantization can change decoded colors even though the container is PNG.
  const bitDepth = metadata.depth === 'ushort' ? 16 : 8
  let pipeline = sharp(bytes, options).rotate()
  if (metadata.depth === 'ushort') pipeline = pipeline.toColourspace('rgb16')
  else pipeline = pipeline.toColourspace('srgb')
  const png = await pipeline.ensureAlpha().png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: false
  }).toBuffer()
  if (png.length > maxBytes) throw new Error(`O PNG sem perdas resultante excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB; o arquivo original foi preservado.`)
  const outputMetadata = await sharp(png, { limitInputPixels: maxPixels, failOn: 'error' }).metadata()
  return {
    bytes: png,
    mimeType: 'image/png',
    extension: '.png',
    width: outputMetadata.width,
    height: outputMetadata.height,
    channels: outputMetadata.channels,
    bitDepth: outputMetadata.depth === 'ushort' ? 16 : 8,
    sourceFormat: metadata.format,
    sourceBytes: bytes.length,
    outputBytes: png.length
  }
}

function decodeImageDataUrl(value) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value)
  if (!match) throw new Error('Referência de imagem inválida.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw new Error('Base64 de imagem inválido.')
  return bytes
}

module.exports = { ACCEPTED_FORMATS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, decodeImageDataUrl, normalizeImageBuffer }
