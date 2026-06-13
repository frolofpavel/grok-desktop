import type { Database } from 'better-sqlite3'

/**
 * Persistent sub-agent sessions (Фаза 2, Идея 1).
 *
 * Субагент (delegate_task / delegate_parallel) теперь не только эфемерная
 * карточка subagent-run, но и строка в chat_sessions с kind='subagent'.
 * Его turns (user/assistant/tool) сохраняются как обычные chats-сообщения
 * (session_id = id суб-сессии) — переиспользуем существующую таблицу chats
 * и FTS. Сессия переживает перезагрузку: панель Agents и просмотр истории
 * суба читают её из БД.
 *
 * Связь с главным чатом — через parent_chat_id (как у review-сабчатов).
 * Cascade delete главного чата уже удаляет субсессии (chat-sessions.remove
 * чистит всех детей по parent_chat_id).
 */

export interface SubSessionRow {
  id: number
  projectPath: string
  parentChatId: number | null
  role: string | null
  status: string | null          // running / done / error / cancelled
  task: string | null
  group: string | null           // тег батча для массовой отмены
  toolCount: number | null
  costCents: number | null
  callId: string | null          // callId эфемерной карточки subagent-run
  providerId: string | null
  model: string | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
}

interface RawRow {
  id: number
  projectPath: string
  parentChatId: number | null
  role: string | null
  status: string | null
  task: string | null
  group: string | null
  toolCount: number | null
  costCents: number | null
  callId: string | null
  providerId: string | null
  model: string | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
}

const SELECT = `
  SELECT id, project_path as projectPath, parent_chat_id as parentChatId,
         sub_role as role, sub_status as status, sub_task as task,
         sub_group as "group", sub_tool_count as toolCount, sub_cost_cents as costCents,
         sub_call_id as callId, provider_id as providerId, model,
         sub_started_at as startedAt, sub_ended_at as endedAt, created_at as createdAt
  FROM chat_sessions
`

export interface SubSessions {
  /** Создать суб-сессию (kind='subagent'). Возвращает её id. */
  create: (opts: {
    projectPath: string
    parentChatId: number | null
    role?: string | null
    task?: string | null
    group?: string | null
    callId?: string | null
    providerId?: string | null
    model?: string | null
  }) => number
  /** Обновить статус / счётчики суб-сессии. */
  update: (id: number, patch: {
    status?: string
    toolCount?: number
    costCents?: number
    endedAt?: number
  }) => void
  /** Все субсессии проекта (для панели Agents), новейшие первыми. */
  listByProject: (projectPath: string) => SubSessionRow[]
  get: (id: number) => SubSessionRow | null
}

export function createSubSessions(db: Database): SubSessions {
  return {
    create(opts) {
      const now = Date.now()
      const info = db.prepare(
        `INSERT INTO chat_sessions
          (project_path, title, provider_id, model, created_at, last_message_at,
           kind, parent_chat_id, sub_role, sub_status, sub_task, sub_group,
           sub_tool_count, sub_call_id, sub_started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'subagent', ?, ?, 'running', ?, ?, 0, ?, ?)`
      ).run(
        opts.projectPath,
        opts.role ? `🤖 ${opts.role}` : '🤖 sub-agent',
        opts.providerId ?? null,
        opts.model ?? null,
        now, now,
        opts.parentChatId ?? null,
        opts.role ?? null,
        opts.task ?? null,
        opts.group ?? null,
        opts.callId ?? null,
        now
      )
      return Number(info.lastInsertRowid)
    },
    update(id, patch) {
      const sets: string[] = []
      const vals: unknown[] = []
      if (patch.status !== undefined) { sets.push('sub_status = ?'); vals.push(patch.status) }
      if (patch.toolCount !== undefined) { sets.push('sub_tool_count = ?'); vals.push(patch.toolCount) }
      if (patch.costCents !== undefined) { sets.push('sub_cost_cents = ?'); vals.push(patch.costCents) }
      if (patch.endedAt !== undefined) { sets.push('sub_ended_at = ?'); vals.push(patch.endedAt) }
      if (sets.length === 0) return
      vals.push(id)
      db.prepare(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    },
    listByProject(projectPath) {
      return db.prepare(
        `${SELECT} WHERE project_path = ? AND kind = 'subagent' ORDER BY created_at DESC`
      ).all(projectPath) as RawRow[]
    },
    get(id) {
      const row = db.prepare(`${SELECT} WHERE id = ? AND kind = 'subagent'`).get(id) as RawRow | undefined
      return row ?? null
    }
  }
}
