#!/usr/bin/env node
/**
 * Grok Desktop CLI - run the Grok API agent from a terminal without the GUI.
 *
 * This standalone script is intentionally Grok-only. The desktop app also
 * supports the official Grok Build CLI (`grok`) as a first-class provider, but
 * this helper talks directly to the xAI API so it can run without Electron.
 */

import { parseArgs } from 'node:util'
import { resolve, join, relative, dirname, isAbsolute } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const GROK_MODELS = ['grok-4', 'grok-4-fast', 'grok-3']
const DEFAULT_MODEL = 'grok-4'
const BASE_URL = 'https://api.x.ai/v1'
const MAX_TURNS = 20
const MAX_FILE_BYTES = 200_000
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '.next', '.vite', '.verstak-data',
  '__pycache__', 'venv', '.venv', 'target', 'build', 'release'
])
const FORBIDDEN_PATTERNS = [/\.env$/i, /\.key$/i, /creds.*\.json$/i, /id_ed25519$/i, /id_rsa$/i]

const { values, positionals } = parseArgs({
  options: {
    provider: { type: 'string', short: 'p', default: 'grok' },
    model: { type: 'string', short: 'm' },
    key: { type: 'string', short: 'k' },
    project: { type: 'string', default: '.' },
    mode: { type: 'string', default: 'auto' },
    stdin: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false }
  },
  allowPositionals: true,
  strict: false
})

const projectPath = resolve(process.cwd(), values.project ?? '.')

if (values.help) {
  console.log(`
Grok Desktop CLI - Grok API agent without the GUI

Usage:
  grok-desktop "your prompt"
  grok-desktop -m grok-4-fast "explain this repository"
  echo "fix tests" | grok-desktop --stdin
  grok-desktop --json "find all TODO comments"

Options:
  -p, --provider   Provider id. Only "grok" is supported by this standalone CLI.
  -m, --model      Grok model: ${GROK_MODELS.join(', ')}. Default: ${DEFAULT_MODEL}
  -k, --key        xAI API key. Also read from XAI_API_KEY or .verstak/settings.json.
  --project        Project directory. Default: current directory.
  --mode           Agent mode: auto, ask, plan. Default: auto.
                   auto - tools run immediately
                   ask  - prints a warning before write/run tools
                   plan - blocks write/run tools
  --stdin          Read prompt from stdin
  --json           Print machine-readable JSON result
  -v, --version    Show version
  -h, --help       Show help

Environment:
  XAI_API_KEY      Grok API key from https://console.x.ai

Official Grok Build CLI:
  Install and authenticate the official "grok" CLI separately, then select
  "Grok Build" inside the Grok Desktop app.
`)
  process.exit(0)
}

if (values.version) {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))
  console.log(`Grok Desktop CLI v${pkg.version}`)
  process.exit(0)
}

if (values.provider !== 'grok') {
  console.error(`Unsupported provider "${values.provider}". Grok Desktop CLI is Grok-only; use --provider grok.`)
  process.exit(1)
}

function resolveApiKey(explicit) {
  if (explicit) return explicit
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY

  const settingsPath = resolve(projectPath, '.verstak', 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
      if (settings.xai_api_key) return settings.xai_api_key
    } catch {
      // Ignore malformed local settings and fall through to a clear error.
    }
  }

  throw new Error('XAI_API_KEY is not set. Add it to the environment or pass --key.')
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data.trim()))
    if (process.stdin.isTTY) resolve('')
  })
}

let prompt = positionals.join(' ').trim()
if (values.stdin || (!prompt && !process.stdin.isTTY)) {
  prompt = await readStdin()
}

if (!prompt) {
  console.error('Error: provide a prompt argument or pipe one through --stdin. Use --help for examples.')
  process.exit(1)
}

function isForbidden(filePath) {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(base))
}

function safeJoin(root, rel) {
  const resolvedRoot = resolve(root)
  const resolved = resolve(resolvedRoot, rel)
  const back = relative(resolvedRoot, resolved)
  if (back.startsWith('..') || isAbsolute(back)) {
    throw new Error(`Path escapes project root: ${rel}`)
  }
  return resolved
}

function readProjectRules(root) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.verstak/RULES.md']
  for (const candidate of candidates) {
    const abs = join(root, candidate)
    if (!existsSync(abs)) continue
    try {
      const content = readFileSync(abs, 'utf8').trim()
      if (content) return `\n--- Project rules from ${candidate} ---\n${content}`
    } catch {
      // Keep startup resilient if a rules file is unreadable.
    }
  }
  return ''
}

function buildSystemPrompt(root) {
  return [
    'You are Grok Desktop CLI, a local-first AI coding agent powered by Grok.',
    `Project root: ${root}`,
    'Use tools when useful: read_file, list_directory, search_project, find_files, get_project_map, write_file, run_command.',
    'Read files before editing them. Keep edits scoped. Do not read or write credentials, private keys, or env files.',
    'After changes, summarize what changed and how it was checked.',
    readProjectRules(root)
  ].filter(Boolean).join('\n')
}

