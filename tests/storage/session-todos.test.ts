import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDb } from '../../electron/storage/db'
import { createSessionTodos } from '../../electron/storage/session-todos'

/**
 * Тесты TodoGate-хранилища (Фаза 3, Идея 2) + миграции 13.
 * Падают по ABI (NODE_MODULE_VERSION) вместе с остальными sqlite-тестами —
 * это известный шум, не регрессия. Логику миграции/функций проверяем здесь.
 */
describe('session-todos (migration 13)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gg-todo-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('миграция 13 создаёт таблицу session_todos', () => {
    const db = openDb(join(dir, 'test.db'))
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(t => t.name)
    expect(tables).toContain('session_todos')
    db.close()
  })

  it('createBatch создаёт пункты со статусом pending и нарастающим ord', () => {
    const db = openDb(join(dir, 'test.db'))
    const todos = createSessionTodos(db)
    const created = todos.createBatch({ projectPath: '/p', sessionId: 1, goal: 'цель', titles: ['a', 'b', 'c'] })
    expect(created).toHaveLength(3)
    expect(created.every(t => t.status === 'pending')).toBe(true)
    expect(created.map(t => t.ord)).toEqual([0, 1, 2])
    db.close()
  })

  it('повторный createBatch продолжает ord, а не перетирает', () => {
    const db = openDb(join(dir, 'test.db'))
    const todos = createSessionTodos(db)
    todos.createBatch({ projectPath: '/p', sessionId: 1, titles: ['a', 'b'] })
    const second = todos.createBatch({ projectPath: '/p', sessionId: 1, titles: ['c'] })
    expect(second[0].ord).toBe(2)
    db.close()
  })

  it('update меняет статус и assignee', () => {
    const db = openDb(join(dir, 'test.db'))
    const todos = createSessionTodos(db)
    const [t] = todos.createBatch({ projectPath: '/p', sessionId: 1, titles: ['сделать X'] })
    todos.update(t.id, { status: 'in_progress', assigneeCallId: 'call-42' })
    const list = todos.list('/p', 1)
    expect(list[0].status).toBe('in_progress')
    expect(list[0].assigneeCallId).toBe('call-42')
    todos.update(t.id, { status: 'done' })
    expect(todos.list('/p', 1)[0].status).toBe('done')
    db.close()
  })

  it('findByTitle находит пункт по точному названию в рамках сессии', () => {
    const db = openDb(join(dir, 'test.db'))
    const todos = createSessionTodos(db)
    todos.createBatch({ projectPath: '/p', sessionId: 7, titles: ['починить сборку', 'обновить доки'] })
    const found = todos.findByTitle('/p', 7, 'обновить доки')
    expect(found).not.toBeNull()
    expect(found!.title).toBe('обновить доки')
    expect(todos.findByTitle('/p', 7, 'несуществующий')).toBeNull()
    db.close()
  })

  it('list по сессии изолирует todo разных сессий', () => {
    const db = openDb(join(dir, 'test.db'))
    const todos = createSessionTodos(db)
    todos.createBatch({ projectPath: '/p', sessionId: 1, titles: ['s1-a'] })
    todos.createBatch({ projectPath: '/p', sessionId: 2, titles: ['s2-a', 's2-b'] })
    expect(todos.list('/p', 1)).toHaveLength(1)
    expect(todos.list('/p', 2)).toHaveLength(2)
    // весь проект (sessionId не задан)
    expect(todos.list('/p')).toHaveLength(3)
    db.close()
  })
})
