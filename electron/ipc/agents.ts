import { ipcMain } from 'electron'
import type { SubSessions } from '../storage/sub-sessions'
import type { SessionTodos } from '../storage/session-todos'
import type { Chats } from '../storage/chats'
import { subAgentQueue } from '../ai/sub-queue'

/**
 * IPC для панели Agents (Фаза 2, Идея 7) + массовой отмены (Идея 6) +
 * TodoGate (Фаза 3, Идея 2).
 *
 *  - agents:list      → все суб-сессии проекта (running/done/error/cancelled)
 *  - agents:history   → turns одной суб-сессии (для просмотра как SideChat)
 *  - agents:cancel    → массовая отмена: all / по group / по role
 *  - agents:queue-stats → состояние глобальной очереди (in-flight / queued)
 *  - agents:todos     → оркестрационный todo-лист проекта/сессии (живой прогресс)
 */
export function registerAgentsIpc(subSessions: SubSessions, chats: Chats, sessionTodos: SessionTodos): void {
  ipcMain.handle('agents:list', (_e, projectPath: string) => subSessions.listByProject(projectPath))
  ipcMain.handle('agents:history', (_e, subSessionId: number) => chats.listBySession(subSessionId))
  ipcMain.handle('agents:cancel', (_e, filter: { all?: boolean; group?: string | null; role?: string | null }) => {
    return subAgentQueue.cancel(filter ?? {})
  })
  ipcMain.handle('agents:queue-stats', () => subAgentQueue.stats())
  // TodoGate — read-only список для панели. sessionId опционален: null/undefined
  // → весь проект (панель показывает все todo проекта живым списком).
  ipcMain.handle('agents:todos', (_e, projectPath: string, sessionId?: number | null) =>
    sessionTodos.list(projectPath, sessionId ?? undefined))
}
