/**
 * Tool handlers — extracted from runApiConversation.
 *
 * Each handler takes a normalized ToolContext + the tool call, and returns a
 * ToolResult. Handlers also have side-effects (UI events, journal entries,
 * attachment collection) that they perform via ctx callbacks.
 *
 * The dispatch table (HANDLER_REGISTRY) maps tool name → handler entry.
 * `mode` controls how the agentic loop schedules execution:
 *
 *   'parallel-read' — pure-info tools (read_file/list_directory/search_project/
 *                     find_files/get_project_map/refresh_project_map).
 *                     Fired in parallel via Promise.all — no UI side effects
 *                     or shared mutable state.
 *
 *   'sequential'    — tools that need to run in order or have UI effects
 *                     (run_command, browser_*, list_connectors,
 *                     connector_query, create_plan).
 *
 *   'confirm-write' — tools that go through the multi-file diff confirm
 *                     modal (write_file, apply_patch, propose_edits). Collected
 *                     into writePromises and awaited together so the user gets
 *                     ONE modal for all writes in a turn.
 */

import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Attachment, ToolCall, ToolResult } from '../ai/types'
import { applySearchReplaceBlocks, type FileTools } from '../ai/tools'
import { decide, blockReason, type AgentMode } from '../ai/mode-policy'
import { classifyMcpToolScope, mcpDecision, mcpBlockReason } from '../ai/mcp-policy'
import { getRolePrompt } from '../ai/agent-roles'
import { invalidateProjectMap, markFileDirty } from '../ai/project-map'
import type { McpClient } from '../mcp/client'
import type { ProviderId } from '../ai/registry'

const execFileAsync = promisify(execFile)

// Таймаут на одну делегированную подзадачу. Поднят с 60с (one-shot эра) до 180с:
// субагент теперь крутит agent-loop с tool-вызовами (read/patch/run_command),
// что требует заметно больше времени. Лимит итераций (MAX_SUB_ITERATIONS) —
// вторая, независимая граница; таймаут страхует от зависшего провайдера/команды.
const SUB_TASK_TIMEOUT_MS = 180_000

// Cost-cap на ОДИН delegate_parallel вызов (помимо cap всей сессии из Settings).
// Защищает от батча из 30 задач, который один пожрёт весь бюджет: при превышении
// оставшиеся задачи батча не стартуют. В центах. Дефолт $3 — можно переопределить
// аргументом cost_cap_usd у delegate_parallel.
const DEFAULT_BATCH_COST_CAP_CENTS = 300

// ============================================================================
// Types
// ============================================================================

/** Stable identifier for an in-flight `ai:send` call. */
export type SendId = number

export interface TaggedSender {
  send: (channel: string, payload: { id: SendId; event: unknown }) => void
  exec: (code: string) => Promise<unknown>
}

export interface ConnectorRegistry {
  list: () => Array<{ id: string; label: string; kind: string; status: string; detail?: string }>
  query: (id: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
}

/** Context every tool handler receives. */
export interface ToolContext {
  sender: TaggedSender
  sendId: SendId
  signal: AbortSignal
  projectPath: string
  tools: FileTools
  recordWrite: (projectPath: string, filePath: string, before: string, after: string) => void
  recordPlan: (projectPath: string, title: string, steps: Array<{ title: string; detail?: string | null }>) => { id: number }
  recordJournal: (projectPath: string, kind: 'tool' | 'session' | 'note', title: string, detail?: string | null) => void
  /** Read recent journal entries — used by the `read_journal` AI tool for self-reflection. */
  readJournal: (projectPath: string, limit: number) => Array<{ kind: string; title: string; detail: string | null; createdAt: number }>
  /** Сохранить запись в долговременную память проекта. */
  saveMemory: (projectPath: string, type: string, content: string, tags: string[]) => { id: string }
  /** Поиск по долговременной памяти проекта. */
  searchMemories: (projectPath: string, query: string, limit: number) => Array<{ id: string; type: string; content: string; tags: string[]; created_at: number }>
  /** Полнотекстовый поиск по истории разговоров проекта. */
  searchConversations: (projectPath: string, query: string, limit: number) => Array<{ session_id: number; role: string; content: string; created_at: number }>
  connectors: ConnectorRegistry
  /** Mutated by browser_screenshot; flushed by the agent loop into next user msg. */
  pendingAttachments: Attachment[]
  /** Shared maps used by the diff-confirm flow. */
  pendingWrites: Map<string, { sendId: SendId; resolve: (accept: boolean) => void }>
  pendingCommands: Map<string, { sendId: SendId; resolve: (accept: boolean) => void }>
  scopedKey: (sendId: SendId, callId: string) => string
  /** Active agent mode — controls auto-accept / confirm / block per tool. */
  agentMode: AgentMode
  /** Skill registry для delegate_task (опционально — V3 фича). */
  skillRegistry?: {
    list: () => Array<{ id: string; name?: string; default_provider?: string; default_model?: string; systemPrompt: string }>
  }
  /** Secret reader для delegate_task — нужен чтобы достать API key
   *  альтернативного провайдера. */
  getSecretForDelegate?: (key: string) => string | null
  /** ID текущего провайдера чата — используется как fallback в delegate_task. */
  currentProviderId?: string
  /** MCP client для роутинга вызовов внешних MCP-инструментов. */
  mcpClient?: McpClient
  /** Опциональный аппендер в audit_log — вызывается после каждого tool call. */
  appendAudit?: (action: string, detail: string) => void
  /** Cost guard сессии — прокидывается в sub-agent loop, чтобы токены субагентов
   *  учитывались в общий cap (Фаза 1 мультиагентности). */
  subCostGuard?: import('../ai/cost-guard').CostGuard
  /** Provider id субагента — для cost-guard учёта внутри sub-loop. */
  subProviderId?: import('../ai/registry').ProviderId
  /** Модель субагента — для cost-guard учёта внутри sub-loop. */
  subModel?: string
  /** ID главного чата — родитель для персистентных суб-сессий (Фаза 2). */
  parentChatId?: number | null
  /** Фасад TodoGate (Фаза 3, Идея 2) — оркестрационный todo-лист сессии.
   *  Опционально: без него todo_* tools вернут понятную ошибку. */
  sessionTodos?: {
    createBatch: (opts: { projectPath: string; sessionId: number | null; goal?: string | null; titles: string[] }) => Array<{ id: number; title: string; status: string; ord: number }>
    update: (id: number, patch: { status?: string; assigneeCallId?: string | null }) => void
    list: (projectPath: string, sessionId?: number | null) => Array<{ id: number; title: string; status: string; assigneeCallId: string | null; ord: number }>
    findByTitle: (projectPath: string, sessionId: number | null, title: string) => { id: number; title: string; status: string } | null
  }
  /** Фасад персистентных суб-сессий (Фаза 2, Идея 1). Опционально — без него
   *  субагенты работают как прежде (только эфемерная карточка). */
  subSessions?: {
    create: (opts: { projectPath: string; parentChatId: number | null; role?: string | null; task?: string | null; group?: string | null; callId?: string | null; providerId?: string | null; model?: string | null }) => number
    update: (id: number, patch: { status?: string; toolCount?: number; costCents?: number; endedAt?: number }) => void
    /** Сохранить одно сообщение turn суба (user/assistant) в историю сессии. */
    appendMessage: (subSessionId: number, projectPath: string, role: 'user' | 'assistant', content: string) => void
  }
}

export type ToolMode = 'parallel-read' | 'sequential' | 'confirm-write'

export interface ToolHandler {
  mode: ToolMode
  handle(call: ToolCall, ctx: ToolContext): Promise<ToolResult>
}

// ============================================================================
// Activity event helper
// ============================================================================

function emitActivity(ctx: ToolContext, call: ToolCall, status: 'ok' | 'error', label: string, detail: string): void {
  ctx.sender.send('ai:event', {
    id: ctx.sendId,
    event: { type: 'tool-activity', callId: call.id, name: call.name, label, detail, status }
  })
  // Audit log — fire-and-forget, не критично
  if (ctx.appendAudit) {
    try {
      const auditDetail = JSON.stringify({ callId: call.id, status, detail: detail.slice(0, 200) })
      ctx.appendAudit(status === 'error' ? 'error' : 'tool_call', auditDetail)
    } catch { /* not critical */ }
  }
}

/** Short human-readable summary of a tool call for the activity stream. */
export function summarizeToolCall(name: string, args: Record<string, unknown>, result: unknown): { label: string; detail: string } | null {
  if (name === 'read_file') {
    const p = String(args.path ?? '')
    const len = typeof result === 'string' ? result.length : 0
    return { label: 'read_file', detail: `${p} · ${len} символов` }
  }
  if (name === 'list_directory') {
    const p = String(args.path ?? '.')
    const count = Array.isArray(result) ? result.length : 0
    return { label: 'list_directory', detail: `${p} · ${count} элементов` }
  }
  if (name === 'search_project') {
    const q = String(args.query ?? '')
    const r = result as { matches?: unknown[] } | undefined
    const hits = Array.isArray(r?.matches) ? r!.matches!.length : 0
    return { label: 'search_project', detail: `"${q}" · ${hits} совпадений` }
  }
  if (name === 'find_files') {
    const pattern = String(args.pattern ?? '')
    const r = result as { files?: unknown[] } | undefined
    const hits = Array.isArray(r?.files) ? r!.files!.length : 0
    return { label: 'find_files', detail: `${pattern} · ${hits} файлов` }
  }
  if (name === 'list_connectors') {
    const arr = typeof result === 'string' ? JSON.parse(result) as Array<{ label?: string }> : []
    return { label: 'list_connectors', detail: `${arr.length} коннекторов` }
  }
  if (name === 'connector_query') {
    return { label: 'connector_query', detail: `${String(args.id ?? '?')}${args.entity ? ` · ${args.entity}` : ''}` }
  }
  if (name === 'browser_navigate') {
    return { label: 'browser_navigate', detail: String(args.url ?? '') }
  }
  if (name === 'browser_read_page') {
    return { label: 'browser_read_page', detail: args.selector ? String(args.selector) : '(вся страница)' }
  }
  if (name === 'browser_screenshot') {
    return { label: 'browser_screenshot', detail: '' }
  }
  if (name === 'get_project_map' || name === 'refresh_project_map') {
    return { label: name, detail: '' }
  }
  return null
}

// ============================================================================
// Default handler for read-only / pure-info tools
// ============================================================================

const readHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const result = await ctx.tools.execute(call.name, call.args)
      const s = summarizeToolCall(call.name, call.args, result)
      if (s) emitActivity(ctx, call, 'ok', s.label, s.detail)
      return { id: call.id, name: call.name, result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// File ops: write_file, apply_patch, propose_edits
// ============================================================================

async function diffConfirmWrite(call: ToolCall, ctx: ToolContext, path: string, before: string, after: string): Promise<ToolResult> {
  const decision = decide(call.name, ctx.agentMode)
  if (decision === 'block') {
    return { id: call.id, name: call.name, result: '', error: blockReason(call.name, ctx.agentMode) }
  }
  let accepted: boolean
  if (decision === 'auto-accept') {
    // Skip user prompt — still surface the diff via tool-activity for visibility
    ctx.sender.send('ai:event', {
      id: ctx.sendId,
      event: { type: 'tool-activity', callId: call.id, name: call.name, label: `${call.name} (авто)`, detail: path, status: 'ok' }
    })
    accepted = true
  } else {
    // 'confirm' — show diff modal and wait
    ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'pending-write', callId: call.id, path, before, after } })
    accepted = await new Promise<boolean>(resolve => {
      ctx.pendingWrites.set(ctx.scopedKey(ctx.sendId, call.id), { sendId: ctx.sendId, resolve })
    })
  }
  if (!accepted) {
    return { id: call.id, name: call.name, result: `User rejected write to ${path}`, error: 'User rejected' }
  }
  try {
    await ctx.tools.execute('write_file', { path, content: after })
    try { ctx.recordWrite(ctx.projectPath, path, before, after) } catch { /* undo not critical */ }
    // Incremental project map update — mark file dirty instead of full rebuild
    markFileDirty(ctx.projectPath, join(ctx.projectPath, path))
    return { id: call.id, name: call.name, result: `Applied ${call.name === 'apply_patch' ? 'patch' : 'write'} to ${path}` }
  } catch (err) {
    return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
  }
}

