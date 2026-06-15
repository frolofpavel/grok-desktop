/**
 * Incremental import of Grok CLI chat sessions into Grok Desktop DB.
 * Runs on app startup — only imports sessions not yet in cli_session_import_map.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Database } from 'better-sqlite3'
import type { Settings } from '../storage/settings'

const GROK_HOME = path.join(os.homedir(), '.grok')
const SESSIONS_ROOT = path.join(GROK_HOME, 'sessions')
const IMPORT_KEY = 'cli_session_import_map'
const MAX_TOOL_RESULT = 6000

const PALETTE = ['#5b8dff', '#4ec9b0', '#c668ff', '#f0a500', '#f47174', '#7aa3ff', '#b04fc3', '#4ec986']

interface CliSession {
  cliId: string
  projectPath: string
  summary: Record<string, unknown>
  historyPath: string
  kind: string
  title: string
  createdAt: number
  updatedAt: number
}

function pickColor(projectPath: string): string {
  let hash = 0
  for (let i = 0; i < projectPath.length; i++) hash = (hash * 31 + projectPath.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function parseIsoMs(iso: unknown): number {
  const n = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : Date.now()
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text: string } =>
        !!p && typeof p === 'object' && (p as { type?: string }).type === 'text' && typeof (p as { text?: string }).text === 'string')
      .map(p => p.text)
      .join('\n')
  }
  return ''
}

function cleanUserText(text: string): string | null {
  const q = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)
  if (q) return q[1].trim()
  if (!/<user_query>/.test(text)) {
    if (/<verstak_system_layer[\s>]/.test(text)) return null
    if (/<system-reminder>/.test(text)) return null
    if (/<user_info>[\s\S]*<\/user_info>/.test(text)) return null
    if (text.includes('<rules>')) return null
  }
  const trimmed = text.trim()
  return trimmed || null
}

function truncate(s: string, max: number): string {
  if (!s || s.length <= max) return s || ''
  return s.slice(0, max) + '\n\n…[обрезано — полный лог в ~/.grok/sessions]'
}

function convertChatHistory(filePath: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let pendingAssistant: { content?: unknown; tool_calls?: Array<{ name: string; arguments?: string }> } | null = null
  const pendingTools: Array<{ content?: unknown }> = []

  const flushAssistant = () => {
    if (!pendingAssistant && pendingTools.length === 0) return
    let content = ''
    if (pendingAssistant) {
      content += extractText(pendingAssistant.content).trim()
      if (pendingAssistant.tool_calls?.length) {
        content += '\n\n**Инструменты:**\n' + pendingAssistant.tool_calls.map(tc => {
          let args = tc.arguments ?? ''
          if (args.length > 240) args = args.slice(0, 240) + '…'
          return `- **${tc.name}** \`${args}\``
        }).join('\n')
      }
    }
    for (const tr of pendingTools) {
      const raw = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? '')
      content += `\n\n**Результат инструмента:**\n\`\`\`\n${truncate(raw, MAX_TOOL_RESULT)}\n\`\`\``
    }
    content = content.trim()
    if (content) out.push({ role: 'assistant', content })
    pendingAssistant = null
    pendingTools.length = 0
  }

  for (const line of lines) {
    let msg: { type?: string; content?: unknown; tool_calls?: Array<{ name: string; arguments?: string }> }
    try { msg = JSON.parse(line) as typeof msg } catch { continue }
    if (msg.type === 'system' || msg.type === 'reasoning') continue
    if (msg.type === 'user') {
      flushAssistant()
      const text = cleanUserText(extractText(msg.content))
      if (text) out.push({ role: 'user', content: text })
      continue
    }
    if (msg.type === 'assistant') {
      flushAssistant()
      pendingAssistant = msg
      continue
    }
    if (msg.type === 'tool_result') pendingTools.push(msg)
  }
  flushAssistant()
  return out
}

function loadImportMap(settings: Settings): Record<string, number> {
  const raw = settings.getSecret(IMPORT_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveImportMap(settings: Settings, map: Record<string, number>): void {
  settings.setSecret(IMPORT_KEY, JSON.stringify(map))
}

function discoverSessions(): CliSession[] {
  const sessions: CliSession[] = []
  if (!fs.existsSync(SESSIONS_ROOT)) return sessions
  for (const encodedCwd of fs.readdirSync(SESSIONS_ROOT)) {
    const cwdRoot = path.join(SESSIONS_ROOT, encodedCwd)
    try { if (!fs.statSync(cwdRoot).isDirectory()) continue } catch { continue }
    let projectPath = encodedCwd
    try { projectPath = decodeURIComponent(encodedCwd) } catch { /* keep */ }
    for (const sessionId of fs.readdirSync(cwdRoot)) {
      const sessionDir = path.join(cwdRoot, sessionId)
      try { if (!fs.statSync(sessionDir).isDirectory()) continue } catch { continue }
      const summaryPath = path.join(sessionDir, 'summary.json')
      const historyPath = path.join(sessionDir, 'chat_history.jsonl')
      if (!fs.existsSync(summaryPath) || !fs.existsSync(historyPath)) continue
      let summary: Record<string, unknown>
      try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown> } catch { continue }
      const info = summary.info as { id?: string; cwd?: string } | undefined
      sessions.push({
        cliId: info?.id ?? sessionId,
        projectPath: info?.cwd ?? projectPath,
        summary,
        historyPath,
        kind: typeof summary.session_kind === 'string' ? summary.session_kind : 'main',
        title: (typeof summary.generated_title === 'string' && summary.generated_title)
          || (typeof summary.session_summary === 'string' && summary.session_summary)
          || 'Grok CLI чат',
        createdAt: parseIsoMs(summary.created_at),
        updatedAt: parseIsoMs(summary.updated_at)
      })
    }
  }
  return sessions
}