async function toolReadFile(args, root) {
  const rel = String(args.path ?? '')
  if (!rel) return 'Error: path is required'
  const abs = safeJoin(root, rel)
  if (isForbidden(abs)) return `Access denied by policy: ${rel}`
  try {
    const st = statSync(abs)
    if (!st.isFile()) return `Not a file: ${rel}`
    if (st.size > MAX_FILE_BYTES) {
      return `File is too large (${st.size} bytes). Limit: ${MAX_FILE_BYTES} bytes.`
    }
    return await readFile(abs, 'utf8')
  } catch (err) {
    return `Read failed for ${rel}: ${err.message}`
  }
}

async function toolListDirectory(args, root) {
  const rel = String(args.path ?? '.')
  const abs = safeJoin(root, rel)
  try {
    const entries = await readdir(abs, { withFileTypes: true })
    return entries
      .filter(e => !isForbidden(join(abs, e.name)))
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .join('\n') || '(empty directory)'
  } catch (err) {
    return `List failed for ${rel}: ${err.message}`
  }
}

async function toolWriteFile(args, root, mode) {
  const rel = String(args.path ?? '')
  const content = String(args.content ?? '')
  if (!rel) return 'Error: path is required'
  if (mode === 'plan') return `[plan mode] Write blocked: ${rel}`
  const abs = safeJoin(root, rel)
  if (isForbidden(abs)) return `Write denied by policy: ${rel}`
  if (mode === 'ask') {
    process.stderr.write(`\n[confirm] Agent wants to write ${rel}. Non-interactive CLI will continue.\n`)
  }
  try {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    return `Written: ${rel}`
  } catch (err) {
    return `Write failed for ${rel}: ${err.message}`
  }
}

async function toolRunCommand(args, root, mode) {
  const command = String(args.command ?? '')
  if (!command) return 'Error: command is required'
  if (mode === 'plan') return `[plan mode] Command blocked: ${command}`
  if (mode === 'ask') {
    process.stderr.write(`\n[confirm] Agent wants to run: ${command}. Non-interactive CLI will continue.\n`)
  }
  try {
    const output = execSync(command, {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return output || '(no output)'
  } catch (err) {
    return `Command failed (exit ${err.status ?? '?'}): ${err.message}\n${err.stderr ?? ''}`
  }
}

async function toolSearchProject(args, root) {
  const query = String(args.query ?? '')
  if (!query) return 'Error: query is required'
  const flags = ['-n', '--max-count=5', '--max-depth=20']
  if (args.ignoreCase !== false) flags.push('-i')
  if (!args.regex) flags.push('-F')
  if (args.glob) flags.push('--glob', String(args.glob))
  for (const dir of IGNORE_DIRS) flags.push(`--glob=!${dir}/**`)
  flags.push('--', query, '.')
  try {
    const output = execFileSync('rg', flags, {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024
    })
    return output.trim().split('\n').slice(0, 80).join('\n') || 'No matches'
  } catch (err) {
    if (err.status === 1) return 'No matches'
    return `Search failed: ${err.message}`
  }
}

async function toolFindFiles(args, root) {
  const pattern = String(args.pattern ?? '')
  if (!pattern) return 'Error: pattern is required'
  try {
    const flags = ['--files']
    for (const dir of IGNORE_DIRS) flags.push(`--glob=!${dir}/**`)
    flags.push('--glob', pattern)
    const output = execFileSync('rg', flags, {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024
    })
    return output.trim().split('\n').slice(0, 100).join('\n') || 'No files found'
  } catch (err) {
    if (err.status === 1) return 'No files found'
    return `Find failed: ${err.message}`
  }
}

async function toolProjectMap(_args, root) {
  return toolFindFiles({ pattern: '*' }, root)
}

async function executeTool(name, args, root, mode) {
  switch (name) {
    case 'read_file': return toolReadFile(args, root)
    case 'list_directory': return toolListDirectory(args, root)
    case 'write_file': return toolWriteFile(args, root, mode)
    case 'run_command': return toolRunCommand(args, root, mode)
    case 'search_project': return toolSearchProject(args, root)
    case 'find_files': return toolFindFiles(args, root)
    case 'get_project_map': return toolProjectMap(args, root)
    default: return `Unknown tool: ${name}`
  }
}

const TOOL_DEFS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 file relative to the project root.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory relative to the project root.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  },
  {
    name: 'write_file',
    description: 'Write a complete UTF-8 file relative to the project root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
  },
  {
    name: 'search_project',
    description: 'Search project text using ripgrep.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string' },
        ignoreCase: { type: 'boolean' },
        regex: { type: 'boolean' }
      },
      required: ['query']
    }
  },
  {
    name: 'find_files',
    description: 'Find files by glob using ripgrep.',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] }
  },
  {
    name: 'get_project_map',
    description: 'Return a compact file list for the project.',
    parameters: { type: 'object', properties: {} }
  }
]

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, resolve)
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

