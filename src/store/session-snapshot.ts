import type { ChatMessage } from '../types/api'

// Pure, store-agnostic building blocks вынесены из projectStore.ts:
// типы одной сессии/чата + фабрика пустого снапшота + touch-marker данные.
// Здесь НЕТ ничего, что замыкается на zustand set/get, window.api или React —
// только декларации и чистые значения. projectStore импортирует их обратно.

export interface PendingWrite {
  callId: string
  path: string
  before: string
  after: string
  /** sendId of the ai:send that produced this write — used for strict
   *  resolveWrite lookup in main (avoids endsWith-based collisions). */
  sendId?: number
}

export interface PendingCommand {
  callId: string
  command: string
  /** sendId for strict resolve lookup. */
  sendId?: number
}

export interface ActivityEntry {
  id: string
  kind: 'read' | 'list' | 'write' | 'command' | 'blocked'
  label: string
  detail?: string
  status: 'pending' | 'ok' | 'rejected' | 'error' | 'blocked'
  timestamp: number
}

export type TouchKind = 'read' | 'write' | 'list'
export const TOUCH_PRIORITY: Record<TouchKind, number> = { write: 3, read: 2, list: 1 }

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

export interface RunningPlanStep {
  planId: number
  stepId: number
  title: string
}

export interface SessionSnapshot {
  messages: ChatMessage[]
  isStreaming: boolean
  pendingWrites: PendingWrite[]
  pendingCommand: PendingCommand | null
  activity: ActivityEntry[]
  sessionUsage: SessionUsage
  runningPlanStep: RunningPlanStep | null
  /** True when bg session got new content since user last viewed it. */
  hasUnread: boolean
}

export function freshSnapshot(): SessionSnapshot {
  return {
    messages: [],
    isStreaming: false,
    pendingWrites: [],
    pendingCommand: null,
    activity: [],
    sessionUsage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    runningPlanStep: null,
    hasUnread: false
  }
}
