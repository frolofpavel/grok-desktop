import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Database } from 'better-sqlite3'
import { openDb } from '../../electron/storage/db'
import { createSettings } from '../../electron/storage/settings'

// Stub safeStorage for tests — in real Electron it encrypts via OS
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8')
}

describe('settings', () => {
  let dir: string
  let db: Database
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-')) })
  afterEach(() => {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for missing key', () => {
    db = openDb(join(dir, 't.db'))
    const settings = createSettings(db, fakeSafeStorage)
    expect(settings.getSecret('gemini_api_key')).toBeNull()
  })

  it('roundtrips encrypted secret', () => {
    db = openDb(join(dir, 't.db'))
    const settings = createSettings(db, fakeSafeStorage)
    settings.setSecret('gemini_api_key', 'AIzaSyTest123')
    expect(settings.getSecret('gemini_api_key')).toBe('AIzaSyTest123')
  })
})
