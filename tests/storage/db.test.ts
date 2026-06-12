import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDb } from '../../electron/storage/db'

describe('openDb', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates settings table on first open', () => {
    const db = openDb(join(dir, 'test.db'))
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()
    expect(row).toEqual({ name: 'settings' })
    db.close()
  })

  it('creates chats table on first open', () => {
    const db = openDb(join(dir, 'test.db'))
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chats'").get()
    expect(row).toEqual({ name: 'chats' })
    db.close()
  })
})
