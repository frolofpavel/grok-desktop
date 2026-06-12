import type { Database } from 'better-sqlite3'

/**
 * Снапшот РЕАЛЬНОГО входа агентного запуска (один ai:send = один run).
 * Сохраняется на старте run'а в API-пути, где собран композитный system prompt.
 * Основа Debug Packet — «что именно ушло в модель», отладка по фактам.
 */
export interface RunInput {
  runId: string
  projectPath: string | null
  chatId: number | null
  timestamp: number
  providerId: string | null
  model: string | null
  /** Точная system-строка, отправленная модели (composed.system). */
  systemPrompt: string
  /** Контент последнего user-сообщения запроса. */
  userMessage: string
}

interface RunInputRow {
  run_id: string
  project_path: string | null
  chat_id: number | null
  timestamp: number
  provider_id: string | null
  model: string | null
  system_prompt: string | null
  user_message: string | null
}

// Cap на хранимый текст — отрезаем экстремальные промпты/сообщения, чтобы БД
// не раздувалась на длинных контекстах. 200KB с запасом покрывает реальные кейсы.
const MAX_TEXT = 200_000

function cap(s: string): string {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s
}

export function saveRunInput(db: Database, input: RunInput): void {
  db.prepare(
    `INSERT OR REPLACE INTO run_inputs
       (run_id, project_path, chat_id, timestamp, provider_id, model, system_prompt, user_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.projectPath ?? null,
    input.chatId ?? null,
    input.timestamp,
    input.providerId ?? null,
    input.model ?? null,
    cap(input.systemPrompt),
    cap(input.userMessage)
  )
}

export function getRunInput(db: Database, runId: string): RunInput | null {
  const row = db.prepare('SELECT * FROM run_inputs WHERE run_id = ?').get(runId) as RunInputRow | undefined
  if (!row) return null
  return {
    runId: row.run_id,
    projectPath: row.project_path,
    chatId: row.chat_id,
    timestamp: row.timestamp,
    providerId: row.provider_id,
    model: row.model,
    systemPrompt: row.system_prompt ?? '',
    userMessage: row.user_message ?? ''
  }
}
