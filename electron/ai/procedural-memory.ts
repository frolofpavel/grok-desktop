/**
 * Процедурная память — детектирует успешные паттерны решения задач
 * и сохраняет их как воспоминания типа 'pattern'.
 *
 * Текущий детектор: диагностика нашла ошибку → apply_patch исправил → диагностика чистая.
 */

import type { Database } from 'better-sqlite3'
import { saveMemory } from '../storage/memories'

export interface ToolEvent {
  tool: string
  args: Record<string, unknown>
  success: boolean
  timestamp: number
}

const MAX_HISTORY = 20
// Per-project история тул-событий. Не персистится — живёт только в памяти процесса.
const projectToolHistory = new Map<string, ToolEvent[]>()

function getHistory(projectPath: string): ToolEvent[] {
  let history = projectToolHistory.get(projectPath)
  if (!history) {
    history = []
    projectToolHistory.set(projectPath, history)
  }
  return history
}

/**
 * Фиксирует событие тула и проверяет известные паттерны.
 * Вызывать из tool-handlers после каждого выполненного тула.
 */
export function trackToolForPatterns(
  db: Database,
  projectPath: string,
  event: ToolEvent
): void {
  const history = getHistory(projectPath)
  history.push(event)
  if (history.length > MAX_HISTORY) history.shift()

  detectFixPattern(db, projectPath, history)
}

/**
 * Паттерн: check_diagnostics вернул ошибки (success=false) →
 *          apply_patch применён успешно →
 *          check_diagnostics чистый (success=true).
 * Интерпретируем как «агент успешно починил баг».
 */
function detectFixPattern(db: Database, projectPath: string, history: ToolEvent[]): void {
  if (history.length < 3) return
  const [first, second, third] = history.slice(-3)

  if (
    first.tool === 'check_diagnostics' && !first.success &&
    second.tool === 'apply_patch' && second.success &&
    third.tool === 'check_diagnostics' && third.success
  ) {
    const file = String(second.args['path'] ?? 'unknown')
    const fileName = file.split('/').pop() ?? file.split('\\').pop() ?? file
    saveMemory(
      db,
      projectPath,
      'pattern',
      `Паттерн починки: диагностика нашла ошибку в ${file}, apply_patch исправил, диагностика подтвердила`,
      ['pattern', 'fix', fileName]
    )
  }
}
