import type { Database } from 'better-sqlite3'
import { basename } from 'path'

export interface ProjectMeta {
  path: string
  name: string
  color: string
  lastOpenedAt: number
}

export interface Projects {
  list: () => ProjectMeta[]
  upsert: (path: string) => ProjectMeta
  touch: (path: string) => void
  rename: (path: string, name: string) => void
  remove: (path: string) => void
}

const PALETTE = ['#5b8dff', '#4ec9b0', '#c668ff', '#f0a500', '#f47174', '#7aa3ff', '#b04fc3', '#4ec986']

/**
 * Stable per-path color: hash the project path so the same project always gets
 * the same accent across launches (and across machines if the path matches).
 */
function pickColor(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export function createProjects(db: Database): Projects {
  return {
    list() {
      const rows = db.prepare(`
        SELECT path, name, color, last_opened_at as lastOpenedAt
        FROM projects
        ORDER BY last_opened_at DESC
      `).all() as ProjectMeta[]
      return rows
    },
    upsert(path) {
      const now = Date.now()
      const existing = db.prepare('SELECT path, name, color, last_opened_at as lastOpenedAt FROM projects WHERE path = ?').get(path) as ProjectMeta | undefined
      if (existing) {
        db.prepare('UPDATE projects SET last_opened_at = ? WHERE path = ?').run(now, path)
        return { ...existing, lastOpenedAt: now }
      }
      const name = basename(path) || path
      const color = pickColor(path)
      db.prepare('INSERT INTO projects (path, name, color, last_opened_at) VALUES (?, ?, ?, ?)').run(path, name, color, now)
      return { path, name, color, lastOpenedAt: now }
    },
    touch(path) {
      db.prepare('UPDATE projects SET last_opened_at = ? WHERE path = ?').run(Date.now(), path)
    },
    rename(path, name) {
      db.prepare('UPDATE projects SET name = ? WHERE path = ?').run(name, path)
    },
    remove(path) {
      db.prepare('DELETE FROM projects WHERE path = ?').run(path)
    }
  }
}
