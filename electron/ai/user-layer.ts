import { readFile, stat, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'

/**
 * Discovers and loads the user-defined "user layer" of agent instructions
 * for the current project. This is anything the project owner wants the AI
 * to know — coding conventions, domain rules, common patterns, taboos.
 *
 * Search order (first match wins):
 *   1. AGENTS.md          (Cursor / Codex convention)
 *   2. CLAUDE.md          (Anthropic convention)
 *   3. GEMINI.md          (Google convention)
 *   4. .verstak/RULES.md (our own)
 *
 * The user layer EXTENDS the system layer; it cannot override the protocol.
 * The combined prompt is built by `composeSystemPrompt`.
 */

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.verstak/RULES.md']
const MAX_BYTES = 64 * 1024  // 64 KB safety cap for user layer

export interface UserLayer {
  /** File the layer was loaded from, or null if nothing matched. */
  path: string | null
  /** Raw markdown content; empty string if nothing loaded. */
  content: string
}

export async function loadUserLayer(projectRoot: string | null): Promise<UserLayer> {
  if (!projectRoot) return { path: null, content: '' }
  for (const rel of CANDIDATES) {
    const abs = join(projectRoot, rel)
    try {
      const st = await stat(abs)
      if (!st.isFile()) continue
      if (st.size > MAX_BYTES) continue  // ignore oversized files
      const content = await readFile(abs, 'utf8')
      return { path: rel, content }
    } catch {
      continue
    }
  }
  return { path: null, content: '' }
}

const DEFAULT_RULES = `# Verstak Rules

Эти правила читает AI агент при каждой задаче в этом проекте.
Дополни их под свой стек и стиль — система прибавит их к встроенному
протоколу безопасности и поведения.

## Стек

- (опиши: язык, фреймворк, важные библиотеки)

## Стиль кода

- Минимализм: только запрошенное изменение.
- Сохранять существующий стиль, даже если можно иначе.
- Не удалять чужой неиспользуемый код без явной просьбы.

## Тесты

- Перед фиксом бага — тест, воспроизводящий баг.
- Перед фичей — критерий «как поймём что готово».

## Доменные правила

- (добавь правила специфичные для этого проекта)

## Запреты

- Не трогать секреты (.env, .ssh, credentials).
- Не запускать миграции/деплой без явного разрешения.
- Не расширять scope без подтверждения.
`

/**
 * Create a default `.verstak/RULES.md` if no user layer exists in this
 * project. Idempotent: returns false if any of the candidate files is already
 * present. Called on project open.
 */
export async function ensureUserLayer(projectRoot: string): Promise<{ created: boolean; path: string | null }> {
  for (const rel of CANDIDATES) {
    const abs = join(projectRoot, rel)
    try {
      const st = await stat(abs)
      if (st.isFile()) return { created: false, path: rel }
    } catch { /* not present, keep looking */ }
  }
  const target = join(projectRoot, '.verstak', 'RULES.md')
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, DEFAULT_RULES, 'utf8')
    return { created: true, path: '.verstak/RULES.md' }
  } catch {
    return { created: false, path: null }
  }
}