async function readBeforeContent(ctx: ToolContext, path: string): Promise<string> {
  try {
    let before = await ctx.tools.execute('read_file', { path }) as string
    // Strip the secret-scanner header line from read_file output before
    // computing the patch — it isn't actually in the file.
    if (before.startsWith('[secret-scanner: redacted')) {
      const nl = before.indexOf('\n')
      if (nl >= 0) before = before.slice(nl + 1)
    }
    return before
  } catch { return '' }
}

const writeFileHandler: ToolHandler = {
  mode: 'confirm-write',
  async handle(call, ctx) {
    const path = String(call.args.path)
    const before = await readBeforeContent(ctx, path)
    const after = String(call.args.content ?? '')
    return diffConfirmWrite(call, ctx, path, before, after)
  }
}

const applyPatchHandler: ToolHandler = {
  mode: 'confirm-write',
  async handle(call, ctx) {
    const path = String(call.args.path)
    const before = await readBeforeContent(ctx, path)
    const anchorHash = call.args.anchor_hash ? String(call.args.anchor_hash) : undefined
    let after: string
    try {
      after = applySearchReplaceBlocks(before, String(call.args.diff ?? ''), anchorHash)
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
    return diffConfirmWrite(call, ctx, path, before, after)
  }
}

interface ProposeEdit { path: string; content: string; reason?: string }

const proposeEditsHandler: ToolHandler = {
  mode: 'confirm-write',
  async handle(call, ctx) {
    const rawEdits = Array.isArray(call.args.edits) ? call.args.edits : []
    const edits: ProposeEdit[] = rawEdits
      .filter((e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map((e) => ({
        path: String((e as Record<string, unknown>).path ?? ''),
        content: String((e as Record<string, unknown>).content ?? ''),
        reason: (e as Record<string, unknown>).reason != null ? String((e as Record<string, unknown>).reason) : undefined
      }))
      .filter(e => e.path.length > 0)
    if (edits.length === 0) {
      return { id: call.id, name: call.name, result: '', error: 'propose_edits: no edits in batch' }
    }
    // Fan out: one synthetic confirm-write per edit. They all hit the same
    // multi-file modal (renderer accumulates pending writes).
    const subResults: ToolResult[] = []
    for (const edit of edits) {
      const subId = `${call.id}::${randomUUID()}`
      const before = await readBeforeContent(ctx, edit.path)
      const subCall: ToolCall = {
        id: subId,
        name: 'write_file',
        args: { path: edit.path, content: edit.content },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {})
      }
      const r = await diffConfirmWrite(subCall, ctx, edit.path, before, edit.content)
      subResults.push(r)
    }
    const ok = subResults.filter(r => !r.error).length
    const total = subResults.length
    return {
      id: call.id,
      name: call.name,
      result: `Applied ${ok}/${total} edits. ${subResults.map(r => r.error ? `✗ ${r.error}` : `✓ ${r.result}`).join('; ')}`,
      ...(ok === 0 ? { error: 'All edits rejected or failed' } : {})
    }
  }
}

// ============================================================================
// Command: run_command
// ============================================================================

const runCommandHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    const command = String(call.args.command ?? '')
    const verdict = ctx.tools.classifyCommand(command)
    if (!verdict.allowed) {
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-blocked', callId: call.id, name: 'run_command', command, reason: verdict.reason ?? 'denylist' }
      })
      return {
        id: call.id, name: call.name,
        result: `Command: ${command}`,
        error: `Blocked by safety policy: ${verdict.reason ?? 'denylist'}`
      }
    }
    // Mode policy: plan blocks, ask confirms, auto/bypass auto-accept,
    // accept-edits still confirms commands (only edits auto-pass).
    const decision = decide('run_command', ctx.agentMode)
    if (decision === 'block') {
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-blocked', callId: call.id, name: 'run_command', command, reason: blockReason('run_command', ctx.agentMode) }
      })
      return { id: call.id, name: call.name, result: '', error: blockReason('run_command', ctx.agentMode) }
    }
    let accepted: boolean
    if (decision === 'auto-accept') {
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-activity', callId: call.id, name: 'run_command', label: 'run_command (авто)', detail: command, status: 'ok' }
      })
      accepted = true
    } else {
      ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'pending-command', callId: call.id, command } })
      accepted = await new Promise<boolean>(resolve => {
        ctx.pendingCommands.set(ctx.scopedKey(ctx.sendId, call.id), { sendId: ctx.sendId, resolve })
      })
    }
    if (!accepted) {
      ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'command-result', callId: call.id, command, status: 'rejected' } })
      return { id: call.id, name: call.name, result: `Command: ${command}`, error: 'User rejected' }
    }
    try {
      const result = await ctx.tools.runCommand(command)
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'command-result', callId: call.id, command, status: 'ok', exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
      })
      return { id: call.id, name: call.name, result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'command-result', callId: call.id, command, status: 'error', error: msg }
      })
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Browser: navigate / read_page / screenshot
// ============================================================================

async function dispatchBrowser(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  try {
    // Args are JSON-stringified once and embedded via JSON.stringify(JSON.stringify(...))
    // so the runtime JSON.parse is the only thing that touches LLM-supplied data.
    const argsLiteral = JSON.stringify(JSON.stringify(call.args ?? {}))
    let action: string
    if (call.name === 'browser_navigate') {
      action = `return await api.navigate(String(a.url ?? ''));`
    } else if (call.name === 'browser_read_page') {
      action = `const text = await api.readPage(a.selector ? String(a.selector) : undefined);
                return { url: api.getURL(), title: api.getTitle(), text };`
    } else {
      action = `const dataUrl = await api.screenshot();
                return { url: api.getURL(), dataUrl };`
    }
    const snippet = `(async () => {
      const api = window.verstakBrowser;
      if (!api) return { __err: 'Вкладка Browser не открыта — попроси пользователя открыть её' };
      const a = JSON.parse(${argsLiteral});
      ${action}
    })()`
    const result = await ctx.sender.exec(snippet)
    if (result && typeof result === 'object' && '__err' in result) {
      return { id: call.id, name: call.name, result: '', error: String((result as { __err: unknown }).__err) }
    }
    return { id: call.id, name: call.name, result: result ?? '' }
  } catch (err) {
    return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
  }
}

const browserHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    const result = await dispatchBrowser(call, ctx)
    // Journal what AI looked at on the web
    try {
      if (!result.error) {
        const url = String(call.args.url ?? '')
        const label = call.name === 'browser_navigate' ? `Браузер → ${url}`
                    : call.name === 'browser_read_page' ? `Браузер: прочитан текст`
                    : `Браузер: скриншот`
        ctx.recordJournal(ctx.projectPath, 'tool', label, null)
      }
    } catch { /* journal not critical */ }
    // Screenshot → queue as attachment for next user message
    if (call.name === 'browser_screenshot' && !result.error) {
      const r = result.result as { dataUrl?: string; url?: string } | string
      const dataUrl = typeof r === 'object' && r ? r.dataUrl : undefined
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        const m = /^data:(image\/[\w+-]+);base64,(.+)$/.exec(dataUrl)
        if (m) {
          ctx.pendingAttachments.push({
            name: `screenshot-${Date.now()}.png`,
            mimeType: m[1],
            data: m[2],
            size: Math.floor(m[2].length * 0.75)
          })
          result.result = { url: typeof r === 'object' ? r.url : null, attached: true }
        }
      }
    }
    const s = summarizeToolCall(call.name, call.args, undefined)
    if (s) emitActivity(ctx, call, result.error ? 'error' : 'ok', s.label, s.detail)
    return result
  }
}

// ============================================================================
// Connectors: list_connectors, connector_query
// ============================================================================

const listConnectorsHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    const list = ctx.connectors.list()
    const result = JSON.stringify(list)
    const s = summarizeToolCall(call.name, call.args, result)
    if (s) emitActivity(ctx, call, 'ok', s.label, s.detail)
    return { id: call.id, name: call.name, result }
  }
}

const connectorQueryHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const cid = String(call.args.id ?? '')
      if (!cid) {
        return { id: call.id, name: call.name, result: '', error: 'connector_query: id обязателен' }
      }
      // Mode policy: коннекторы трогают внешние системы (SSH, HTTP POST,
      // GitHub write), поэтому гейтятся как команда — plan блокирует, ask подтверждает,
      // auto/bypass авто-принимают. Описание запроса показываем пользователю в модалке.
      const entity = call.args.entity ? ` · ${call.args.entity}` : ''
      const path = call.args.path ? ` · ${call.args.path}` : ''
      const summary = `Коннектор ${cid}${entity}${path}`
      const decision = decide('connector_query', ctx.agentMode)
      if (decision === 'block') {
        const reason = blockReason('connector_query', ctx.agentMode)
        ctx.sender.send('ai:event', {
          id: ctx.sendId,
          event: { type: 'tool-blocked', callId: call.id, name: 'connector_query', command: summary, reason }
        })
        return { id: call.id, name: call.name, result: '', error: reason }
      }
      let accepted: boolean
      if (decision === 'auto-accept') {
        accepted = true
      } else {
        // 'confirm' — переиспользуем pending-command поток (та же модалка подтверждения)
        ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'pending-command', callId: call.id, command: summary } })
        accepted = await new Promise<boolean>(resolve => {
          ctx.pendingCommands.set(ctx.scopedKey(ctx.sendId, call.id), { sendId: ctx.sendId, resolve })
        })
      }
      if (!accepted) {
        ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'command-result', callId: call.id, command: summary, status: 'rejected' } })
        return { id: call.id, name: call.name, result: summary, error: 'User rejected' }
      }
      const { id: _omit, ...rest } = call.args as Record<string, unknown> & { id?: unknown }
      void _omit
      const result = await ctx.connectors.query(cid, rest, ctx.signal)
      const s = summarizeToolCall(call.name, call.args, undefined)
      if (s) emitActivity(ctx, call, 'ok', s.label, s.detail)
      // Journal connector queries
      try {
        const entity = call.args.entity ? ` · ${call.args.entity}` : ''
        const path = call.args.path ? ` · ${call.args.path}` : ''
        ctx.recordJournal(ctx.projectPath, 'tool', `Коннектор ${cid}${entity}${path}`, null)
      } catch { /* journal not critical */ }
      return { id: call.id, name: call.name, result: typeof result === 'string' ? result : JSON.stringify(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      try { ctx.recordJournal(ctx.projectPath, 'tool', `Коннектор упал: ${String(call.args.id ?? '?')}`, msg) } catch { /* journal not critical */ }
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Plans: create_plan
// ============================================================================

const readJournalHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    const requestedLimit = typeof call.args.limit === 'number' ? Math.max(1, Math.min(100, Math.floor(call.args.limit))) : 30
    const kindFilter = typeof call.args.kind === 'string' ? call.args.kind : null
    try {
      const all = ctx.readJournal(ctx.projectPath, requestedLimit * 3)
      const filtered = kindFilter ? all.filter(e => e.kind === kindFilter) : all
      const result = filtered.slice(0, requestedLimit).map(e => ({
        kind: e.kind,
        title: e.title,
        detail: e.detail ? e.detail.slice(0, 500) : null,  // cap so journal doesn't blow context
        when: new Date(e.createdAt).toISOString()
      }))
      emitActivity(ctx, call, 'ok', 'read_journal', `${result.length} записей${kindFilter ? ` · kind=${kindFilter}` : ''}`)
      return { id: call.id, name: call.name, result: JSON.stringify(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// delegate_task — мультиагент V1
// ============================================================================

const delegateTaskHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const skillId = call.args.skill_id ? String(call.args.skill_id) : null
      const providerOverride = call.args.provider_id ? String(call.args.provider_id) : null
      const modelOverride = call.args.model ? String(call.args.model) : null
      const role = call.args.role ? String(call.args.role) : null
      const prompt = String(call.args.prompt ?? '').trim()
      if (!prompt) {
        return { id: call.id, name: call.name, result: '', error: 'delegate_task: prompt обязателен' }
      }

      // Скилл — опционально. Если задан, тащим его системный промпт + default provider/model.
      const skills = ctx.skillRegistry ? ctx.skillRegistry.list() : []
      const skill = skillId ? skills.find(s => s.id === skillId) ?? null : null

      const subProvider = providerOverride
        ?? skill?.default_provider
        ?? null  // null → ai:send возьмёт текущий default из settings
      const subModel = modelOverride ?? skill?.default_model ?? null
      // Промпт субагента: роль (если задана) + скилл/generic. Роль определяет
      // и поведение, и набор tools (getRoleToolset). С tool-enabled loop'ом
      // важно явно сказать субу, что у него ЕСТЬ инструменты.
      const rolePrompt = role ? getRolePrompt(role) : null
      const systemPrompt = rolePrompt
        ?? skill?.systemPrompt
        ?? 'Ты — sub-agent с доступом к инструментам (чтение файлов, поиск по проекту). Выполни узкую задачу, при необходимости используй tools, ответь по существу.'

      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: {
          type: 'tool-activity',
          callId: call.id,
          name: 'delegate_task',
          label: 'delegate_task',
          detail: `${skill?.name ?? skillId ?? role ?? 'generic'} via ${subProvider ?? 'auto'}`,
          status: 'ok'
        }
      })

      // subagent-run visibility (fan-out V1) — additive card в чате. label/skill/
      // provider/task + status running → done/error + tool-счётчик (Фаза 1).
      const subLabel = skill?.name ?? skillId ?? role ?? 'sub-agent'
      let toolCount = 0
      const emitSubagent = (status: 'running' | 'done' | 'error', result?: string) => {
        ctx.sender.send('ai:event', {
          id: ctx.sendId,
          event: {
            type: 'subagent-run',
            callId: call.id,
            label: subLabel,
            provider: subProvider ?? undefined,
            skill: skillId ?? undefined,
            role: role ?? undefined,
            toolCount,
            task: prompt,
            status,
            result
          }
        })
      }
      emitSubagent('running')

      // Персистентная суб-сессия (Фаза 2, Идея 1): создаём строку kind='subagent',
      // привязанную к главному чату. Промпт суба сохраняем как первое сообщение.
      // Без subSessions фасада — работает как прежде (только эфемерная карточка).
      let subSessionId: number | null = null
      if (ctx.subSessions) {
        try {
          subSessionId = ctx.subSessions.create({
            projectPath: ctx.projectPath,
            parentChatId: ctx.parentChatId ?? null,
            role, task: prompt, callId: call.id,
            providerId: subProvider ?? ctx.currentProviderId ?? null,
            model: subModel ?? null
          })
          ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'user', prompt)
        } catch { /* persist не критично — карточка всё равно покажется */ }
      }
      const finalizeSub = (status: string, assistant?: string) => {
        if (subSessionId == null || !ctx.subSessions) return
        try {
          if (assistant) ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'assistant', assistant)
          ctx.subSessions.update(subSessionId, { status, endedAt: Date.now() })
        } catch { /* persist не критично */ }
      }

      const { createProvider, PROVIDERS } = await import('../ai/registry')
      const { runSubAgentLoop } = await import('../ai/sub-agent-loop')
      const { getRoleToolset } = await import('../ai/role-tools')
      const fallbackProvider = subProvider ?? ctx.currentProviderId ?? null
      if (!fallbackProvider) {
        emitSubagent('error', 'нет провайдера')
        finalizeSub('error')
        return { id: call.id, name: call.name, result: '', error: 'delegate_task: provider_id не задан и у текущего чата нет провайдера. Укажи provider_id явно.' }
      }
      const descriptor = PROVIDERS[fallbackProvider as keyof typeof PROVIDERS]
      if (!descriptor) {
        emitSubagent('error', `неизвестный provider ${fallbackProvider}`)
        finalizeSub('error')
        return { id: call.id, name: call.name, result: '', error: `delegate_task: неизвестный provider ${fallbackProvider}` }
      }
      const apiKey = descriptor.secretKey ? ctx.getSecretForDelegate?.(descriptor.secretKey) ?? null : null
      if (descriptor.secretKey && !apiKey) {
        emitSubagent('error', `нет API key для ${fallbackProvider}`)
        finalizeSub('error')
        return { id: call.id, name: call.name, result: '', error: `delegate_task: нет API key для ${fallbackProvider}` }
      }

      // Per-task signal: проброс родительского abort + таймаут на весь loop.
      // 180с (было 60с для one-shot) — loop с tool-вызовами требует больше времени.
      const taskAc = new AbortController()
      const timeoutId = setTimeout(() => taskAc.abort(), SUB_TASK_TIMEOUT_MS)
      const parentAbortHandler = () => taskAc.abort()
      ctx.signal.addEventListener('abort', parentAbortHandler, { once: true })

      // Глобальная очередь (Идея 6): ждём слот в семафоре процесса. Группа —
      // опциональный group-тег, чтобы суб можно было отменить массово.
      const { subAgentQueue } = await import('../ai/sub-queue')
      const groupTag = call.args.group ? String(call.args.group) : null
      let queueSlot: { release: () => void; ticketId: number } | null = null
      try {
        queueSlot = await subAgentQueue.enter({ group: groupTag, role, abort: () => taskAc.abort() }, taskAc.signal)
      } catch {
        clearTimeout(timeoutId)
        ctx.signal.removeEventListener('abort', parentAbortHandler)
        emitSubagent('error', 'отменён в очереди')
        finalizeSub('cancelled')
        return { id: call.id, name: call.name, result: '', error: 'delegate_task: задача отменена в очереди' }
      }

      try {
        const provider = createProvider(fallbackProvider as keyof typeof PROVIDERS, {
          apiKey,
          model: subModel ?? descriptor.defaultModel,
          cwd: ctx.projectPath,
          signal: taskAc.signal
        })
        // Whitelist tools по роли (если роль не задана — read-only default).
        const allowedTools = getRoleToolset(role)
        const subCtx: ToolContext = {
          ...ctx,
          subProviderId: fallbackProvider as ProviderId,
          subModel: subModel ?? descriptor.defaultModel
        }
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt }
        ]
        const res = await runSubAgentLoop({
          provider, messages, allowedToolNames: allowedTools, ctx: subCtx,
          signal: taskAc.signal, role,
          onToolActivity: () => { toolCount++; emitSubagent('running') }
        })
        if (res.exitReason === 'error') {
          emitSubagent('error', res.error)
          finalizeSub('error', res.text.trim() || undefined)
          return { id: call.id, name: call.name, result: '', error: `delegate_task error: ${res.error}` }
        }
        const trimmed = res.text.trim()
        if (!trimmed) {
          emitSubagent('error', 'sub-agent вернул пустой ответ')
          finalizeSub('error')
          return { id: call.id, name: call.name, result: '', error: 'delegate_task: sub-agent вернул пустой ответ' }
        }
        emitSubagent('done', trimmed.length > 1200 ? trimmed.slice(0, 1200) + '…' : trimmed)
        finalizeSub(res.exitReason === 'aborted' ? 'cancelled' : 'done', trimmed)
        try {
          ctx.recordJournal(ctx.projectPath, 'note',
            `🎭 Делегирование → ${skill?.name ?? skillId ?? role ?? fallbackProvider} (${res.toolCallCount} tools, ${res.exitReason})`,
            `Запрос: ${prompt.slice(0, 200)}\n---\nОтвет: ${trimmed.slice(0, 600)}${trimmed.length > 600 ? '…' : ''}`)
        } catch { /* journal не критично */ }
        return { id: call.id, name: call.name, result: `[Delegate from ${skill?.name ?? skillId ?? role ?? fallbackProvider}]\n\n${trimmed}` }
      } finally {
        clearTimeout(timeoutId)
        ctx.signal.removeEventListener('abort', parentAbortHandler)
        queueSlot?.release()
      }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ============================================================================
// delegate_parallel — мультиагент V2: параллельное выполнение N задач
// ============================================================================

const delegateParallelHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const tasks = call.args.tasks as Array<{ id: string; prompt: string; provider_id?: string; model?: string; role?: string }> | undefined
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return { id: call.id, name: call.name, result: '', error: 'delegate_parallel: tasks обязателен и не должен быть пустым' }
      }
      // Потолок поднят до 50 (было 12): задачи держатся в глобальной очереди
      // (sub-queue), а одновременно стримит не больше GLOBAL_SUB_CONCURRENCY —
      // т.е. 50 в очереди не убивают провайдер. См. Фаза 2, Идея 6.
      const MAX_PARALLEL = 50
      if (tasks.length > MAX_PARALLEL) {
        return { id: call.id, name: call.name, result: '', error: `delegate_parallel: максимум ${MAX_PARALLEL} задач в одном батче` }
      }

      // Группа/тег батча — для массовой отмены «по тегу» (Идея 6). Если не задан
      // явно — используем callId как авто-группу, чтобы можно было отменить весь
      // этот конкретный delegate_parallel разом.
      const groupTag = call.args.group ? String(call.args.group) : call.id

      // Cost-cap на весь батч (Идея 6): помимо cap всей сессии. Параметр
      // cost_cap_usd опционален; дефолт — DEFAULT_BATCH_COST_CAP_CENTS.
      const batchCapCents = typeof call.args.cost_cap_usd === 'number' && call.args.cost_cap_usd > 0
        ? Math.round(call.args.cost_cap_usd * 100)
        : DEFAULT_BATCH_COST_CAP_CENTS
      // Стартовая стоимость сессии — батч считаем как прирост сверх неё.
      const batchStartCents = ctx.subCostGuard?.current() ?? 0
      // Флаг «батч превысил cap» — взводится первой задачей, которая увидела
      // превышение; остальные ожидающие задачи в очереди не стартуют.
      let batchCapped = false

      const { createProvider, PROVIDERS } = await import('../ai/registry')
      const { subAgentQueue, GLOBAL_SUB_CONCURRENCY } = await import('../ai/sub-queue')

      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: {
          type: 'tool-activity',
          callId: call.id,
          name: 'delegate_parallel',
          label: 'delegate_parallel',
          detail: `${tasks.length} задач (очередь, ≤${GLOBAL_SUB_CONCURRENCY} разом)`,
          status: 'ok'
        }
      })

      const { runSubAgentLoop } = await import('../ai/sub-agent-loop')
      const { getRoleToolset } = await import('../ai/role-tools')

      // Запускаем ВСЕ задачи сразу — глобальный семафор сам ограничит реальную
      // одновременность. Это даёт честную очередь (а не локальные батчи по 4).
      const results = await Promise.allSettled(tasks.map(async (task) => {
        // Идея 9: provider задаётся per-task → в одном батче можно смешивать
        // grok (API) и grok-cli (Grok Build). Здесь каждая задача независимо
        // резолвит свой провайдер.
        const providerId = task.provider_id ?? ctx.currentProviderId ?? 'grok'

        // subagent-run visibility (fan-out V2) — каждая параллельная задача
        // показывается как своя карточка. Distinct callId `${call.id}:${task.id}`
        // → upsert по callId, обновление status running → done/error в месте.
        // Добавлена явная маркировка Grok Build (согласуется с полировкой провайдеров).
        const subCallId = `${call.id}:${task.id}`
        const isGrokBuild = providerId === 'grok-cli'
        const baseLabel = task.role ?? task.id
        const displayLabel = isGrokBuild ? `${baseLabel} (Grok Build)` : baseLabel
        let toolCount = 0

        const emitSubagent = (status: 'running' | 'done' | 'error', result?: string) => {
          ctx.sender.send('ai:event', {
            id: ctx.sendId,
            event: {
              type: 'subagent-run',
              callId: subCallId,
              label: displayLabel,
              provider: providerId,
              role: task.role,
              toolCount,
              task: task.prompt,
              status,
              result
            }
          })
        }
        emitSubagent('running')

        // Персистентная суб-сессия (Идея 1). Каждая задача батча — своя сессия.
        let subSessionId: number | null = null
        if (ctx.subSessions) {
          try {
            subSessionId = ctx.subSessions.create({
              projectPath: ctx.projectPath,
              parentChatId: ctx.parentChatId ?? null,
              role: task.role ?? null, task: task.prompt, group: groupTag, callId: subCallId,
              providerId, model: task.model ?? null
            })
            ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'user', task.prompt)
          } catch { /* persist не критично */ }
        }
        const finalizeSub = (status: string, assistant?: string) => {
          if (subSessionId == null || !ctx.subSessions) return
          try {
            if (assistant) ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'assistant', assistant)
            ctx.subSessions.update(subSessionId, { status, toolCount, endedAt: Date.now() })
          } catch { /* persist не критично */ }
        }

        const descriptor = PROVIDERS[providerId as keyof typeof PROVIDERS]
        if (!descriptor) {
          emitSubagent('error', `неизвестный provider ${providerId}`)
          finalizeSub('error')
          throw new Error(`неизвестный provider ${providerId}`)
        }
        const apiKey = descriptor.secretKey ? ctx.getSecretForDelegate?.(descriptor.secretKey) ?? null : null
        if (descriptor.secretKey && !apiKey) {
          emitSubagent('error', `нет API key для ${providerId}`)
          finalizeSub('error')
          throw new Error(`нет API key для ${providerId}`)
        }

        // Per-task AbortController. Таймаут поднят с 60с до 180с — субагент
        // теперь крутит tool-loop. Родительский signal прерывает подзадачу.
        const taskAc = new AbortController()
        const timeoutId = setTimeout(() => taskAc.abort(), SUB_TASK_TIMEOUT_MS)
        const parentAbortHandler = () => taskAc.abort()
        ctx.signal.addEventListener('abort', parentAbortHandler, { once: true })

        // Глобальная очередь: ждём слот. Если батч уже превысил cost-cap пока
        // мы стояли в очереди — не стартуем (экономим деньги).
        let queueSlot: { release: () => void; ticketId: number } | null = null
        try {
          queueSlot = await subAgentQueue.enter({ group: groupTag, role: task.role ?? null, abort: () => taskAc.abort() }, taskAc.signal)
        } catch {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          emitSubagent('error', 'отменён в очереди')
          finalizeSub('cancelled')
          throw new Error('отменён в очереди')
        }
        if (batchCapped) {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          queueSlot.release()
          emitSubagent('error', 'батч остановлен по cost-cap')
          finalizeSub('cancelled')
          throw new Error('батч остановлен по cost-cap')
        }

        try {
          const subModel = task.model ?? descriptor.defaultModel
          const provider = createProvider(providerId as keyof typeof PROVIDERS, {
            apiKey,
            model: subModel,
            cwd: ctx.projectPath,
            signal: taskAc.signal
          })
          const rolePrompt = task.role ? getRolePrompt(task.role) : null
          // Идея 8 (handoff): просим суб дать СТРУКТУРИРОВАННЫЙ итог, чтобы при
          // 20+ параллельных субах главный агент получал сжатые выводы, а не
          // простыни. researcher/verifier также сохраняют находки через memory_save.
          const baseContent = rolePrompt
            ?? 'Ты — sub-agent с доступом к инструментам (чтение файлов, поиск по проекту). Выполни узкую задачу, при необходимости используй tools, ответь по существу.'
          const systemContent = `${baseContent}\n\nВ финале дай краткий структурированный итог: СДЕЛАЛ / НАШЁЛ / РЕКОМЕНДУЮ (по одной-две строки). Ключевые находки сохраняй через memory_save (если доступен).`
          const messages = [
            { role: 'system' as const, content: systemContent },
            { role: 'user' as const, content: task.prompt }
          ]
          // Whitelist tools по роли задачи (нет роли → read-only default).
          const allowedTools = getRoleToolset(task.role)
          const subCtx: ToolContext = {
            ...ctx,
            signal: taskAc.signal,
            subProviderId: providerId as ProviderId,
            subModel
          }
          const res = await runSubAgentLoop({
            provider, messages, allowedToolNames: allowedTools, ctx: subCtx,
            signal: taskAc.signal, role: task.role,
            onToolActivity: () => { toolCount++; emitSubagent('running') }
          })
          // Cost-cap батча: после каждой задачи смотрим прирост стоимости сессии.
          // Превысили — взводим флаг + отменяем ещё бегущие/ждущие задачи группы.
          if (ctx.subCostGuard) {
            const spentByBatch = ctx.subCostGuard.current() - batchStartCents
            if (spentByBatch >= batchCapCents && !batchCapped) {
              batchCapped = true
              subAgentQueue.cancel({ group: groupTag })
            }
          }
          if (res.exitReason === 'error') { finalizeSub('error', res.text.trim() || undefined); throw new Error(res.error ?? 'sub-agent error') }
          const trimmed = res.text.trim()
          if (!trimmed) { finalizeSub('error'); throw new Error('sub-agent вернул пустой ответ') }
          emitSubagent('done', trimmed.length > 1200 ? trimmed.slice(0, 1200) + '…' : trimmed)
          finalizeSub(res.exitReason === 'aborted' ? 'cancelled' : 'done', trimmed)
          return { id: task.id, result: trimmed }
        } catch (taskErr) {
          // Любой неожиданный throw (createProvider, abort/timeout) — карточка
          // не должна застрять на 'running'. Rethrow → Promise.allSettled reject.
          emitSubagent('error', taskErr instanceof Error ? taskErr.message : String(taskErr))
          finalizeSub('error')
          throw taskErr
        } finally {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          queueSlot?.release()
        }
      }))

      const output = results.map((r, i) => {
        const taskId = tasks[i].id
        if (r.status === 'fulfilled') {
          return `## ${taskId}\n${r.value.result}`
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
          return `## ${taskId}\n❌ Ошибка: ${msg}`
        }
      }).join('\n\n---\n\n')

      const successCount = results.filter(r => r.status === 'fulfilled').length
      try {
        ctx.recordJournal(ctx.projectPath, 'note',
          `🔀 delegate_parallel — ${successCount}/${tasks.length} успешно${batchCapped ? ' (стоп по cost-cap батча)' : ''}`,
          tasks.map(t => t.id).join(', '))
      } catch { /* journal не критично */ }

      const capNote = batchCapped
        ? `\n\n---\n\n⚠️ Батч остановлен: превышен cost-cap $${(batchCapCents / 100).toFixed(2)} на один delegate_parallel. Оставшиеся задачи не выполнены.`
        : ''
      return { id: call.id, name: call.name, result: output + capNote }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ============================================================================
// orchestrate — Smart Orchestrator + авто-декомпозиция (Фаза 3, Идея 5)
// ============================================================================

export interface DecomposedSubtask { id: string; prompt: string; role: string }

/**
 * Чистый парсер ответа планировщика → список подзадач. Устойчив: берёт первый
 * '[' … последний ']', валидирует роли, режет до maxSubtasks. Если распарсить не
 * удалось — фоллбэк: одна executor-подзадача = вся цель. Экспортируется для тестов.
 */
export function parseDecomposition(text: string, goal: string, maxSubtasks: number): DecomposedSubtask[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  let parsed: unknown = null
  if (start >= 0 && end > start) {
    try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { /* фоллбэк ниже */ }
  }
  const validRoles = new Set(['researcher', 'executor', 'verifier', 'critic', 'planner'])
  const tasks: DecomposedSubtask[] = []
  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length && tasks.length < maxSubtasks; i++) {
      const o = parsed[i]
      if (typeof o !== 'object' || o === null) continue
      const r = o as Record<string, unknown>
      const prompt = String(r.prompt ?? '').trim()
      if (!prompt) continue
      const role = validRoles.has(String(r.role)) ? String(r.role) : 'executor'
      const id = String(r.id ?? `task-${i + 1}`).slice(0, 40) || `task-${i + 1}`
      tasks.push({ id, prompt, role })
    }
  }
  if (tasks.length === 0) {
    tasks.push({ id: 'task-1', prompt: goal, role: 'executor' })
  }
  return tasks
}

/**
 * Декомпозиция цели через вызов модели-планировщика. Просим вернуть JSON-массив
 * подзадач с ролями. Парс — через чистый parseDecomposition (тестируемый).
 */
async function decomposeGoal(
  goal: string,
  maxSubtasks: number,
  providerId: string,
  apiKey: string | null,
  model: string,
  projectPath: string,
  signal: AbortSignal
): Promise<DecomposedSubtask[]> {
  const { createProvider, PROVIDERS } = await import('../ai/registry')
  const descriptor = PROVIDERS[providerId as keyof typeof PROVIDERS]
  const provider = createProvider(providerId as keyof typeof PROVIDERS, {
    apiKey, model, cwd: projectPath, signal
  })
  const sys = 'Ты — планировщик-декомпозитор. Разбей цель пользователя на независимые подзадачи, каждую с ролью из набора: researcher (анализ/поиск), executor (правка кода), verifier (проверка), critic (ревью), planner (под-план). Верни СТРОГО JSON-массив объектов {"id": "краткий-id", "prompt": "что сделать", "role": "роль"} и ничего больше. Подзадачи должны быть атомарными и параллелизуемыми.'
  const user = `Цель: ${goal}\n\nМаксимум подзадач: ${maxSubtasks}. Верни только JSON-массив.`
  let text = ''
  for await (const event of provider.send([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], [])) {
    if (signal.aborted) break
    if (event.type === 'text' && typeof event.text === 'string') text += event.text
    else if (event.type === 'error') throw new Error(event.message)
    else if (event.type === 'done') break
  }
  void descriptor
  return parseDecomposition(text, goal, maxSubtasks)
}

const orchestrateHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const goal = String(call.args.goal ?? '').trim()
      if (!goal) {
        return { id: call.id, name: call.name, result: '', error: 'orchestrate: goal обязателен' }
      }
      const maxSubtasks = Math.max(1, Math.min(12, typeof call.args.max_subtasks === 'number' ? Math.floor(call.args.max_subtasks) : 5))
      const batchCapCents = typeof call.args.cost_cap_usd === 'number' && call.args.cost_cap_usd > 0
        ? Math.round(call.args.cost_cap_usd * 100)
        : DEFAULT_BATCH_COST_CAP_CENTS

      const { createProvider, PROVIDERS } = await import('../ai/registry')
      const { estimateComplexity, recommendModel } = await import('../ai/smart-router')
      const { runSubAgentLoop } = await import('../ai/sub-agent-loop')
      const { getRoleToolset } = await import('../ai/role-tools')
      const { getRolePrompt } = await import('../ai/agent-roles')
      const { subAgentQueue } = await import('../ai/sub-queue')

      const baseProviderId = ctx.currentProviderId ?? 'grok'
      const descriptor = PROVIDERS[baseProviderId as keyof typeof PROVIDERS]
      if (!descriptor) {
        return { id: call.id, name: call.name, result: '', error: `orchestrate: неизвестный provider ${baseProviderId}` }
      }
      const apiKey = descriptor.secretKey ? ctx.getSecretForDelegate?.(descriptor.secretKey) ?? null : null
      if (descriptor.secretKey && !apiKey) {
        return { id: call.id, name: call.name, result: '', error: `orchestrate: нет API key для ${baseProviderId}` }
      }

      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-activity', callId: call.id, name: 'orchestrate', label: 'orchestrate', detail: `декомпозиция цели · ${baseProviderId}`, status: 'ok' }
      })

      // 1) Декомпозиция через модель-планировщик (дешёвая модель достаточна).
      const plannerModel = recommendModel(baseProviderId, 'moderate') ?? descriptor.defaultModel
      const subtasks = await decomposeGoal(goal, maxSubtasks, baseProviderId, apiKey, plannerModel, ctx.projectPath, ctx.signal)

      // 2) Создаём todo-лист из подзадач (TodoGate, Идея 2 — связь).
      if (ctx.sessionTodos) {
        try {
          ctx.sessionTodos.createBatch({
            projectPath: ctx.projectPath, sessionId: ctx.parentChatId ?? null,
            goal, titles: subtasks.map(t => `[${t.role}] ${t.prompt.slice(0, 120)}`)
          })
          ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'todo-updated' } })
        } catch { /* todo не критично для прогона */ }
      }

      // Группа батча = callId оркестратора (массовая отмена через панель).
      const groupTag = call.id
      const batchStartCents = ctx.subCostGuard?.current() ?? 0
      let batchCapped = false

      // 3) Параллельный запуск подзадач с умным выбором модели на каждую.
      const results = await Promise.allSettled(subtasks.map(async (task) => {
        // Smart-router: оцениваем сложность подзадачи по её промпту → модель.
        // Простую → дешёвая grok-4-fast, сложную → grok-4 (recommendModel).
        const complexity = estimateComplexity([{ role: 'user', content: task.prompt }], [])
        const subModel = recommendModel(baseProviderId, complexity) ?? descriptor.defaultModel

        const subCallId = `${call.id}:${task.id}`
        let toolCount = 0
        const emitSubagent = (status: 'running' | 'done' | 'error', result?: string) => {
          ctx.sender.send('ai:event', {
            id: ctx.sendId,
            event: { type: 'subagent-run', callId: subCallId, label: `${task.role} (${complexity})`, provider: baseProviderId, role: task.role, toolCount, task: task.prompt, status, result }
          })
        }
        emitSubagent('running')

        let subSessionId: number | null = null
        if (ctx.subSessions) {
          try {
            subSessionId = ctx.subSessions.create({
              projectPath: ctx.projectPath, parentChatId: ctx.parentChatId ?? null,
              role: task.role, task: task.prompt, group: groupTag, callId: subCallId,
              providerId: baseProviderId, model: subModel
            })
            ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'user', task.prompt)
          } catch { /* persist не критично */ }
        }
        const finalizeSub = (status: string, assistant?: string) => {
          if (subSessionId == null || !ctx.subSessions) return
          try {
            if (assistant) ctx.subSessions.appendMessage(subSessionId, ctx.projectPath, 'assistant', assistant)
            ctx.subSessions.update(subSessionId, { status, toolCount, endedAt: Date.now() })
          } catch { /* persist не критично */ }
        }

        const taskAc = new AbortController()
        const timeoutId = setTimeout(() => taskAc.abort(), SUB_TASK_TIMEOUT_MS)
        const parentAbortHandler = () => taskAc.abort()
        ctx.signal.addEventListener('abort', parentAbortHandler, { once: true })

        let queueSlot: { release: () => void; ticketId: number } | null = null
        try {
          queueSlot = await subAgentQueue.enter({ group: groupTag, role: task.role, abort: () => taskAc.abort() }, taskAc.signal)
        } catch {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          emitSubagent('error', 'отменён в очереди')
          finalizeSub('cancelled')
          throw new Error('отменён в очереди')
        }
        if (batchCapped) {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          queueSlot.release()
          emitSubagent('error', 'остановлен по cost-cap')
          finalizeSub('cancelled')
          throw new Error('остановлен по cost-cap')
        }

        try {
          const provider = createProvider(baseProviderId as keyof typeof PROVIDERS, {
            apiKey, model: subModel, cwd: ctx.projectPath, signal: taskAc.signal
          })
          // Идея 8: просим суб выдать СТРУКТУРИРОВАННЫЙ итог (handoff-формат), чтобы
          // главный агент получал сжатые выводы, а не простыни при 20+ субах.
          const rolePrompt = getRolePrompt(task.role) ?? 'Ты — sub-agent с доступом к инструментам.'
          const systemContent = `${rolePrompt}\n\nВ финале дай СТРУКТУРИРОВАННЫЙ итог тремя короткими блоками:\nСДЕЛАЛ: ...\nНАШЁЛ: ...\nРЕКОМЕНДУЮ: ...\nКлючевые находки сохраняй через memory_save (если доступен).`
          const allowedTools = getRoleToolset(task.role)
          const subCtx: ToolContext = {
            ...ctx, signal: taskAc.signal,
            subProviderId: baseProviderId as ProviderId, subModel
          }
          const res = await runSubAgentLoop({
            provider, messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: task.prompt }
            ], allowedToolNames: allowedTools, ctx: subCtx, signal: taskAc.signal, role: task.role,
            onToolActivity: () => { toolCount++; emitSubagent('running') }
          })
          if (ctx.subCostGuard) {
            const spent = ctx.subCostGuard.current() - batchStartCents
            if (spent >= batchCapCents && !batchCapped) {
              batchCapped = true
              subAgentQueue.cancel({ group: groupTag })
            }
          }
          if (res.exitReason === 'error') { finalizeSub('error', res.text.trim() || undefined); throw new Error(res.error ?? 'sub-agent error') }
          const trimmed = res.text.trim()
          if (!trimmed) { finalizeSub('error'); throw new Error('sub-agent вернул пустой ответ') }
          emitSubagent('done', trimmed.length > 1200 ? trimmed.slice(0, 1200) + '…' : trimmed)
          finalizeSub(res.exitReason === 'aborted' ? 'cancelled' : 'done', trimmed)
          return { id: task.id, role: task.role, model: subModel, result: trimmed }
        } catch (taskErr) {
          emitSubagent('error', taskErr instanceof Error ? taskErr.message : String(taskErr))
          finalizeSub('error')
          throw taskErr
        } finally {
          clearTimeout(timeoutId)
          ctx.signal.removeEventListener('abort', parentAbortHandler)
          queueSlot?.release()
        }
      }))

      // 4) Сжатый handoff главному агенту: по подзадаче — роль/модель + итог суба.
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const blocks = results.map((r, i) => {
        const t = subtasks[i]
        if (r.status === 'fulfilled') {
          return `## ${t.id} — ${r.value.role} (${r.value.model})\n${r.value.result}`
        }
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        return `## ${t.id} — ${t.role}\n❌ ${msg}`
      }).join('\n\n---\n\n')

      try {
        ctx.recordJournal(ctx.projectPath, 'note',
          `🧭 orchestrate — ${successCount}/${subtasks.length} подзадач${batchCapped ? ' (стоп по cost-cap)' : ''}`,
          `Цель: ${goal.slice(0, 200)}\nРоли: ${subtasks.map(t => t.role).join(', ')}`)
      } catch { /* journal не критично */ }

      const capNote = batchCapped ? `\n\n---\n\n⚠️ Оркестратор остановлен: превышен cost-cap $${(batchCapCents / 100).toFixed(2)}.` : ''
      const header = `🧭 Оркестратор разбил цель на ${subtasks.length} подзадач (${successCount} успешно). Сводка выводов:\n\n`
      return { id: call.id, name: call.name, result: header + blocks + capNote }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ============================================================================
// Artifact handlers — generate_html / generate_docx
// ============================================================================

const renderChartHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { renderChartSvg } = await import('../ai/charts')
      const { artifactsDir } = await import('../ai/artifacts')
      const { mkdir, writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const filename = String(call.args.filename ?? 'chart').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_\-.,()\s]/g, '_').slice(0, 100) + '.svg'
      const kind = String(call.args.kind ?? 'bar') as 'bar' | 'line' | 'pie'
      const labels = Array.isArray(call.args.labels) ? call.args.labels.map(String) : []
      const values = Array.isArray(call.args.values) ? call.args.values.map(Number) : []
      if (labels.length === 0 || labels.length !== values.length) {
        return { id: call.id, name: call.name, result: '', error: 'render_chart: labels и values должны быть одинаковой длины и непустые' }
      }
      const svg = renderChartSvg({
        kind, labels, values,
        title: call.args.title ? String(call.args.title) : undefined,
        xAxisLabel: call.args.x_axis_label ? String(call.args.x_axis_label) : undefined,
        yAxisLabel: call.args.y_axis_label ? String(call.args.y_axis_label) : undefined
      })
      const dir = artifactsDir(ctx.projectPath)
      await mkdir(dir, { recursive: true })
      const path = join(dir, filename)
      await writeFile(path, svg, 'utf8')
      try { ctx.recordJournal(ctx.projectPath, 'tool', `📊 Диаграмма ${kind}: ${filename}`, `${svg.length} bytes → ${path}`) } catch { /* */ }
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-activity', callId: call.id, name: 'render_chart', label: 'render_chart', detail: `${filename} · ${kind} · ${labels.length} точек`, status: 'ok' }
      })
      return { id: call.id, name: call.name, result: `Chart saved: ${path}\nKind: ${kind}, ${labels.length} data points.\nИспользуй в HTML: <img src="${filename}"> (относительно той же папки артефактов).` }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

const generateHtmlHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { generateHtml } = await import('../ai/artifacts')
      const filename = String(call.args.filename ?? 'untitled')
      const title = call.args.title ? String(call.args.title) : undefined
      const content = String(call.args.content_html ?? '')
      if (!content) return { id: call.id, name: call.name, result: '', error: 'generate_html: content_html обязателен' }
      const res = await generateHtml(ctx.projectPath, { filename, title, content_html: content })
      try { ctx.recordJournal(ctx.projectPath, 'tool', `📄 Артефакт HTML: ${res.filename}`, `${res.sizeBytes} bytes → ${res.path}`) } catch { /* */ }
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-activity', callId: call.id, name: 'generate_html', label: 'generate_html', detail: `${res.filename} · ${(res.sizeBytes / 1024).toFixed(1)}KB`, status: 'ok' }
      })
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'artifact-created', callId: call.id, kind: 'html', filename: res.filename, path: res.path, sizeBytes: res.sizeBytes }
      })
      return { id: call.id, name: call.name, result: `HTML artifact saved: ${res.path}\nSize: ${res.sizeBytes} bytes` }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

const generateDocxHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { generateDocx } = await import('../ai/artifacts')
      const filename = String(call.args.filename ?? 'untitled')
      const title = call.args.title ? String(call.args.title) : undefined
      const sections = Array.isArray(call.args.sections) ? call.args.sections as Array<{ heading?: string; level?: number; paragraphs?: string[]; bullets?: string[] }> : []
      if (sections.length === 0) return { id: call.id, name: call.name, result: '', error: 'generate_docx: sections обязательны (>= 1)' }
      const res = await generateDocx(ctx.projectPath, { filename, title, sections })
      try { ctx.recordJournal(ctx.projectPath, 'tool', `📄 Артефакт DOCX: ${res.filename}`, `${res.sizeBytes} bytes → ${res.path}`) } catch { /* */ }
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-activity', callId: call.id, name: 'generate_docx', label: 'generate_docx', detail: `${res.filename} · ${(res.sizeBytes / 1024).toFixed(1)}KB`, status: 'ok' }
      })
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'artifact-created', callId: call.id, kind: 'docx', filename: res.filename, path: res.path, sizeBytes: res.sizeBytes }
      })
      return { id: call.id, name: call.name, result: `DOCX artifact saved: ${res.path}\nSize: ${res.sizeBytes} bytes` }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

const createPlanHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const title = String(call.args.title ?? 'План без названия')
      const rawSteps = Array.isArray(call.args.steps) ? call.args.steps : []
      const steps = rawSteps
        .filter((s: unknown): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          title: String((s as Record<string, unknown>).title ?? ''),
          detail: (s as Record<string, unknown>).detail != null
            ? String((s as Record<string, unknown>).detail)
            : null
        }))
        .filter(s => s.title.length > 0)
      if (steps.length === 0) {
        return { id: call.id, name: call.name, result: '', error: 'create_plan: пустой список шагов' }
      }
      const plan = ctx.recordPlan(ctx.projectPath, title, steps)
      try { ctx.recordJournal(ctx.projectPath, 'note', `План: ${title}`, `${steps.length} шагов`) } catch { /* journal not critical */ }
      ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'plan-created', planId: plan.id, title, stepCount: steps.length } })
      return { id: call.id, name: call.name, result: `Plan #${plan.id} created with ${steps.length} steps. User will execute/confirm in the Plan view.` }
    } catch (err) {
      return { id: call.id, name: call.name, result: '', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ============================================================================
// TodoGate — todo_create / todo_update / todo_list (Фаза 3, Идея 2)
// ============================================================================

// Общий формат todo-листа для tool-результата (компактно, без шума).
function formatTodoList(todos: Array<{ id: number; title: string; status: string; assigneeCallId?: string | null }>): string {
  if (todos.length === 0) return 'Todo-лист пуст.'
  const icon: Record<string, string> = { pending: '☐', in_progress: '⏳', done: '✅', blocked: '⛔' }
  const lines = todos.map(t => `${icon[t.status] ?? '☐'} #${t.id} ${t.title}${t.assigneeCallId ? ` (assignee: ${t.assigneeCallId})` : ''}`)
  const done = todos.filter(t => t.status === 'done').length
  return `Прогресс: ${done}/${todos.length}\n${lines.join('\n')}`
}

// Эфемерное событие для live-обновления секции Todo в панели Agents.
function emitTodoUpdate(ctx: ToolContext): void {
  ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'todo-updated' } })
}

const todoCreateHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    if (!ctx.sessionTodos) {
      return { id: call.id, name: call.name, result: '', error: 'todo_create: TodoGate недоступен в этом контексте' }
    }
    const rawItems = Array.isArray(call.args.items) ? call.args.items : []
    const titles = rawItems.map(String).map(s => s.trim()).filter(Boolean)
    if (titles.length === 0) {
      return { id: call.id, name: call.name, result: '', error: 'todo_create: items обязателен (непустой массив строк)' }
    }
    const goal = call.args.goal ? String(call.args.goal) : null
    try {
      const created = ctx.sessionTodos.createBatch({
        projectPath: ctx.projectPath,
        sessionId: ctx.parentChatId ?? null,
        goal, titles
      })
      emitTodoUpdate(ctx)
      emitActivity(ctx, call, 'ok', 'todo_create', `${created.length} пунктов${goal ? ` · ${goal.slice(0, 40)}` : ''}`)
      return { id: call.id, name: call.name, result: `Создан todo-лист (${created.length} пунктов):\n${formatTodoList(created)}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

const todoUpdateHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    if (!ctx.sessionTodos) {
      return { id: call.id, name: call.name, result: '', error: 'todo_update: TodoGate недоступен в этом контексте' }
    }
    const sessionId = ctx.parentChatId ?? null
    // Идентификация пункта: по числовому id ИЛИ по точному title (субу удобнее
    // по названию — он не всегда знает id).
    let todoId: number | null = null
    if (typeof call.args.id === 'number') {
      todoId = Math.floor(call.args.id)
    } else if (call.args.title) {
      const found = ctx.sessionTodos.findByTitle(ctx.projectPath, sessionId, String(call.args.title))
      todoId = found?.id ?? null
    }
    if (todoId == null) {
      return { id: call.id, name: call.name, result: '', error: 'todo_update: укажи id (число) или title (точное название существующего пункта)' }
    }
    const status = call.args.status ? String(call.args.status) : undefined
    const allowed = ['pending', 'in_progress', 'done', 'blocked']
    if (status !== undefined && !allowed.includes(status)) {
      return { id: call.id, name: call.name, result: '', error: `todo_update: status должен быть одним из ${allowed.join('/')}` }
    }
    // assignee_call_id опционален — кто взял пункт (callId суба).
    const assigneeCallId = call.args.assignee_call_id !== undefined
      ? (call.args.assignee_call_id ? String(call.args.assignee_call_id) : null)
      : undefined
    try {
      ctx.sessionTodos.update(todoId, { status, assigneeCallId })
      emitTodoUpdate(ctx)
      const list = ctx.sessionTodos.list(ctx.projectPath, sessionId)
      emitActivity(ctx, call, 'ok', 'todo_update', `#${todoId}${status ? ` → ${status}` : ''}`)
      return { id: call.id, name: call.name, result: `Обновлён пункт #${todoId}.\n${formatTodoList(list)}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

const todoListHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    if (!ctx.sessionTodos) {
      return { id: call.id, name: call.name, result: '', error: 'todo_list: TodoGate недоступен в этом контексте' }
    }
    try {
      const list = ctx.sessionTodos.list(ctx.projectPath, ctx.parentChatId ?? null)
      emitActivity(ctx, call, 'ok', 'todo_list', `${list.length} пунктов`)
      return { id: call.id, name: call.name, result: formatTodoList(list) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// preflight — объявление плана перед сложной/деструктивной задачей
// ============================================================================

function toStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : []
}

const preflightHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const summary = String(call.args.summary ?? '').trim()
      if (!summary) {
        return { id: call.id, name: call.name, result: '', error: 'preflight: summary обязателен' }
      }
      const rawRisk = String(call.args.risk ?? '').trim()
      const risk: 'low' | 'medium' | 'high' = rawRisk === 'high' || rawRisk === 'medium' ? rawRisk : 'low'
      const affectedZones = toStringList(call.args.affectedZones)
      const verifyAfter = toStringList(call.args.verifyAfter)
      const outOfScope = toStringList(call.args.outOfScope)
      const riskReason = String(call.args.riskReason ?? '').trim()

      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'preflight', callId: call.id, summary, affectedZones, risk, riskReason, verifyAfter, outOfScope }
      })
      try { ctx.recordJournal(ctx.projectPath, 'note', `🛫 Preflight (${risk}): ${summary.slice(0, 120)}`, affectedZones.join(', ') || null) } catch { /* journal not critical */ }
      emitActivity(ctx, call, 'ok', 'preflight', `${risk} · ${summary.slice(0, 60)}`)
      return { id: call.id, name: call.name, result: 'preflight shown — продолжай выполнение задачи по объявленному плану.' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Memory: memory_save / memory_search
// ============================================================================

const memorySaveHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const type = String(call.args.type ?? '')
      const content = String(call.args.content ?? '').trim()
      const tags = Array.isArray(call.args.tags) ? call.args.tags.map(String) : []
      if (!content) {
        return { id: call.id, name: call.name, result: '', error: 'memory_save: content обязателен' }
      }
      const memory = ctx.saveMemory(ctx.projectPath, type, content, tags)
      emitActivity(ctx, call, 'ok', 'memory_save', `${type} · ${content.slice(0, 60)}`)
      return { id: call.id, name: call.name, result: `Сохранено: ${memory.id}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

const memorySearchHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const query = String(call.args.query ?? '').trim()
      const limit = typeof call.args.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(call.args.limit))) : 5
      const results = ctx.searchMemories(ctx.projectPath, query, limit)
      emitActivity(ctx, call, 'ok', 'memory_search', `"${query}" · ${results.length} результатов`)
      if (results.length === 0) {
        return { id: call.id, name: call.name, result: 'Ничего не найдено.' }
      }
      return { id: call.id, name: call.name, result: JSON.stringify(results, null, 2) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Core Memory: core_memory_append / core_memory_replace / core_memory_remove
// ============================================================================

const coreMemoryAppendHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { appendCoreMemory } = await import('../ai/core-memory')
      const block = String(call.args.block ?? '')
      const content = String(call.args.content ?? '').trim()
      if (block !== 'memory' && block !== 'user') {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_append: block должен быть "memory" или "user"' }
      }
      if (!content) {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_append: content обязателен' }
      }
      const res = appendCoreMemory(ctx.projectPath, block, content)
      const overflowNote = res.overflow ? ' (контент обрезан по лимиту)' : ''
      emitActivity(ctx, call, 'ok', 'core_memory_append', `${block} · +${content.length} символов${overflowNote}`)
      return { id: call.id, name: call.name, result: `Добавлено в ${block}${overflowNote}.\n\nТекущее содержимое:\n${res.content}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

const coreMemoryReplaceHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { replaceCoreMemory } = await import('../ai/core-memory')
      const block = String(call.args.block ?? '')
      const oldText = String(call.args.old_text ?? '')
      const newText = String(call.args.new_text ?? '')
      if (block !== 'memory' && block !== 'user') {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_replace: block должен быть "memory" или "user"' }
      }
      if (!oldText) {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_replace: old_text обязателен' }
      }
      const res = replaceCoreMemory(ctx.projectPath, block, oldText, newText)
      if (!res.success) {
        return { id: call.id, name: call.name, result: '', error: `core_memory_replace: фрагмент не найден в ${block}. Текущее содержимое:\n${res.content}` }
      }
      emitActivity(ctx, call, 'ok', 'core_memory_replace', `${block} · замена ${oldText.length} → ${newText.length} символов`)
      return { id: call.id, name: call.name, result: `Обновлено в ${block}.\n\nТекущее содержимое:\n${res.content}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

const coreMemoryRemoveHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    try {
      const { removeCoreMemory } = await import('../ai/core-memory')
      const block = String(call.args.block ?? '')
      const text = String(call.args.text ?? '')
      if (block !== 'memory' && block !== 'user') {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_remove: block должен быть "memory" или "user"' }
      }
      if (!text) {
        return { id: call.id, name: call.name, result: '', error: 'core_memory_remove: text обязателен' }
      }
      const res = removeCoreMemory(ctx.projectPath, block, text)
      if (!res.success) {
        return { id: call.id, name: call.name, result: '', error: `core_memory_remove: фрагмент не найден в ${block}. Текущее содержимое:\n${res.content}` }
      }
      emitActivity(ctx, call, 'ok', 'core_memory_remove', `${block} · удалено ${text.length} символов`)
      return { id: call.id, name: call.name, result: `Удалено из ${block}.\n\nТекущее содержимое:\n${res.content}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// check_diagnostics — tsc --noEmit, возвращает структурированный список ошибок
// ============================================================================

/**
 * Parse a single line of `tsc --noEmit --pretty false` output.
 * Format: path(line,col): error TSxxxx: message
 * Returns null if the line doesn't match.
 */
function parseTscLine(line: string): { path: string; line: number; col: number; code: string; message: string } | null {
  // Windows paths: C:\...\foo.ts(10,5): error TS2345: ...
  // Unix paths:    src/foo.ts(10,5): error TS2345: ...
  const m = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/.exec(line.trim())
  if (!m) return null
  return { path: m[1], line: parseInt(m[2], 10), col: parseInt(m[3], 10), code: m[4], message: m[5] }
}

const checkDiagnosticsHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    const fileFilter = call.args.file ? String(call.args.file) : null

    // Проверяем наличие tsconfig.json — если нет, возвращаем понятное сообщение
    const tsconfigPath = join(ctx.projectPath, 'tsconfig.json')
    if (!existsSync(tsconfigPath)) {
      emitActivity(ctx, call, 'ok', 'check_diagnostics', 'нет tsconfig.json')
      return { id: call.id, name: call.name, result: 'tsconfig.json не найден — проект не TypeScript или tsconfig в нестандартном месте.' }
    }

    // Ищем tsc из node_modules проекта, чтобы не требовать глобальной установки
    const localTsc = join(ctx.projectPath, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
    const tscBin = existsSync(localTsc) ? localTsc : 'npx'
    const tscArgs = tscBin === 'npx'
      ? ['tsc', '--noEmit', '--pretty', 'false']
      : ['--noEmit', '--pretty', 'false']

    let stdout = ''
    let stderr = ''
    try {
      const res = await execFileAsync(tscBin, tscArgs, {
        cwd: ctx.projectPath,
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      })
      stdout = res.stdout
      stderr = res.stderr
    } catch (err) {
      // tsc exits with non-zero when there are errors — that's expected.
      // We still want to parse the output.
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string }
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
      // If it's a real spawn error (ENOENT / EACCES), stderr will be empty and message will describe it
      if (!stdout && !stderr && e.message) {
        emitActivity(ctx, call, 'error', 'check_diagnostics', e.message)
        return { id: call.id, name: call.name, result: '', error: `Не удалось запустить tsc: ${e.message}` }
      }
    }

    const allOutput = (stdout + '\n' + stderr).split('\n')
    const errors = allOutput
      .map(parseTscLine)
      .filter((e): e is NonNullable<typeof e> => e !== null)

    const filtered = fileFilter
      ? errors.filter(e => e.path.replace(/\\/g, '/').includes(fileFilter.replace(/\\/g, '/')))
      : errors

    emitActivity(ctx, call, 'ok', 'check_diagnostics', `${filtered.length} ошибок${fileFilter ? ` в ${fileFilter}` : ''}`)

    if (filtered.length === 0) {
      return { id: call.id, name: call.name, result: '✅ Нет ошибок TypeScript.' }
    }

    const lines = filtered.map(e => `${e.path}:${e.line}:${e.col} — ${e.code}: ${e.message}`)
    const header = `Found ${filtered.length} error${filtered.length === 1 ? '' : 's'}:`
    return { id: call.id, name: call.name, result: `${header}\n\n${lines.join('\n')}` }
  }
}

// ============================================================================
// conversation_search — FTS5 search across past chat messages
// ============================================================================

const conversationSearchHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const query = String(call.args.query ?? '').trim()
      const limit = typeof call.args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(call.args.limit))) : 10
      const results = ctx.searchConversations(ctx.projectPath, query, limit)
      emitActivity(ctx, call, 'ok', 'conversation_search', `"${query}" · ${results.length} результатов`)
      if (results.length === 0) {
        return { id: call.id, name: call.name, result: 'Ничего не найдено в истории разговоров.' }
      }
      const lines: string[] = [`Found ${results.length} results:\n`]
      for (const r of results) {
        const date = new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 16)
        lines.push(`[Session #${r.session_id}, ${date}] ${r.role}:\n${r.content}\n`)
      }
      return { id: call.id, name: call.name, result: lines.join('\n') }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// convert_file — конвертация не-текстовых форматов в markdown/text
// ============================================================================

function csvToMarkdown(lines: string[]): string {
  if (lines.length === 0) return '(пустой CSV)'
  const rows = lines.map(l => l.split(',').map(c => c.trim()))
  const header = rows[0]
  const sep = header.map(() => '---')
  const body = rows.slice(1)
  return [
    '| ' + header.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...body.map(r => '| ' + r.join(' | ') + ' |')
  ].join('\n')
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000)
}

const convertFileHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const { readFileSync, existsSync } = await import('fs')
      const { extname } = await import('path')
      const { safeRealJoin } = await import('../ai/path-policy')
      const relPath = String(call.args.path ?? '')
      if (!relPath) {
        return { id: call.id, name: call.name, result: '', error: 'convert_file: path обязателен' }
      }
      const filePath = await safeRealJoin(ctx.projectPath, relPath)
      if (!existsSync(filePath)) {
        return { id: call.id, name: call.name, result: '', error: `convert_file: файл не найден: ${relPath}` }
      }
      const ext = extname(filePath).toLowerCase()

      if (ext === '.csv') {
        const text = readFileSync(filePath, 'utf-8')
        const lines = text.split('\n').filter(l => l.trim()).slice(0, 50)
        const result = csvToMarkdown(lines)
        emitActivity(ctx, call, 'ok', 'convert_file', `${relPath} · CSV → table`)
        return { id: call.id, name: call.name, result }
      }

      if (ext === '.html' || ext === '.htm') {
        const html = readFileSync(filePath, 'utf-8')
        emitActivity(ctx, call, 'ok', 'convert_file', `${relPath} · HTML → text`)
        return { id: call.id, name: call.name, result: stripHtml(html) }
      }

      if (ext === '.docx') {
        // mammoth уже в зависимостях для ArtifactPreview
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require('mammoth') as { extractRawText: (opts: { path: string }) => Promise<{ value: string }> }
        const result = await mammoth.extractRawText({ path: filePath })
        emitActivity(ctx, call, 'ok', 'convert_file', `${relPath} · DOCX → text`)
        return { id: call.id, name: call.name, result: result.value.slice(0, 20000) }
      }

      if (ext === '.json') {
        const text = readFileSync(filePath, 'utf-8')
        emitActivity(ctx, call, 'ok', 'convert_file', `${relPath} · JSON`)
        return { id: call.id, name: call.name, result: '```json\n' + text.slice(0, 10000) + '\n```' }
      }

      if (ext === '.xml') {
        const text = readFileSync(filePath, 'utf-8')
        emitActivity(ctx, call, 'ok', 'convert_file', `${relPath} · XML`)
        return { id: call.id, name: call.name, result: text.slice(0, 10000) }
      }

      return {
        id: call.id, name: call.name,
        result: `Формат ${ext} не поддерживается. Поддерживаемые: .csv, .html, .htm, .docx, .json, .xml`
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// impact_analysis — Feature 6: что сломается при изменении файла/символа
// ============================================================================

const impactAnalysisHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const { getDependencyMap } = await import('../ai/project-map')
      const { readFile } = await import('fs/promises')
      const { safeRealJoin } = await import('../ai/path-policy')

      const file = String(call.args.file ?? '').replace(/\\/g, '/')
      if (!file) {
        return { id: call.id, name: call.name, result: '', error: 'impact_analysis: file обязателен' }
      }
      const symbol = call.args.symbol ? String(call.args.symbol) : null

      const depMap = await getDependencyMap(ctx.projectPath)
      const fileInfo = depMap.files[file]
      if (!fileInfo) {
        // Try to find a close match (with/without extension)
        const candidates = Object.keys(depMap.files).filter(k =>
          k === file || k.startsWith(file + '.') || k.startsWith(file + '/index.')
        )
        if (candidates.length === 0) {
          return { id: call.id, name: call.name, result: `Файл "${file}" не найден в dependency map. Убедись что путь корректный (относительно корня проекта).` }
        }
        // Re-run with the first candidate
        call = { ...call, args: { ...call.args, file: candidates[0] } }
        return impactAnalysisHandler.handle(call, ctx)
      }

      const direct = fileInfo.importedBy
      // Transitive level 2 (max depth 3 total)
      const level2: Map<string, string[]> = new Map()  // file → via which direct dep
      for (const d of direct) {
        const dInfo = depMap.files[d]
        if (!dInfo) continue
        for (const d2 of dInfo.importedBy) {
          if (d2 !== file && !direct.includes(d2)) {
            if (!level2.has(d2)) level2.set(d2, [])
            level2.get(d2)!.push(d)
          }
        }
      }
      const level3: Map<string, string[]> = new Map()  // file → via which l2 dep
      for (const [l2file] of level2) {
        const l2Info = depMap.files[l2file]
        if (!l2Info) continue
        for (const d3 of l2Info.importedBy) {
          if (d3 !== file && !direct.includes(d3) && !level2.has(d3)) {
            if (!level3.has(d3)) level3.set(d3, [])
            level3.get(d3)!.push(l2file)
          }
        }
      }

      const lines: string[] = [`📁 ${file}`]
      if (fileInfo.exports.length > 0) {
        lines.push(`\nЭкспорты: ${fileInfo.exports.join(', ')}`)
      }

      if (direct.length === 0 && level2.size === 0) {
        lines.push('\nНет зависимых файлов — файл ни кем не импортируется.')
      } else {
        lines.push(`\nПрямые зависимости (импортируют этот файл):`)
        if (direct.length === 0) {
          lines.push('  (нет)')
        } else {
          for (const d of direct) lines.push(`  → ${d}`)
        }

        if (level2.size > 0) {
          lines.push(`\nТранзитивные (2-й уровень):`)
          for (const [f, vias] of level2) {
            lines.push(`  → ${f} (через ${vias.join(', ')})`)
          }
        }

        if (level3.size > 0) {
          lines.push(`\nТранзитивные (3-й уровень):`)
          for (const [f, vias] of level3) {
            lines.push(`  → ${f} (через ${vias.join(', ')})`)
          }
        }
      }

      // Symbol search — grep for usage in dependent files
      if (symbol) {
        const symbolHits: string[] = []
        const allDeps = [...direct, ...Array.from(level2.keys()), ...Array.from(level3.keys())]
        for (const dep of allDeps) {
          try {
            const abs = await safeRealJoin(ctx.projectPath, dep)
            const content = await readFile(abs, 'utf8')
            const depLines = content.split('\n')
            for (let i = 0; i < depLines.length; i++) {
              if (depLines[i].includes(symbol)) {
                const snippet = depLines[i].trim().slice(0, 120)
                symbolHits.push(`  → ${dep}:${i + 1} — ${snippet}`)
                break  // one hit per file is enough for overview
              }
            }
          } catch { /* skip unreadable files */ }
        }
        if (symbolHits.length > 0) {
          lines.push(`\nИспользуют символ "${symbol}":`)
          lines.push(...symbolHits)
        } else {
          lines.push(`\nСимвол "${symbol}" не найден в зависимых файлах.`)
        }
      }

      emitActivity(ctx, call, 'ok', 'impact_analysis', `${file} · ${direct.length} прямых зависимостей`)
      return { id: call.id, name: call.name, result: lines.join('\n') }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Screen: screen_capture / screen_info
// ============================================================================

const screenCaptureHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      // desktopCapturer and screen are Electron main-process APIs — they are
      // not available in Node.js / vitest environments, so we guard carefully.
      const { desktopCapturer, screen: electronScreen } = await import('electron')
      const target = call.args.target === 'window' ? 'window' : 'screen'

      let dataUrl: string | null = null
      let width = 0
      let height = 0

      if (target === 'screen') {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        })
        if (sources.length === 0) {
          return { id: call.id, name: call.name, result: 'Не удалось захватить экран — источников не найдено' }
        }
        const img = sources[0].thumbnail
        dataUrl = img.toDataURL()
        const sz = img.getSize()
        width = sz.width
        height = sz.height
      } else {
        // window — захват окна Grok Desktop через screen source
        const primary = electronScreen.getPrimaryDisplay()
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: primary.size.width, height: primary.size.height }
        })
        // Ищем окно Grok Desktop по имени (title содержит 'Grok Desktop' или 'Electron')
        const win = sources.find(s => /grok desktop|electron/i.test(s.name)) ?? sources[0]
        if (!win) {
          return { id: call.id, name: call.name, result: 'Не найдено окно для захвата' }
        }
        const img = win.thumbnail
        dataUrl = img.toDataURL()
        const sz = img.getSize()
        width = sz.width
        height = sz.height
      }

      // Attach image to next AI message (same pattern as browser_screenshot)
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        const m = /^data:(image\/[\w+-]+);base64,(.+)$/.exec(dataUrl)
        if (m) {
          ctx.pendingAttachments.push({
            name: `screen-${Date.now()}.png`,
            mimeType: m[1],
            data: m[2],
            size: Math.floor(m[2].length * 0.75)
          })
        }
      }

      emitActivity(ctx, call, 'ok', 'screen_capture', `${target} ${width}x${height}`)
      return {
        id: call.id,
        name: call.name,
        result: { target, width, height, attached: true, timestamp: Date.now() }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', 'screen_capture', msg)
      return { id: call.id, name: call.name, result: '', error: `screen_capture недоступен: ${msg}` }
    }
  }
}

