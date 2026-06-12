import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildProjectMap, projectMapToText } from '../../electron/ai/project-map'

describe('project-map', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-pmap-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('extracts top-level symbols from ts files', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.ts'), `
export function hello() { return 1 }
export class Bar {}
export const Widget = () => null
export const value = 42
export interface User { id: number }
`)
    const map = await buildProjectMap(dir)
    const foo = map.files.find(f => f.path === 'src/foo.ts')
    expect(foo).toBeTruthy()
    const kinds = foo!.symbols.map(s => `${s.kind}:${s.name}`).sort()
    expect(kinds).toContain('function:hello')
    expect(kinds).toContain('class:Bar')
    expect(kinds).toContain('component:Widget')
    expect(kinds).toContain('export:value')
    expect(kinds).toContain('type:User')
  })

  it('skips ignored directories', async () => {
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'export const X = 1')
    writeFileSync(join(dir, 'real.ts'), 'export const real = 1')
    const map = await buildProjectMap(dir)
    expect(map.files.find(f => f.path.startsWith('node_modules'))).toBeUndefined()
    expect(map.files.find(f => f.path === 'real.ts')).toBeTruthy()
  })

  it('renders compact text format', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'export function a() {}')
    const map = await buildProjectMap(dir)
    const text = projectMapToText(map)
    expect(text).toContain('Project Map')
    expect(text).toContain('src/a.ts')
    expect(text).toContain('function:a')
  })
})
