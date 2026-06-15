import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Database } from 'better-sqlite3'
import { openDb } from '../../electron/storage/db'
import { createProjects } from '../../electron/storage/projects'

describe('projects', () => {
  let dir: string
  let db: Database | undefined

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-proj-')) })
  afterEach(() => {
    db?.close()
    db = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  it('touch does not create a missing project row', () => {
    db = openDb(join(dir, 't.db'))
    const projects = createProjects(db)
    projects.touch('C:\\Users\\RAYNER')
    expect(projects.list()).toEqual([])
  })

  it('upsert creates then touch updates lastOpenedAt', () => {
    db = openDb(join(dir, 't.db'))
    const projects = createProjects(db)
    const first = projects.upsert('C:\\Users\\RAYNER')
    expect(projects.list()).toHaveLength(1)
    expect(first.path).toBe('C:\\Users\\RAYNER')
    expect(first.iconPath).toBeNull()
    projects.touch('C:\\Users\\RAYNER')
    const second = projects.list().find(p => p.path === 'C:\\Users\\RAYNER')!
    expect(second.lastOpenedAt).toBeGreaterThanOrEqual(first.lastOpenedAt)
  })

  it('list is alphabetical and reopening does not reorder', () => {
    db = openDb(join(dir, 't3.db'))
    const projects = createProjects(db)
    projects.upsert('C:\\Zeta')
    projects.upsert('C:\\Alpha')
    projects.upsert('C:\\Mike')
    expect(projects.list().map(p => p.name)).toEqual(['Alpha', 'Mike', 'Zeta'])
    projects.upsert('C:\\Mike')
    expect(projects.list().map(p => p.name)).toEqual(['Alpha', 'Mike', 'Zeta'])
  })

  it('updateMeta renames and stores icon path without touching folder', () => {
    db = openDb(join(dir, 't2.db'))
    const projects = createProjects(db)
    projects.upsert('C:\\Clients\\Ostov')
    const updated = projects.updateMeta('C:\\Clients\\Ostov', {
      name: 'ГК Остов',
      iconPath: 'C:\\AppData\\grok-desktop\\project-icons\\abc.png'
    })
    expect(updated?.name).toBe('ГК Остов')
    expect(updated?.iconPath).toContain('abc.png')
    expect(projects.list()[0].name).toBe('ГК Остов')
  })
})