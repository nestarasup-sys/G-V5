import type { FacePiece, FaceSheetKind } from '../../../../../shared/fabricator'

type ProcessedPiece = Omit<FacePiece, 'dataUrl'> & { png: ArrayBuffer }
type WorkerReply =
  | { type: 'complete'; id: number; width: number; height: number; sheetPng: ArrayBuffer; pieces: ProcessedPiece[] }
  | { type: 'error'; id: number; message: string }

function toDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}

export function processFaceSheet(kind: 'nose' | 'mouth-open' | 'mouth-closed', sourceDataUrl: string, noseMode: 'one' | 'six' = 'one'): Promise<{ width: number; height: number; sheetPng: string; pieces: FacePiece[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./faceProcessor.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      worker.terminate()
      if (data.type === 'error') { reject(new Error(data.message)); return }
      resolve({ width: data.width, height: data.height, sheetPng: toDataUrl(data.sheetPng), pieces: data.pieces.map(({ png, ...piece }) => ({ ...piece, dataUrl: toDataUrl(png) })) })
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('Não foi possível preparar a folha facial.')) }
    worker.postMessage({ id: 1, kind: kind as FaceSheetKind, sourceDataUrl, tolerance: 42, noseMode })
  })
}
