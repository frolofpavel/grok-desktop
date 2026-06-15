/**
 * One-time bootstrap from Grok Build CLI (~/.grok/) into Grok Desktop settings.
 * Imports MCP servers from config.toml when the desktop DB has none yet.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3'
import type { Settings } from '../storage/settings'
import { importCliChatHistory } from './grok-chat-import'
import { loadMcpServers, saveMcpServers, type McpServerEntry } from '../mcp/registry'

interface ParsedMcpServer {
  name: string
  command: string
  args: string[]
  enabled: boolean
}

export function bootstrapFromGrokCli(db: Database, settings: Settings): void {
  importMcpServersFromConfig(settings)
  ensureDefaultProvider(settings)
  // CLI chat import is opt-in only — auto-import caused duplicate/broken sessions.
  // Run manually: npm run migrate:cli-chats
  if (process.env.GROK_DESKTOP_IMPORT_CLI_CHATS === '1') {
    importCliChatHistory(db, settings)
  }
}

function ensureDefaultProvider(settings: Settings): void {
  if (!settings.getSecret('provider')) {
    settings.setSecret('provider', 'grok-cli')
  }
  if (!settings.getSecret('model_grok-cli')) {
    settings.setSecret('model_grok-cli', 'grok-build')
  }
}

function importMcpServersFromConfig(settings: Settings): void {
  if (loadMcpServers(settings).length > 0) return

  const configPath = join(homedir(), '.grok', 'config.toml')
  if (!existsSync(configPath)) return

  const raw = readFileSync(configPath, 'utf8')
  const parsed = parseMcpServersFromToml(raw)
  if (parsed.length === 0) return

  const servers: McpServerEntry[] = parsed.map(s => ({
    id: randomUUID(),
    name: s.name,
    command: s.command,
    args: JSON.stringify(s.args),
    env: JSON.stringify({}),
    enabled: s.enabled
  }))
  saveMcpServers(settings, servers)
  console.log(`[bootstrap] imported ${servers.length} MCP server(s) from ~/.grok/config.toml`)
}

/** Minimal TOML parser for [mcp_servers.*] blocks in Grok CLI config. */
function parseMcpServersFromToml(src: string): ParsedMcpServer[] {
  const out: ParsedMcpServer[] = []
  const sectionRe = /^\[mcp_servers\.([^\]]+)\]\s*$/gm
  const matches = [...src.matchAll(sectionRe)]
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1]
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? src.length) : src.length
    const block = src.slice(start, end)
    const command = readTomlString(block, 'command')
    if (!command) continue
    const args = readTomlStringArray(block, 'args')
    const enabledRaw = readTomlString(block, 'enabled')
    out.push({
      name,
      command,
      args,
      enabled: enabledRaw !== 'false'
    })
  }
  return out
}

function readTomlString(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))
  if (!m) return null
  let v = m[1].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

function readTomlStringArray(block: string, key: string): string[] {
  const keyIdx = block.indexOf(`${key} = [`)
  if (keyIdx < 0) return []
  const slice = block.slice(keyIdx)
  const close = slice.indexOf(']')
  if (close < 0) return []
  const inner = slice.slice(slice.indexOf('[') + 1, close)
  const items: string[] = []
  for (const line of inner.split(/\r?\n/)) {
    const t = line.trim().replace(/,$/, '')
    if (!t || t.startsWith('#')) continue
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      items.push(t.slice(1, -1))
    }
  }
  return items
}