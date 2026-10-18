export type PaintAsset = { id: string; groupId: string; groupName: string; name: string; category: string; location: string; edited: boolean }
export type PaintDocument = { originalDataUrl: string; currentDataUrl: string; sourceHash: string; edited: boolean }
export type PaintDesktopApi = {
  listPaintAssets: () => Promise<PaintAsset[]>
  createPaintThumbnail: (id: string) => Promise<string>
  loadPaintAsset: (id: string) => Promise<PaintDocument>
  savePaintAsset: (id: string, sourceHash: string, dataUrl: string) => Promise<void>
  removePaintEdit: (id: string) => Promise<void>
}
