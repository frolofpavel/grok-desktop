import { app, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

export function projectIconsDir(): string {
  const dir = join(app.getPath('userData'), 'project-icons')
  mkdirSync(dir, { recursive: true })
  return dir
}

function iconDestPath(projectPath: string): string {
  const hash = createHash('sha256').update(projectPath).digest('hex').slice(0, 20)
  return join(projectIconsDir(), `${hash}.png`)
}

/** Copy & resize user image to stable PNG in userData. Returns absolute path. */
export function importProjectIcon(projectPath: string, sourcePath: string): string {
  const img = nativeImage.createFromPath(sourcePath)
  if (img.isEmpty()) throw new Error('Не удалось прочитать изображение')
  const size = img.getSize()
  const maxSide = Math.max(size.width, size.height)
  const resized = maxSide > 128
    ? img.resize({ width: Math.round(size.width * 128 / maxSide), height: Math.round(size.height * 128 / maxSide), quality: 'best' })
    : img
  const dest = iconDestPath(projectPath)
  writeFileSync(dest, resized.toPNG())
  return dest
}

export function deleteProjectIconFile(iconPath: string | null | undefined): void {
  if (!iconPath || !existsSync(iconPath)) return
  try { unlinkSync(iconPath) } catch { /* ignore */ }
}