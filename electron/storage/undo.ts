import type { Database } from 'better-sqlite3'

export interface UndoEntry {
  id: number
  filePath: string
  beforeContent: string | null
  afterContent: string | null
  createdAt: number
}

export interface UndoStack {
  push: (projectPath: string, filePath: string, before: string, after: string) => UndoEntry
  list: (projectPath: string) => UndoEntry[]
  pop: (id: number) => UndoEntry | null
  clear: (projectPath: string) => number
  count: (projectPath: string) => number
}

const MAX_PER_PROJECT = 50

interface Row {
  id: number
  filePath: string
  beforeContent: string | null
  afterContent: string | null
  createdAt: number
}

export function createUndoStack(db: Database): UndoStack {
  return {
    push(projectPath, filePath, before, after) {
      const now = Date.now()
      const info = db.prepare(
        'INSERT INTO file_undo (project_path, file_path, before_content, after_content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(projectPath, filePath, before, after, now)
      // Prune older entries beyond MAX_PER_PROJECT
      db.prepare(`
        DELETE FROM file_undo
        WHERE project_path = ?
          AND id NOT IN (SELECT id FROM file_undo WHERE project_path = ? ORDER BY id DESC LIMIT ?)
      `).run(projectPath, projectPath, MAX_PER_PROJECT)
      return { id: Number(info.lastInsertRowid), filePath, beforeContent: before, afterContent: after, createdAt: now }
    },
    list(projectPath) {
      const rows = db.prepare(`
        SELECT id, file_path as filePath, before_content as beforeContent, after_content as afterContent, created_at as createdAt
        FROM file_undo WHERE project_path = ?
        ORDER BY id DESC
      `).all(projectPath) as Row[]
      return rows
    },
    pop(id) {
      const row = db.prepare(
        'SELECT id, file_path as filePath, before_content as beforeContent, after_content as afterContent, created_at as createdAt FROM file_undo WHERE id = ?'
      ).get(id) as Row | undefined
      if (!row) return null
      db.prepare('DELETE FROM file_undo WHERE id = ?').run(id)
      return row
    },
    clear(projectPath) {
      const info = db.prepare('DELETE FROM file_undo WHERE project_path = ?').run(projectPath)
      return info.changes
    },
    count(projectPath) {
      const row = db.prepare('SELECT COUNT(*) as c FROM file_undo WHERE project_path = ?').get(projectPath) as { c: number }
      return row.c
    }
  }
}
