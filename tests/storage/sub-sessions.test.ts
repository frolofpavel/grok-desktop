import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDb } from '../../electron/storage/db'
import { createSubSessions } from '../../electron/storage/sub-sessions'
import { createChatSessions } from '../../electron/storage/chat-sessions'
import { createChats } from '../../electron/storage/chats'

/**
 * Тесты персистентных суб-сессий (Фаза 2, Идея 1) + миграции 12.
 * Падают по ABI (NODE_MODULE_VERSION) вместе с остальными sqlite-тестами —
 * это известный шум, не регрессия. Логику миграции/функций проверяем здесь.
 */
describe('sub-sessions (migration 12)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-sub-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('миграция 12 добавляет sub_* колонки в chat_sessions', () => {
    const db = openDb(join(dir, 'test.db'))
    const cols = (db.prepare('PRAGMA table_info(chat_sessions)').all() as Array<{ name: string }>).map(c => c.name)
    for (const col of ['sub_role', 'sub_status', 'sub_task', 'sub_group', 'sub_tool_count', 'sub_cost_cents', 'sub_call_id', 'sub_started_at', 'sub_ended_at']) {
      expect(cols).toContain(col)
    }
    db.close()
  })

  it('create → суб-сессия kind=subagent, status running, привязана к parent', () => {
    const db = openDb(join(dir, 'test.db'))
    const sessions = createChatSessions(db)
    const sub = createSubSessions(db)
    const main = sessions.create('/p', { title: 'Main' })
    const id = sub.create({ projectPath: '/p', parentChatId: main.id, role: 'researcher', task: 'найди X', providerId: 'grok' })
    const row = sub.get(id)
    expect(row).not.toBeNull()
    expect(row!.parentChatId).toBe(main.id)
    expect(row!.role).toBe('researcher')
    expect(row!.status).toBe('running')
    // Не должна попадать в Sidebar (только main).
    expect(sessions.list('/p').some(s => s.id === id)).toBe(false)
    db.close()
  })

  it('update меняет статус/счётчики, listByProject отдаёт суба', () => {
    const db = openDb(join(dir, 'test.db'))
    const sub = createSubSessions(db)
    const id = sub.create({ projectPath: '/p', parentChatId: null, role: 'executor' })
    sub.update(id, { status: 'done', toolCount: 5, costCents: 42, endedAt: Date.now() })
    const list = sub.listByProject('/p')
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('done')
    expect(list[0].toolCount).toBe(5)
    expect(list[0].costCents).toBe(42)
    db.close()
  })

  it('turns суба сохраняются как chats и переживают «перезагрузку»', () => {
    const dbPath = join(dir, 'test.db')
    let db = openDb(dbPath)
    const sub = createSubSessions(db)
    const chats = createChats(db)
    const id = sub.create({ projectPath: '/p', parentChatId: null, task: 'задача' })
    chats.appendToSession(id, '/p', 'user', 'задача суба')
    chats.appendToSession(id, '/p', 'assistant', 'ответ суба')
    db.close()
    // Reopen — данные на диске.
    db = openDb(dbPath)
    const reopened = createChats(db).listBySession(id)
    expect(reopened.map(m => m.content)).toEqual(['задача суба', 'ответ суба'])
    db.close()
  })

  it('cascade delete главного чата удаляет суб-сессии и их сообщения', () => {
    const db = openDb(join(dir, 'test.db'))
    const sessions = createChatSessions(db)
    const sub = createSubSessions(db)
    const chats = createChats(db)
    const main = sessions.create('/p', { title: 'Main' })
    const id = sub.create({ projectPath: '/p', parentChatId: main.id })
    chats.appendToSession(id, '/p', 'user', 'x')
    sessions.remove(main.id)
    expect(sub.get(id)).toBeNull()
    expect(chats.listBySession(id)).toHaveLength(0)
    db.close()
  })
})
