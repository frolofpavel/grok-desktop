import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'

const db = new DatabaseSync(path.join(os.homedir(), 'AppData', 'Roaming', 'grok-desktop', 'storage', 'grok-desktop.db'))
const mains = db.prepare(`SELECT id, title, project_path FROM chat_sessions WHERE kind='main' ORDER BY id`).all()
console.log('Main chats:', mains.length)
for (const m of mains) {
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM chats WHERE session_id = ?').get(m.id).c
  const first = db.prepare(`SELECT substr(content,1,80) AS p FROM chats WHERE session_id = ? AND role='user' ORDER BY id LIMIT 1`).get(m.id)
  console.log(` #${m.id} (${cnt} msgs) ${m.title}`)
  console.log(`    first user: ${first?.p ?? '(none)'}`)
}