export function importCliChatHistory(db: Database, settings: Settings): { imported: number } {
  const importMap = loadImportMap(settings)
  const all = discoverSessions()
  const mains = all.filter(s => !s.kind.startsWith('subagent'))
  const subs = all.filter(s => s.kind.startsWith('subagent'))

  const mainsByProject = new Map<string, string>()
  for (const s of mains.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!mainsByProject.has(s.projectPath)) mainsByProject.set(s.projectPath, s.cliId)
  }

  const insertSession = db.prepare(`
    INSERT INTO chat_sessions
      (project_path, title, provider_id, model, created_at, last_message_at, kind, parent_chat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertChat = db.prepare(
    'INSERT INTO chats (session_id, project_path, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  const upsertProject = db.prepare(`
    INSERT INTO projects (path, name, color, last_opened_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at
  `)

  let imported = 0

  const importOne = (session: CliSession, parentDesktopId: number | null): void => {
    if (importMap[session.cliId]) return
    const messages = convertChatHistory(session.historyPath)
    if (messages.length === 0) return

    const isSubagent = session.kind.startsWith('subagent')
    const chatKind = isSubagent ? 'review' : 'main'
    const title = isSubagent ? `[agent] ${session.title}` : session.title
    const modelId = typeof session.summary.current_model_id === 'string' ? session.summary.current_model_id : 'grok-build'

    const info = insertSession.run(
      session.projectPath,
      title.slice(0, 200),
      'grok-cli',
      modelId,
      session.createdAt,
      session.updatedAt,
      chatKind,
      parentDesktopId
    )
    const sessionId = Number(info.lastInsertRowid)
    let ts = session.createdAt
    for (const m of messages) {
      insertChat.run(sessionId, session.projectPath, m.role, m.content, ts)
      ts += 1000
    }
    const name = path.basename(session.projectPath) || session.projectPath
    upsertProject.run(session.projectPath, name, pickColor(session.projectPath), session.updatedAt)
    importMap[session.cliId] = sessionId
    imported++
  }

  const tx = db.transaction(() => {
    for (const session of mains.sort((a, b) => a.createdAt - b.createdAt)) importOne(session, null)
    for (const session of subs.sort((a, b) => a.createdAt - b.createdAt)) {
      const parentCliId = mainsByProject.get(session.projectPath)
      const parentDesktopId = parentCliId ? (importMap[parentCliId] ?? null) : null
      importOne(session, parentDesktopId)
    }
    if (imported > 0) saveImportMap(settings, importMap)
  })
  tx()

  if (imported > 0) {
    console.log(`[cli-import] imported ${imported} Grok CLI session(s)`)
  }
  return { imported }
}