async function readResponse(res) {
  let raw = ''
  for await (const chunk of res) raw += chunk.toString()
  return raw
}

function toOpenAiMessages(messages) {
  const out = []
  for (const message of messages) {
    if (message.role === 'system') {
      out.push({ role: 'system', content: message.content })
    } else if (message.role === 'assistant') {
      const entry = { role: 'assistant', content: message.content || '' }
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
        }))
      }
      out.push(entry)
    } else if (message.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      })
    } else {
      out.push({ role: 'user', content: message.content || '' })
    }
  }
  return out
}

async function* sendGrok({ apiKey, model, messages, tools }) {
  const body = {
    model: model || DEFAULT_MODEL,
    messages: toOpenAiMessages(messages),
    stream: true,
    tools: tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    })),
    tool_choice: 'auto'
  }

  const res = await httpsPost(`${BASE_URL}/chat/completions`, {
    Authorization: `Bearer ${apiKey}`
  }, body)

  if (res.statusCode !== 200) {
    const raw = await readResponse(res)
    throw new Error(`Grok API HTTP ${res.statusCode}: ${raw.slice(0, 700)}`)
  }

  let buffer = ''
  const pendingToolCalls = {}
  for await (const chunk of res) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue
      let obj
      try { obj = JSON.parse(data) } catch { continue }
      const choice = obj.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) yield { type: 'text', text: delta.content }
      if (delta?.tool_calls?.length) {
        for (const toolCall of delta.tool_calls) {
          const idx = String(toolCall.index ?? 0)
          if (!pendingToolCalls[idx]) {
            pendingToolCalls[idx] = { id: toolCall.id ?? `tc-${idx}`, name: '', argsRaw: '' }
          }
          if (toolCall.id) pendingToolCalls[idx].id = toolCall.id
          if (toolCall.function?.name) pendingToolCalls[idx].name += toolCall.function.name
          if (toolCall.function?.arguments) pendingToolCalls[idx].argsRaw += toolCall.function.arguments
        }
      }
      const finish = choice?.finish_reason
      if (finish === 'tool_calls') {
        for (const call of Object.values(pendingToolCalls)) {
          let args = {}
          try { args = JSON.parse(call.argsRaw || '{}') } catch {}
          yield { type: 'tool-call', call: { id: call.id, name: call.name, args } }
        }
        return
      }
      if (finish === 'stop') {
        yield { type: 'done' }
        return
      }
    }
  }
  yield { type: 'done' }
}

async function runAgent({ apiKey, model, root, mode, jsonMode, prompt }) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(root) },
    { role: 'user', content: prompt }
  ]
  const assistantTexts = []

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let fullText = ''
    const toolCalls = []

    for await (const event of sendGrok({ apiKey, model, messages, tools: TOOL_DEFS })) {
      if (event.type === 'text') {
        fullText += event.text
        if (!jsonMode) process.stdout.write(event.text)
      } else if (event.type === 'tool-call') {
        toolCalls.push(event.call)
      } else if (event.type === 'done') {
        break
      }
    }

    if (fullText) assistantTexts.push(fullText)
    const assistantMessage = { role: 'assistant', content: fullText }
    if (toolCalls.length) assistantMessage.toolCalls = toolCalls
    messages.push(assistantMessage)

    if (toolCalls.length === 0) break

    if (!jsonMode) process.stderr.write(`\n[tools: ${toolCalls.map(c => c.name).join(', ')}]\n`)
    for (const call of toolCalls) {
      let result
      try {
        result = await executeTool(call.name, call.args ?? {}, root, mode)
      } catch (err) {
        result = `Tool error: ${err.message}`
      }
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result)
      })
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      success: true,
      provider: 'grok',
      model: model || DEFAULT_MODEL,
      projectPath: root,
      prompt,
      response: assistantTexts.join('\n'),
      messages: messages.filter(m => m.role !== 'system')
    }, null, 2))
  } else if (assistantTexts.length && !assistantTexts.at(-1).endsWith('\n')) {
    process.stdout.write('\n')
  }
}

try {
  const model = values.model || DEFAULT_MODEL
  if (!GROK_MODELS.includes(model)) {
    throw new Error(`Unsupported Grok model "${model}". Supported: ${GROK_MODELS.join(', ')}`)
  }
  await runAgent({
    apiKey: resolveApiKey(values.key),
    model,
    root: projectPath,
    mode: values.mode,
    jsonMode: values.json,
    prompt
  })
  process.exit(0)
} catch (err) {
  console.error(`\nError: ${err.message}`)
  process.exit(1)
}
