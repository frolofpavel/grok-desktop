/**
 * Remove imported junk chat sessions (system-layer bootstrap only).
 * Usage: node scripts/cleanup-junk-chats.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DESKTOP_DB = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'grok-desktop',
  'storage',
  'grok-desktop.db'
)
const IMPORT_KEY = 'cli_session_import_map'

const JUNK_PATTERNS = [
  /^<verstak_system_layer[\s>]/,
  /^<system-reminder>/,
  /^<user_info>[\s\S]*<\/user_info>\s*$/m
]

function isJunkUserMessage(content) {
  if (!content || typeof content !== 'string') return false
  const trimmed = content.trim()
  return JUNK_PATTERNS.some(re => re.test(trimmed))
}

function loadImportMap(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(IMPORT_KEY)
  if (!row?.value) return {}
  try {
    const raw = Buffer.from(row.value, 'base64').toString('utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    try {
      return JSON.parse(row.value)
    } catch {
      return {}
    }
  }
}

function saveImportMap(db, map) {
  const encoded = Buffer.from(JSON.stringify(map), 'utf8').toString('base64')
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(IMPORT_KEY, encoded)
}

function main() {
  if (!fs.existsSync(DESKTOP_DB)) {
    console.error('DB not found:', DESKTOP_DB)
    process.exit(1)
  }

  const db = new DatabaseSync(DESKTOP_DB)
  const sessions = db.prepare(`
    SELECT cs.id, cs.title, cs.kind,
      (SELECT content FROM chats c WHERE c.session_id = cs.id AND c.role = 'user' ORDER BY c.id ASC LIMIT 1) AS first_user
    FROM chat_sessions cs
    WHERE cs.kind = 'main'
    ORDER BY cs.id
  `).all()

  const toDelete = sessions.filter(s => isJunkUserMessage(s.first_user))
  if (toDelete.length === 0) {
    console.log('No junk sessions found.')
    return
  }

  const importMap = loadImportMap(db)
  const reverseMap = Object.fromEntries(Object.entries(importMap).map(([cli, desk]) => [String(desk), cli]))

  db.exec('BEGIN')
  try {
    for (const s of toDelete) {
      db.prepare('DELETE FROM chats WHERE session_id = ?').run(s.id)
      db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(s.id)
      const cliId = reverseMap[String(s.id)]
      if (cliId) delete importMap[cliId]
      console.log(`  deleted #${s.id} "${s.title}"`)
    }
    saveImportMap(db, importMap)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const remaining = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions WHERE kind = 'main'").get().c
  console.log(`Removed ${toDelete.length} junk session(s). ${remaining} main chat(s) left.`)
}

main()