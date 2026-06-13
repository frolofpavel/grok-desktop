import { ipcMain } from 'electron'
import type { SubSessions } from '../storage/sub-sessions'
import type { Chats } from '../storage/chats'
import { subAgentQueue } from '../ai/sub-queue'

/**
 * IPC для панели Agents (Фаза 2, Идея 7) + массовой отмены (Идея 6).
 *
 *  - agents:list      → все суб-сессии проекта (running/done/error/cancelled)
 *  - agents:history   → turns одной суб-сессии (для просмотра как SideChat)
 *  - agents:cancel    → массовая отмена: all / по group / по role
 *  - agents:queue-stats → состояние глобальной очереди (in-flight / queued)
 */
export function registerAgentsIpc(subSessions: SubSessions, chats: Chats): void {
  ipcMain.handle('agents:list', (_e, projectPath: string) => subSessions.listByProject(projectPath))
  ipcMain.handle('agents:history', (_e, subSessionId: number) => chats.listBySession(subSessionId))
  ipcMain.handle('agents:cancel', (_e, filter: { all?: boolean; group?: string | null; role?: string | null }) => {
    return subAgentQueue.cancel(filter ?? {})
  })
  ipcMain.handle('agents:queue-stats', () => subAgentQueue.stats())
}
