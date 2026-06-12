import { ipcMain } from 'electron'
import type { Chats } from '../storage/chats'
import type { ChatSessions } from '../storage/chat-sessions'
import { generateHandoff } from '../ai/handoff'
import type { ChatMessage } from '../ai/types'

/**
 * Тонкий IPC поверх чистого generateHandoff: по sessionId читает сообщения и
 * отдаёт markdown-handoff. Сами сообщения в storage плоские (role + content),
 * поэтому файлы извлекаются через regex-фоллбэк внутри generateHandoff.
 */
export function registerHandoffIpc(chats: Chats, sessions: ChatSessions): void {
  ipcMain.handle('handoff:generate', (_e, sessionId: number, parentId?: string | null) => {
    const session = sessions.get(sessionId)
    const stored = chats.listBySession(sessionId)
    const messages: ChatMessage[] = stored.map(m => ({ role: m.role, content: m.content }))
    return generateHandoff(messages, {
      title: session?.title,
      provider: session?.providerId ?? undefined,
      parentId: parentId ?? null
    })
  })
}
