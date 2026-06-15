/**
 * Единый источник правды для «занят ли композер».
 * Renderer не должен полагаться только на ручной toggle isStreaming —
 * сверяем sendOwners + outbound с activeAborts в main process.
 */

type SendOwner =
  | { kind: 'chat'; chatId: number }
  | { kind: 'review'; reviewChatId: number; parentChatId: number }

interface PendingCommand {
  callId: string
  command: string
  sendId?: number
}

interface PendingWrite {
  callId: string
  path: string
  before: string
  after: string
  sendId?: number
}

export function inflightSendForChat(
  sendOwners: Record<number, SendOwner>,
  chatId: number
): number | null {
  for (const [sendId, owner] of Object.entries(sendOwners)) {
    if (owner.kind === 'chat' && owner.chatId === chatId) return Number(sendId)
  }
  return null
}

export function isActiveChatBusy(
  activeChatId: number | null,
  sendOwners: Record<number, SendOwner>,
  outboundChatId: number | null
): boolean {
  if (activeChatId == null) return false
  if (outboundChatId === activeChatId) return true
  return inflightSendForChat(sendOwners, activeChatId) != null
}

export interface ComposerReconcileInput {
  activeChatId: number | null
  isStreaming: boolean
  sendOwners: Record<number, SendOwner>
  outboundChatId: number | null
  pendingCommand: PendingCommand | null
  pendingWrites: PendingWrite[]
}

export interface ComposerReconcilePatch {
  sendOwners?: Record<number, SendOwner>
  isStreaming?: boolean
  outboundChatId?: number | null
  pendingCommand?: PendingCommand | null
  pendingWrites?: PendingWrite[]
}

/**
 * Синхронизирует renderer-state с реально активными sendId из main (activeAborts).
 * Удаляет осиротевшие sendOwners и снимает блокировку композера.
 */
export function buildComposerReconcilePatch(
  state: ComposerReconcileInput,
  activeSendIds: number[]
): ComposerReconcilePatch {
  const active = new Set(activeSendIds)
  const patch: ComposerReconcilePatch = {}
  let sendOwners = state.sendOwners

  let ownersChanged = false
  for (const sendIdStr of Object.keys(sendOwners)) {
    const sendId = Number(sendIdStr)
    if (!active.has(sendId)) {
      if (!ownersChanged) {
        sendOwners = { ...state.sendOwners }
        ownersChanged = true
      }
      delete sendOwners[sendId]
    }
  }
  if (ownersChanged) patch.sendOwners = sendOwners

  const owners = patch.sendOwners ?? state.sendOwners

  // outboundChatId — короткий флаг «ждём ответ ai:send» до registerSendOwner.
  // Если в main нет активных send, outbound точно залип.
  if (state.outboundChatId != null && active.size === 0) {
    patch.outboundChatId = null
  }

  const outbound = patch.outboundChatId !== undefined
    ? patch.outboundChatId
    : state.outboundChatId

  const busy = isActiveChatBusy(state.activeChatId, owners, outbound)
  if (state.isStreaming !== busy) patch.isStreaming = busy

  if (state.pendingCommand?.sendId != null && !active.has(state.pendingCommand.sendId)) {
    patch.pendingCommand = null
  }

  const staleWrites = state.pendingWrites.filter(
    w => w.sendId != null && !active.has(w.sendId)
  )
  if (staleWrites.length > 0) {
    patch.pendingWrites = state.pendingWrites.filter(
      w => w.sendId == null || active.has(w.sendId)
    )
  }

  return patch
}

export function hasComposerReconcileChanges(patch: ComposerReconcilePatch): boolean {
  return Object.keys(patch).length > 0
}