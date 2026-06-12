import { ipcMain } from 'electron'
import type { Database } from 'better-sqlite3'
import { queryAudit, type AuditEntry } from '../storage/audit-log'
import { getRunInput, type RunInput } from '../storage/run-inputs'
import type { Chats, ChatMessage } from '../storage/chats'

/**
 * Debug Packet — сборка «replay-пакета» для одного агентного запуска (runId):
 * реальный вход, который привёл к ответу. Отладка плохого ответа по фактам:
 * provider/model + точный system prompt + user message + audit trail + сообщения
 * чата. Read-only поверх run_inputs / audit_log / chats.
 */
export interface DebugPacket {
  input: RunInput | null
  audit: AuditEntry[]
  messages: ChatMessage[]
}

export function registerDebugIpc(db: Database, chats: Chats): void {
  ipcMain.handle('debug:packet', (_e, runId: string): DebugPacket => {
    const input = getRunInput(db, runId)
    // audit_log хранит project_path — берём его из снапшота, чтобы вытащить
    // именно записи этого run'а. Без снапшота (CLI / легаси) trail недоступен.
    const audit = input?.projectPath
      ? queryAudit(db, input.projectPath, { runId, limit: 1000 })
      : []
    // Сообщения чата run'а — если известен chatId (он же session_id).
    const messages = input?.chatId != null ? chats.listBySession(input.chatId) : []
    return { input, audit, messages }
  })
}
