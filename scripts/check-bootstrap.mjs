import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { readdirSync } from 'node:fs'

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'grok-desktop', 'storage', 'grok-desktop.db')
const db = new DatabaseSync(dbPath)

const sessions = db.prepare(`SELECT COUNT(*) AS c FROM chat_sessions`).get().c
const chats = db.prepare(`SELECT COUNT(*) AS c FROM chats`).get().c
const importMap = db.prepare(`SELECT key FROM settings WHERE key = 'cli_session_import_map'`).get()
const mcp = db.prepare(`SELECT key, length(value) AS len FROM settings WHERE key = 'mcp_servers'`).get()
const provider = db.prepare(`SELECT key FROM settings WHERE key LIKE '%provider%'`).get()

const grokSkills = readdirSync(path.join(os.homedir(), '.grok', 'skills'), { withFileTypes: true })
  .filter(d => d.isDirectory()).length
const bundled = readdirSync(path.join(os.homedir(), '.grok', 'bundled', 'skills'), { withFileTypes: true })
  .filter(d => d.isDirectory()).length

console.log(JSON.stringify({
  sessions,
  chats,
  cliImportMapPresent: !!importMap,
  mcpServersConfigured: !!mcp,
  mcpPayloadBytes: mcp?.len ?? 0,
  providerKeyPresent: !!provider,
  grokSkills,
  bundledSkills: bundled
}, null, 2))