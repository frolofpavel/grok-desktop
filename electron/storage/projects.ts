import type { Database } from 'better-sqlite3'
import { basename } from 'path'

export interface ProjectMeta {
  path: string
  name: string
  color: string
  iconPath: string | null
  lastOpenedAt: number
}

export interface ProjectMetaPatch {
  name?: string
  iconPath?: string | null
}

export interface Projects {
  list: () => ProjectMeta[]
  upsert: (path: string) => ProjectMeta
  touch: (path: string) => void
  rename: (path: string, name: string) => void
  updateMeta: (path: string, patch: ProjectMetaPatch) => ProjectMeta | null
  remove: (path: string) => void
}

function mapRow(row: ProjectMeta & { icon_path?: string | null }): ProjectMeta {
  return {
    path: row.path,
    name: row.name,
    color: row.color,
    iconPath: row.iconPath ?? row.icon_path ?? null,
    lastOpenedAt: row.lastOpenedAt
  }
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
        SELECT path, name, color, icon_path as iconPath, last_opened_at as lastOpenedAt
        FROM projects
        ORDER BY name COLLATE NOCASE ASC, path ASC
      `).all() as ProjectMeta[]
      return rows.map(mapRow)
    },
    upsert(path) {
      const now = Date.now()
      const existing = db.prepare(
        'SELECT path, name, color, icon_path as iconPath, last_opened_at as lastOpenedAt FROM projects WHERE path = ?'
      ).get(path) as ProjectMeta | undefined
      if (existing) {
        return mapRow(existing)
      }
      const name = basename(path) || path
      const color = pickColor(path)
      db.prepare('INSERT INTO projects (path, name, color, icon_path, last_opened_at) VALUES (?, ?, ?, NULL, ?)').run(path, name, color, now)
      return { path, name, color, iconPath: null, lastOpenedAt: now }
    },
    touch(path) {
      db.prepare('UPDATE projects SET last_opened_at = ? WHERE path = ?').run(Date.now(), path)
    },
    rename(path, name) {
      db.prepare('UPDATE projects SET name = ? WHERE path = ?').run(name.trim(), path)
    },
    updateMeta(path, patch) {
      const row = db.prepare(
        'SELECT path, name, color, icon_path as iconPath, last_opened_at as lastOpenedAt FROM projects WHERE path = ?'
      ).get(path) as ProjectMeta | undefined
      if (!row) return null
      const name = patch.name !== undefined ? patch.name.trim() : row.name
      const iconPath = patch.iconPath !== undefined ? patch.iconPath : (row.iconPath ?? null)
      db.prepare('UPDATE projects SET name = ?, icon_path = ? WHERE path = ?').run(name, iconPath, path)
      return mapRow({ ...row, name, iconPath })
    },
    remove(path) {
      db.prepare('DELETE FROM projects WHERE path = ?').run(path)
    }
  }
}
