import type { Database } from 'better-sqlite3'

export interface FeedbackEntry {
  id: number
  projectPath: string | null
  providerId: string | null
  rating: number | null
  message: string
  createdAt: number
}

export interface Feedback {
  list: (projectPath: string | null, limit?: number) => FeedbackEntry[]
  submit: (input: { projectPath: string | null; providerId: string | null; rating: number | null; message: string }) => FeedbackEntry
  remove: (id: number) => void
}

interface Row {
  id: number
  projectPath: string | null
  providerId: string | null
  rating: number | null
  message: string
  createdAt: number
}

export function createFeedback(db: Database): Feedback {
  return {
    list(projectPath, limit = 100) {
      if (projectPath) {
        return db.prepare(`
          SELECT id, project_path as projectPath, provider_id as providerId, rating, message, created_at as createdAt
          FROM feedback WHERE project_path = ? ORDER BY id DESC LIMIT ?
        `).all(projectPath, limit) as Row[]
      }
      return db.prepare(`
        SELECT id, project_path as projectPath, provider_id as providerId, rating, message, created_at as createdAt
        FROM feedback ORDER BY id DESC LIMIT ?
      `).all(limit) as Row[]
    },
    submit({ projectPath, providerId, rating, message }) {
      const now = Date.now()
      const info = db.prepare(
        'INSERT INTO feedback (project_path, provider_id, rating, message, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(projectPath, providerId, rating, message, now)
      return {
        id: Number(info.lastInsertRowid),
        projectPath, providerId, rating, message, createdAt: now
      }
    },
    remove(id) {
      db.prepare('DELETE FROM feedback WHERE id = ?').run(id)
    }
  }
}
