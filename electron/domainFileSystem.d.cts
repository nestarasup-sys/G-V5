import type { DataPlatform } from './dataPlatform.cjs'
import type { Dirent, Stats } from 'node:fs'
import type { MakeDirectoryOptions, Mode, ObjectEncodingOptions, RmOptions, StatOptions, WriteFileOptions } from 'node:fs'

export class DomainFileSystem {
  constructor(catalog: DataPlatform, userDataRoot: string)
  locate(path: string): { absolute: string; domainId: string; relativePath: string } | null
  resolvePhysicalPath(path: string): Promise<string | null>
  materializeDirectory(sourcePath: string, destinationPath: string): Promise<string | null>
  readFile(path: string): Promise<Buffer>
  readFile(path: string, options: BufferEncoding | ObjectEncodingOptions): Promise<string>
  writeFile(path: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileOptions): Promise<void>
  mkdir(path: string, options?: MakeDirectoryOptions | Mode): Promise<string | undefined>
  readdir(path: string, options: { withFileTypes: true; encoding?: BufferEncoding }): Promise<Dirent[]>
  readdir(path: string, options?: BufferEncoding | { withFileTypes?: false; encoding?: BufferEncoding }): Promise<string[]>
  access(path: string, mode?: number): Promise<void>
  stat(path: string, options?: StatOptions): Promise<Stats>
  unlink(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  rm(path: string, options?: RmOptions): Promise<void>
  copyFile(source: string, destination: string, mode?: number): Promise<void>
}
