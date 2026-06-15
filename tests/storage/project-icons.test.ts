import { describe, it, expect, vi, beforeAll } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// project-icons.ts тянет electron.app.getPath('userData'). В vitest electron
// нет — мокаем app, чтобы projectIconsDir() указывал во временную папку.
const USER_DATA = mkdtempSync(join(tmpdir(), 'gg-userdata-'))
vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  nativeImage: {}
}))

let isInsideProjectIcons: (p: string) => boolean
let projectIconsDir: () => string

beforeAll(async () => {
  const mod = await import('../../electron/storage/project-icons')
  isInsideProjectIcons = mod.isInsideProjectIcons
  projectIconsDir = mod.projectIconsDir
})

describe('isInsideProjectIcons', () => {
  it('true для файла внутри project-icons', () => {
    const inside = join(projectIconsDir(), 'abc123.png')
    expect(isInsideProjectIcons(inside)).toBe(true)
  })

  it('false для произвольного системного файла вне папки', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd'
    expect(isInsideProjectIcons(outside)).toBe(false)
  })

  it('false для traversal-выхода из папки', () => {
    const escape = join(projectIconsDir(), '..', '..', 'secret.png')
    expect(isInsideProjectIcons(escape)).toBe(false)
  })

  it('false для самой папки (не файл внутри неё) и для пустой строки', () => {
    expect(isInsideProjectIcons(projectIconsDir())).toBe(false)
    expect(isInsideProjectIcons('')).toBe(false)
  })
})
