/**
 * Import Grok CLI sessions (~/.grok/sessions) into Grok Desktop SQLite DB.
 * Usage: node scripts/migrate-cli-history.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const GROK_HOME = path.join(os.homedir(), '.grok')
const SESSIONS_ROOT = path.join(GROK_HOME, 'sessions')
const DESKTOP_DB = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'grok-desktop',
  'storage',
  'grok-desktop.db'
)
const IMPORT_KEY = 'cli_session_import_map'
const MAX_TOOL_RESULT = 6000

const PALETTE = ['#5b8dff', '#4ec9b0', '#c668ff', '#f0a500', '#f47174', '#7aa3ff', '#b04fc3', '#4ec986']

function pickColor(projectPath) {
  let hash = 0
  for (let i = 0; i < projectPath.length; i++) hash = (hash * 31 + projectPath.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function parseIsoMs(iso) {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : Date.now()
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(p => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n')
  }
  return ''
}

function cleanUserText(text) {
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

function truncate(s, max) {
  if (!s || s.length <= max) return s || ''
  return s.slice(0, max) + '\n\n…[обрезано — полный лог в ~/.grok/sessions]'
}

function formatToolCalls(toolCalls) {
  if (!toolCalls?.length) return ''
  const lines = toolCalls.map(tc => {
    let args = tc.arguments ?? ''
    try {
      const parsed = JSON.parse(args)
      args = JSON.stringify(parsed)
    } catch { /* keep raw */ }
    if (args.length > 240) args = args.slice(0, 240) + '…'
    return `- **${tc.name}** \`${args}\``
  })
  return '\n\n**Инструменты:**\n' + lines.join('\n')
}

function formatToolResult(tr) {
  const raw = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? '')
  return `\n\n**Результат инструмента:**\n\`\`\`\n${truncate(raw, MAX_TOOL_RESULT)}\n\`\`\``
}

