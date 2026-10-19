export type CanonicalImageImport = { dataUrl: string; width: number; height: number; bitDepth: 8 | 16; sourceBytes: number; outputBytes: number }

export async function normalizeImageFile(file: File): Promise<CanonicalImageImport> {
  if (!file || file.size <= 0 || file.size > 50 * 1024 * 1024) throw new Error('A imagem deve ter entre 1 byte e 50 MB.')
  const source = new Uint8Array(await file.arrayBuffer())
  return window.desktop.normalizeImageForImport(source)
}

export async function normalizeEditableImageFile(file: File): Promise<CanonicalImageImport> {
  const image = await normalizeImageFile(file)
  if (image.bitDepth > 8) throw new Error('Este editor processa imagens em 8 bits. A imagem PNG de 16 bits foi preservada; converta uma cópia para 8 bits para editar.')
  return image
}
