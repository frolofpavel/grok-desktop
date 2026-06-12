import type { Database } from 'better-sqlite3'

export interface Task {
  id: number
  text: string
  done: boolean
  createdAt: number
  doneAt: number | null
}

export interface Tasks {
  list: (projectPath: string) => Task[]
  add: (projectPath: string, text: string) => Task
  toggle: (id: number, done: boolean) => void
  remove: (id: number) => void
  clearDone: (projectPath: string) => number
}

interface Row {
  id: number
  text: string
  done: number
  createdAt: number
  doneAt: number | null
}

function rowToTask(r: Row): Task {
  return { id: r.id, text: r.text, done: !!r.done, createdAt: r.createdAt, doneAt: r.doneAt }
}

export function createTasks(db: Database): Tasks {
  return {
    list(projectPath) {
      const rows = db.prepare(`
        SELECT id, text, done, created_at as createdAt, done_at as doneAt
        FROM tasks WHERE project_path = ?
        ORDER BY done ASC, id DESC
      `).all(projectPath) as Row[]
      return rows.map(rowToTask)
    },
    add(projectPath, text) {
      const now = Date.now()
      const info = db.prepare(
        'INSERT INTO tasks (project_path, text, done, created_at) VALUES (?, ?, 0, ?)'
      ).run(projectPath, text, now)
      return { id: Number(info.lastInsertRowid), text, done: false, createdAt: now, doneAt: null }
    },
    toggle(id, done) {
      const doneAt = done ? Date.now() : null
      db.prepare('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?').run(done ? 1 : 0, doneAt, id)
    },
    remove(id) {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    },
    clearDone(projectPath) {
      const info = db.prepare('DELETE FROM tasks WHERE project_path = ? AND done = 1').run(projectPath)
      return info.changes
    }
  }
}
