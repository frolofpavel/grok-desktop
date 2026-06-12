import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDb } from '../../electron/storage/db'
import { appendAudit, queryAudit, exportAuditCsv } from '../../electron/storage/audit-log'

describe('audit-log run_id', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-audit-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('persists and reads back runId', () => {
    const db = openDb(join(dir, 'test.db'))
    const project = '/tmp/proj'
    appendAudit(db, {
      timestamp: 1000,
      projectPath: project,
      chatId: 1,
      action: 'session_start',
      detail: '{}',
      providerId: 'gemini-api',
      model: 'gemini-2.5-pro',
      runId: 'run-abc'
    })
    const entries = queryAudit(db, project)
    expect(entries).toHaveLength(1)
    expect(entries[0].runId).toBe('run-abc')
    db.close()
  })

  it('normalizes missing runId to null', () => {
    const db = openDb(join(dir, 'test.db'))
    const project = '/tmp/proj'
    appendAudit(db, {
      timestamp: 2000,
      projectPath: project,
      chatId: null,
      action: 'tool_call',
      detail: '{}',
      providerId: null,
      model: null,
      runId: null
    })
    const entries = queryAudit(db, project)
    expect(entries[0].runId).toBeNull()
    db.close()
  })

  it('includes run_id column in CSV export', () => {
    const db = openDb(join(dir, 'test.db'))
    const project = '/tmp/proj'
    appendAudit(db, {
      timestamp: 3000,
      projectPath: project,
      chatId: null,
      action: 'tool_call',
      detail: '{}',
      providerId: null,
      model: null,
      runId: 'run-xyz'
    })
    const csv = exportAuditCsv(db, project)
    expect(csv.split('\n')[0]).toContain('run_id')
    expect(csv).toContain('run-xyz')
    db.close()
  })
})
