import { app } from 'electron'
import { isAbsolute, join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'

export type VideoStudioToolPaths = Readonly<{
  ffmpeg: string
  ffprobe: string
  source: 'environment' | 'packaged'
}>

async function requireExecutable(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} precisa usar caminho absoluto.`)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size < 1) throw new Error(`${label} não foi encontrado em ${path}.`)
  return path
}

/**
 * Resolve media tools without consulting PATH. Development may opt in via
 * explicit environment variables; production uses files shipped in resources.
 */
export async function resolveVideoStudioTools(): Promise<VideoStudioToolPaths> {
  if (!app.isPackaged) {
    const ffmpeg = process.env.GACHA_FFMPEG_PATH
    const ffprobe = process.env.GACHA_FFPROBE_PATH
    if (!ffmpeg || !ffprobe) {
      throw new Error('Exportação real requer GACHA_FFMPEG_PATH e GACHA_FFPROBE_PATH no desenvolvimento.')
    }
    return {
      ffmpeg: await requireExecutable(resolve(ffmpeg), 'FFmpeg'),
      ffprobe: await requireExecutable(resolve(ffprobe), 'FFprobe'),
      source: 'environment',
    }
  }

  const toolsRoot = join(process.resourcesPath, 'video-tools')
  const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  return {
    ffmpeg: await requireExecutable(join(toolsRoot, ffmpegName), 'FFmpeg empacotado'),
    ffprobe: await requireExecutable(join(toolsRoot, ffprobeName), 'FFprobe empacotado'),
    source: 'packaged',
  }
}
