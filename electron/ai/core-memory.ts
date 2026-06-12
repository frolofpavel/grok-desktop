/**
 * Core Memory — Hermes-style постоянная память агента.
 *
 * Два файла в папке .verstak/ активного проекта:
 *   MEMORY.md — заметки о проекте: конвенции, находки, контекст окружения.
 *   USER.md   — заметки о пользователе: предпочтения, стиль общения, правила.
 *
 * Core memory ВСЕГДА инжектируется в system prompt при каждом turn'е (в отличие
 * от архивной памяти, которая ищется один раз за app-сессию). Агент может
 * обновлять её через tools: core_memory_append / core_memory_replace / core_memory_remove.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const MEMORY_FILE = 'MEMORY.md'
const USER_FILE = 'USER.md'
const MAX_MEMORY_CHARS = 2000
const MAX_USER_CHARS = 1500

export interface CoreMemoryBlocks {
  memory: string   // содержимое MEMORY.md
  user: string     // содержимое USER.md
}

/** Прочитать оба блока core memory для проекта. Возвращает пустые строки если файлы не существуют. */
export function loadCoreMemory(projectPath: string): CoreMemoryBlocks {
  const dir = join(projectPath, '.verstak')
  const memoryPath = join(dir, MEMORY_FILE)
  const userPath = join(dir, USER_FILE)
  return {
    memory: existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '',
    user: existsSync(userPath) ? readFileSync(userPath, 'utf-8') : ''
  }
}

/** Перезаписать один блок целиком (с ограничением по длине). */
export function saveCoreMemoryBlock(projectPath: string, block: 'memory' | 'user', content: string): void {
  const dir = join(projectPath, '.verstak')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = block === 'memory' ? MEMORY_FILE : USER_FILE
  const max = block === 'memory' ? MAX_MEMORY_CHARS : MAX_USER_CHARS
  writeFileSync(join(dir, file), content.slice(0, max), 'utf-8')
}

/**
 * Найти oldText в блоке и заменить на newText.
 * Возвращает { success: false } если oldText не найден — агент получит
 * ошибку и сможет перечитать текущее содержимое перед повторной попыткой.
 */
export function replaceCoreMemory(
  projectPath: string,
  block: 'memory' | 'user',
  oldText: string,
  newText: string
): { success: boolean; content: string } {
  const blocks = loadCoreMemory(projectPath)
  const current = block === 'memory' ? blocks.memory : blocks.user
  if (!current.includes(oldText)) return { success: false, content: current }
  const updated = current.replace(oldText, newText)
  saveCoreMemoryBlock(projectPath, block, updated)
  return { success: true, content: updated.slice(0, block === 'memory' ? MAX_MEMORY_CHARS : MAX_USER_CHARS) }
}

/**
 * Добавить текст в конец блока.
 * overflow: true если итог превысил лимит (контент всё равно сохраняется, но обрезается).
 */
export function appendCoreMemory(
  projectPath: string,
  block: 'memory' | 'user',
  text: string
): { success: boolean; content: string; overflow: boolean } {
  const blocks = loadCoreMemory(projectPath)
  const current = block === 'memory' ? blocks.memory : blocks.user
  const max = block === 'memory' ? MAX_MEMORY_CHARS : MAX_USER_CHARS
  const joined = current.length > 0 ? current + '\n' + text : text
  const overflow = joined.length > max
  saveCoreMemoryBlock(projectPath, block, joined)
  return { success: true, content: joined.slice(0, max), overflow }
}

/**
 * Удалить фрагмент из блока.
 * Лишние пустые строки после удаления схлопываются.
 */
export function removeCoreMemory(
  projectPath: string,
  block: 'memory' | 'user',
  text: string
): { success: boolean; content: string } {
  const blocks = loadCoreMemory(projectPath)
  const current = block === 'memory' ? blocks.memory : blocks.user
  if (!current.includes(text)) return { success: false, content: current }
  const updated = current.replace(text, '').replace(/\n{3,}/g, '\n\n').trim()
  saveCoreMemoryBlock(projectPath, block, updated)
  return { success: true, content: updated }
}