export function convertChatHistory(filePath) {
  if (!fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  const out = []
  let pendingAssistant = null
  let pendingTools = []

  const flushAssistant = () => {
    if (!pendingAssistant && pendingTools.length === 0) return
    let content = ''
    if (pendingAssistant) {
      content += (pendingAssistant.content || '').trim()
      content += formatToolCalls(pendingAssistant.tool_calls)
    }
    for (const tr of pendingTools) content += formatToolResult(tr)
    content = content.trim()
    if (content) out.push({ role: 'assistant', content })
    pendingAssistant = null
    pendingTools = []
  }

  for (const line of lines) {
    let msg
    try { msg = JSON.parse(line) } catch { continue }
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
    if (msg.type === 'tool_result') {
      pendingTools.push(msg)
    }
  }
  flushAssistant()
  return out
}

function mapProvider(modelId) {
  if (!modelId) return { providerId: 'grok-cli', model: 'grok-build' }
  if (modelId.startsWith('grok-')) return { providerId: 'grok-cli', model: modelId }
  return { providerId: 'grok-cli', model: modelId }
}

function decodeCwd(encodedDir) {
  try { return decodeURIComponent(encodedDir) } catch { return encodedDir }
}

function loadImportMap(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(IMPORT_KEY)
  if (!row?.value) return {}
  try {
    const raw = Buffer.from(row.value, 'base64').toString('utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveImportMap(db, map) {
  const encoded = Buffer.from(JSON.stringify(map), 'utf8').toString('base64')
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(IMPORT_KEY, encoded)
}

function upsertProject(db, projectPath, lastOpenedAt) {
  const name = path.basename(projectPath) || projectPath
  const color = pickColor(projectPath)
  db.prepare(`
    INSERT INTO projects (path, name, color, last_opened_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at
  `).run(projectPath, name, color, lastOpenedAt)
}

function discoverSessions() {
  const sessions = []
  if (!fs.existsSync(SESSIONS_ROOT)) return sessions
  for (const encodedCwd of fs.readdirSync(SESSIONS_ROOT)) {
    const cwdRoot = path.join(SESSIONS_ROOT, encodedCwd)
    if (!fs.statSync(cwdRoot).isDirectory()) continue
    const projectPath = decodeCwd(encodedCwd)
    for (const sessionId of fs.readdirSync(cwdRoot)) {
      const sessionDir = path.join(cwdRoot, sessionId)
      if (!fs.statSync(sessionDir).isDirectory()) continue
      const summaryPath = path.join(sessionDir, 'summary.json')
      const historyPath = path.join(sessionDir, 'chat_history.jsonl')
      if (!fs.existsSync(summaryPath) || !fs.existsSync(historyPath)) continue
      let summary
      try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) } catch { continue }
      sessions.push({
        cliId: summary.info?.id ?? sessionId,
        projectPath: summary.info?.cwd ?? projectPath,
        summary,
        historyPath,
        kind: summary.session_kind ?? 'main',
        title: summary.generated_title || summary.session_summary || 'Grok CLI чат',
        createdAt: parseIsoMs(summary.created_at),
        updatedAt: parseIsoMs(summary.updated_at)
      })
    }
  }
  return sessions
}

function importSession(db, session, importMap, parentDesktopId = null) {
  if (importMap[session.cliId]) {
    return { skipped: true, desktopId: importMap[session.cliId] }
  }

  const messages = convertChatHistory(session.historyPath)
  if (messages.length === 0) {
    return { skipped: true, reason: 'no messages' }
  }

  const isSubagent = typeof session.kind === 'string' && session.kind.startsWith('subagent')
  const chatKind = isSubagent ? 'review' : 'main'
  const title = isSubagent ? `[agent] ${session.title}` : session.title
  const { providerId, model } = mapProvider(session.summary.current_model_id)

  const info = db.prepare(`
    INSERT INTO chat_sessions
      (project_path, title, provider_id, model, created_at, last_message_at, kind, parent_chat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.projectPath,
    title.slice(0, 200),
    providerId,
    model,
    session.createdAt,
    session.updatedAt,
    chatKind,
    parentDesktopId
  )

  const sessionId = Number(info.lastInsertRowid)
  const insertChat = db.prepare(
    'INSERT INTO chats (session_id, project_path, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  )

  let ts = session.createdAt
  for (const m of messages) {
    insertChat.run(sessionId, session.projectPath, m.role, m.content, ts)
    ts += 1000
  }

  upsertProject(db, session.projectPath, session.updatedAt)
  importMap[session.cliId] = sessionId
  return { skipped: false, desktopId: sessionId, messages: messages.length, kind: chatKind }
}

function main() {
  if (!fs.existsSync(DESKTOP_DB)) {
    console.error('Grok Desktop DB not found:', DESKTOP_DB)
    process.exit(1)
  }

  const db = new DatabaseSync(DESKTOP_DB)
  const importMap = loadImportMap(db)
  const all = discoverSessions()

  const mains = all.filter(s => !s.kind.startsWith('subagent'))
  const subs = all.filter(s => s.kind.startsWith('subagent'))

  // Group subagents by project; attach to newest main in same cwd
  const mainsByProject = new Map()
  for (const s of mains.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!mainsByProject.has(s.projectPath)) mainsByProject.set(s.projectPath, s.cliId)
  }

  let imported = 0
  let skipped = 0
  const report = []

  db.exec('BEGIN')
  try {
    for (const session of mains.sort((a, b) => a.createdAt - b.createdAt)) {
      const res = importSession(db, session, importMap)
      if (res.skipped && res.desktopId) skipped++
      else if (!res.skipped) {
        imported++
        report.push(`  main  ${session.cliId.slice(0, 8)}… → #${res.desktopId} (${res.messages} msgs) ${session.title.slice(0, 50)}`)
      }
    }

    for (const session of subs.sort((a, b) => a.createdAt - b.createdAt)) {
      const parentCliId = mainsByProject.get(session.projectPath)
      const parentDesktopId = parentCliId ? importMap[parentCliId] ?? null : null
      const res = importSession(db, session, importMap, parentDesktopId)
      if (res.skipped && res.desktopId) skipped++
      else if (!res.skipped) {
        imported++
        report.push(`  agent ${session.cliId.slice(0, 8)}… → #${res.desktopId} (${res.messages} msgs) ${session.title.slice(0, 50)}`)
      }
    }

    saveImportMap(db, importMap)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const totalSessions = db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get().c
  const totalMsgs = db.prepare('SELECT COUNT(*) AS c FROM chats').get().c

  console.log(`Imported ${imported} sessions (${skipped} already present).`)
  console.log(`Desktop DB now: ${totalSessions} sessions, ${totalMsgs} messages.`)
  for (const line of report) console.log(line)
}

main()