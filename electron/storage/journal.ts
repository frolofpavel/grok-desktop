import type { Database } from 'better-sqlite3'

export type JournalKind = 'manual' | 'session' | 'tool' | 'note'

export interface JournalEntry {
  id: number
  kind: JournalKind
  title: string
  detail: string | null
  createdAt: number
}

export interface Journal {
  list: (projectPath: string, limit?: number) => JournalEntry[]
  append: (projectPath: string, kind: JournalKind, title: string, detail?: string | null) => JournalEntry
  remove: (id: number) => void
  clear: (projectPath: string) => number
}

interface Row {
  id: number
  kind: JournalKind
  title: string
  detail: string | null
  createdAt: number
}

export function createJournal(db: Database): Journal {
  return {
    list(projectPath, limit = 200) {
      const rows = db.prepare(`
        SELECT id, kind, title, detail, created_at as createdAt
        FROM journal WHERE project_path = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(projectPath, limit) as Row[]
      return rows
    },
    append(projectPath, kind, title, detail = null) {
      const now = Date.now()
      const info = db.prepare(
        'INSERT INTO journal (project_path, kind, title, detail, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(projectPath, kind, title, detail, now)
      return { id: Number(info.lastInsertRowid), kind, title, detail, createdAt: now }
    },
    remove(id) {
      db.prepare('DELETE FROM journal WHERE id = ?').run(id)
    },
    clear(projectPath) {
      const info = db.prepare('DELETE FROM journal WHERE project_path = ?').run(projectPath)
      return info.changes
    }
  }
}
