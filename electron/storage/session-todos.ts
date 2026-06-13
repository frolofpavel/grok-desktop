import type { Database } from 'better-sqlite3'

/**
 * Session todos — оркестрационный todo-лист TodoGate (Фаза 3, Идея 2).
 *
 * Эфемерный для одного прогона/цели лист: главный агент создаёт пункты,
 * суб-агенты берут их в работу (in_progress), закрывают (done) или помечают
 * blocked. Прозрачность прогресса для пользователя (панель Agents → секция Todo).
 *
 * Отличие от storage/tasks.ts: tasks — плоские persistent проектные задачи
 * (id/text/done), а это — сессионный лист со status-enum (pending/in_progress/
 * done/blocked), привязкой к цели/сессии, assignee (callId суба) и порядком.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface SessionTodo {
  id: number
  projectPath: string
  sessionId: number | null
  goal: string | null
  title: string
  status: TodoStatus
  assigneeCallId: string | null
  ord: number
  createdAt: number
  updatedAt: number
}

interface Row {
  id: number
  projectPath: string
  sessionId: number | null
  goal: string | null
  title: string
  status: TodoStatus
  assigneeCallId: string | null
  ord: number
  createdAt: number
  updatedAt: number
}

const SELECT = `
  SELECT id, project_path as projectPath, session_id as sessionId, goal, title,
         status, assignee_call_id as assigneeCallId, ord, created_at as createdAt,
         updated_at as updatedAt
  FROM session_todos
`

export interface SessionTodos {
  /** Создать пачку пунктов разом (batch). Возвращает созданные строки. */
  createBatch: (opts: {
    projectPath: string
    sessionId: number | null
    goal?: string | null
    titles: string[]
  }) => SessionTodo[]
  /** Обновить один пункт (статус / assignee). */
  update: (id: number, patch: { status?: TodoStatus; assigneeCallId?: string | null }) => void
  /** Текущее состояние листа сессии (или всего проекта если sessionId не задан). */
  list: (projectPath: string, sessionId?: number | null) => SessionTodo[]
  /** Найти id пункта по точному title в рамках сессии (для todo_update по названию). */
  findByTitle: (projectPath: string, sessionId: number | null, title: string) => SessionTodo | null
}

export function createSessionTodos(db: Database): SessionTodos {
  return {
    createBatch(opts) {
      const now = Date.now()
      // Стартовый порядок продолжает существующий максимум для этой сессии,
      // чтобы повторный todo_create в одном прогоне не перетирал нумерацию.
      const maxRow = db.prepare(
        `SELECT COALESCE(MAX(ord), -1) as maxOrd FROM session_todos WHERE project_path = ? AND (session_id IS ? OR session_id = ?)`
      ).get(opts.projectPath, opts.sessionId ?? null, opts.sessionId ?? null) as { maxOrd: number }
      let ord = maxRow.maxOrd + 1
      const insert = db.prepare(
        `INSERT INTO session_todos (project_path, session_id, goal, title, status, ord, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      const ids: number[] = []
      const tx = db.transaction((titles: string[]) => {
        for (const title of titles) {
          const info = insert.run(opts.projectPath, opts.sessionId ?? null, opts.goal ?? null, title, ord++, now, now)
          ids.push(Number(info.lastInsertRowid))
        }
      })
      tx(opts.titles)
      return ids.map(id => this.list(opts.projectPath, opts.sessionId).find(t => t.id === id)!).filter(Boolean)
    },
    update(id, patch) {
      const sets: string[] = []
      const vals: unknown[] = []
      if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status) }
      if (patch.assigneeCallId !== undefined) { sets.push('assignee_call_id = ?'); vals.push(patch.assigneeCallId) }
      if (sets.length === 0) return
      sets.push('updated_at = ?'); vals.push(Date.now())
      vals.push(id)
      db.prepare(`UPDATE session_todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    },
    list(projectPath, sessionId) {
      if (sessionId === undefined) {
        return db.prepare(`${SELECT} WHERE project_path = ? ORDER BY ord ASC, id ASC`).all(projectPath) as Row[]
      }
      return db.prepare(
        `${SELECT} WHERE project_path = ? AND (session_id IS ? OR session_id = ?) ORDER BY ord ASC, id ASC`
      ).all(projectPath, sessionId ?? null, sessionId ?? null) as Row[]
    },
    findByTitle(projectPath, sessionId, title) {
      const row = db.prepare(
        `${SELECT} WHERE project_path = ? AND (session_id IS ? OR session_id = ?) AND title = ? ORDER BY id DESC LIMIT 1`
      ).get(projectPath, sessionId ?? null, sessionId ?? null, title) as Row | undefined
      return row ?? null
    }
  }
}