const screenInfoHandler: ToolHandler = {
  mode: 'parallel-read',
  async handle(call, ctx) {
    try {
      const { screen: electronScreen } = await import('electron')
      const primary = electronScreen.getPrimaryDisplay()
      const displays = electronScreen.getAllDisplays()
      const lines = displays.map((d, i) => {
        const tag = d.id === primary.id ? ' [primary]' : ''
        return `Monitor ${i + 1}: ${d.size.width}x${d.size.height} (scale ${d.scaleFactor}x) pos=(${d.bounds.x},${d.bounds.y})${tag}`
      })
      const result = lines.join('\n')
      emitActivity(ctx, call, 'ok', 'screen_info', `${displays.length} мониторов`)
      return { id: call.id, name: call.name, result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', 'screen_info', msg)
      return { id: call.id, name: call.name, result: '', error: `screen_info недоступен: ${msg}` }
    }
  }
}

// ============================================================================
// MCP tool handler — роутит вызов к mcpClient
// ============================================================================

const mcpToolHandler: ToolHandler = {
  mode: 'sequential',
  async handle(call, ctx) {
    if (!ctx.mcpClient) {
      return { id: call.id, name: call.name, result: '', error: 'MCP client not available' }
    }
    // Определяем serverId: ищем tool среди всех подключённых серверов по имени
    const allMcpTools = ctx.mcpClient.getAllTools()
    const matchedTool = allMcpTools.find(t => t.name === call.name)
    if (!matchedTool) {
      return { id: call.id, name: call.name, result: '', error: `MCP tool "${call.name}" not found in connected servers` }
    }
    // Mode policy: внешние MCP-тулзы — не локальные правки, а side-effects на чужих
    // серверах. Гейтим их так же, как connector_query: scope тулза классифицируем
    // по name + description (read → авто, write/command/network/unknown → команда),
    // затем mcpDecision(scope, mode) даёт block/confirm/auto-accept.
    const scope = classifyMcpToolScope(matchedTool.name, matchedTool.description)
    const decision = mcpDecision(scope, ctx.agentMode)
    // Короткая сводка аргументов для модалки подтверждения (без раскрытия больших значений)
    const argKeys = Object.keys(call.args ?? {})
    const argsSummary = argKeys.length ? argKeys.join(', ') : ''
    const summary = `MCP ${call.name}${argsSummary ? ` · ${argsSummary}` : ''}`
    if (decision === 'block') {
      const reason = mcpBlockReason(call.name, scope, ctx.agentMode)
      ctx.sender.send('ai:event', {
        id: ctx.sendId,
        event: { type: 'tool-blocked', callId: call.id, name: call.name, command: summary, reason }
      })
      return { id: call.id, name: call.name, result: '', error: reason }
    }
    if (decision === 'confirm') {
      // 'confirm' — переиспользуем pending-command поток (та же модалка подтверждения)
      ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'pending-command', callId: call.id, command: summary } })
      const accepted = await new Promise<boolean>(resolve => {
        ctx.pendingCommands.set(ctx.scopedKey(ctx.sendId, call.id), { sendId: ctx.sendId, resolve })
      })
      if (!accepted) {
        ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'command-result', callId: call.id, command: summary, status: 'rejected' } })
        return { id: call.id, name: call.name, result: summary, error: 'User rejected' }
      }
    }
    try {
      emitActivity(ctx, call, 'ok', `mcp:${call.name}`, matchedTool.serverId)
      const result = await ctx.mcpClient.callTool(matchedTool.serverId, call.name, call.args)
      return { id: call.id, name: call.name, result: typeof result === 'string' ? result : JSON.stringify(result) }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', `mcp:${call.name}`, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Office: read_spreadsheet / read_document / edit_spreadsheet — «beyond code»
// ============================================================================

// Чтение xlsx/docx — pure-info, идёт через generic readHandler (ctx.tools.execute).
// Здесь только edit_spreadsheet: WRITE-операция, гейтится mode-policy как write_file.
// Diff текстом не показываем (xlsx бинарный) — подтверждаем через ту же модалку
// команды (pending-command), показывая список правок ячеек.

const editSpreadsheetHandler: ToolHandler = {
  mode: 'confirm-write',
  async handle(call, ctx) {
    try {
      const path = String(call.args.path ?? '')
      if (!path) {
        return { id: call.id, name: call.name, result: '', error: 'edit_spreadsheet: path обязателен' }
      }
      const sheet = call.args.sheet ? String(call.args.sheet) : undefined
      const rawEdits = Array.isArray(call.args.edits) ? call.args.edits : []
      const edits = rawEdits
        .filter((e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({ cell: String((e as Record<string, unknown>).cell ?? ''), value: String((e as Record<string, unknown>).value ?? '') }))
        .filter(e => e.cell.length > 0)
      if (edits.length === 0) {
        return { id: call.id, name: call.name, result: '', error: 'edit_spreadsheet: edits обязателен и не должен быть пустым' }
      }

      // Mode policy — как write_file: ask/accept-edits/auto/bypass/plan
      const decision = decide('edit_spreadsheet', ctx.agentMode)
      if (decision === 'block') {
        const reason = blockReason('edit_spreadsheet', ctx.agentMode)
        return { id: call.id, name: call.name, result: '', error: reason }
      }
      const summary = `Правка таблицы ${path}${sheet ? ` · лист ${sheet}` : ''}: ${edits.map(e => `${e.cell}=${e.value}`).join(', ').slice(0, 300)}`
      let accepted: boolean
      if (decision === 'auto-accept') {
        ctx.sender.send('ai:event', {
          id: ctx.sendId,
          event: { type: 'tool-activity', callId: call.id, name: 'edit_spreadsheet', label: 'edit_spreadsheet (авто)', detail: summary, status: 'ok' }
        })
        accepted = true
      } else {
        ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'pending-command', callId: call.id, command: summary } })
        accepted = await new Promise<boolean>(resolve => {
          ctx.pendingCommands.set(ctx.scopedKey(ctx.sendId, call.id), { sendId: ctx.sendId, resolve })
        })
      }
      if (!accepted) {
        ctx.sender.send('ai:event', { id: ctx.sendId, event: { type: 'command-result', callId: call.id, command: summary, status: 'rejected' } })
        return { id: call.id, name: call.name, result: summary, error: 'User rejected' }
      }

      const { editSpreadsheet } = await import('../ai/office')
      const res = await editSpreadsheet(ctx.projectPath, path, sheet, edits)
      try { ctx.recordJournal(ctx.projectPath, 'tool', `📊 Правка xlsx: ${path}`, `${res.applied} ячеек на листе "${res.sheet}"`) } catch { /* journal not critical */ }
      emitActivity(ctx, call, 'ok', 'edit_spreadsheet', `${res.applied} ячеек · лист ${res.sheet}`)
      return { id: call.id, name: call.name, result: `Применено ${res.applied} правок в "${path}" (лист "${res.sheet}").` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitActivity(ctx, call, 'error', call.name, msg)
      return { id: call.id, name: call.name, result: '', error: msg }
    }
  }
}

// ============================================================================
// Registry — single source of truth for tool dispatch
// ============================================================================

const HANDLER_REGISTRY: Record<string, ToolHandler> = {
  // Confirm-write — go through the diff modal
  'write_file': writeFileHandler,
  'apply_patch': applyPatchHandler,
  'propose_edits': proposeEditsHandler,
  // Sequential, side-effecting
  'run_command': runCommandHandler,
  'browser_navigate': browserHandler,
  'browser_read_page': browserHandler,
  'browser_screenshot': browserHandler,
  'list_connectors': listConnectorsHandler,
  'connector_query': connectorQueryHandler,
  'create_plan': createPlanHandler,
  // TodoGate (Фаза 3) — оркестрационный todo-лист сессии
  'todo_create': todoCreateHandler,
  'todo_update': todoUpdateHandler,
  'todo_list': todoListHandler,
  'preflight': preflightHandler,
  'read_journal': readJournalHandler,
  'generate_html': generateHtmlHandler,
  'generate_docx': generateDocxHandler,
  'render_chart': renderChartHandler,
  'delegate_task': delegateTaskHandler,
  'delegate_parallel': delegateParallelHandler,
  'orchestrate': orchestrateHandler,
  'memory_save': memorySaveHandler,
  'memory_search': memorySearchHandler,
  // Core Memory (Hermes-style) — sequential, file-backed, no user confirmation
  'core_memory_append': coreMemoryAppendHandler,
  'core_memory_replace': coreMemoryReplaceHandler,
  'core_memory_remove': coreMemoryRemoveHandler,
  // Diagnostics — parallel-read, no user confirmation needed
  'check_diagnostics': checkDiagnosticsHandler,
  // Code intelligence — parallel-read
  'impact_analysis': impactAnalysisHandler,
  // Conversation history search — parallel-read, FTS5
  'conversation_search': conversationSearchHandler,
  // File conversion — parallel-read, no user confirmation needed
  'convert_file': convertFileHandler,
  // Screen capture — parallel-read, Electron desktopCapturer
  'screen_capture': screenCaptureHandler,
  'screen_info': screenInfoHandler,
  // Office «beyond code» — чтение parallel-read (через readHandler), правка confirm-write
  'read_spreadsheet': readHandler,
  'read_document': readHandler,
  'edit_spreadsheet': editSpreadsheetHandler
}

/**
 * Look up the handler for a tool call. Falls back to the generic parallel-read
 * handler (which calls into ctx.tools.execute) for anything not explicitly
 * registered — that's the safe default for new pure-info tools.
 *
 * MCP tools: если имя не найдено в registry и передан ctx.mcpClient —
 * роутим к mcpToolHandler. Так как lookupHandler не имеет ctx, проверка
 * происходит в mcpToolHandler.handle через поиск в mcpClient.getAllTools().
 */
export function lookupHandler(name: string, ctx?: { mcpClient?: import('../mcp/client').McpClient }): ToolHandler {
  const registered = HANDLER_REGISTRY[name]
  if (registered) return registered
  // Если есть mcpClient и инструмент среди MCP tools — роутим к MCP handler
  if (ctx?.mcpClient) {
    const allMcpTools = ctx.mcpClient.getAllTools()
    if (allMcpTools.some(t => t.name === name)) {
      return mcpToolHandler
    }
  }
  return readHandler
}
