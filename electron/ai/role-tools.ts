/**
 * Whitelist инструментов по роли субагента (Фаза 1 спринта мультиагентности).
 *
 * Субагенты теперь крутят agent-loop с инструментами, но НЕ полным набором
 * главного агента — каждая роль получает только то, что ей нужно по смыслу.
 * Это и безопасность (researcher не должен писать файлы), и защита от взрыва
 * стоимости/рекурсии (никто не может делегировать дальше).
 *
 * Контракт зафиксирован тестами в tests/ai/role-tools.test.ts — если кто-то
 * случайно даст read-only роли write-tool, тест упадёт.
 */

/** Базовый read-only набор — доступен всем ролям. */
const READ_ONLY_TOOLS = [
  'read_file',
  'list_directory',
  'search_project',
  'find_files',
  'get_project_map',
  'impact_analysis'
] as const

/**
 * Инструменты, которые субагенту НИКОГДА нельзя давать — независимо от роли.
 * delegate_* = рекурсивное делегирование (Фаза 4), запрещено как защита от
 * бесконечной рекурсии и взрыва стоимости. Остальное — тяжёлые/побочные
 * операции, не относящиеся к узкой подзадаче субагента.
 */
export const SUBAGENT_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'delegate_task',
  'delegate_parallel'
])

/**
 * Вернуть список разрешённых tool-имён для роли субагента.
 *
 * - researcher / critic / planner → READ-ONLY (анализ, без записи и команд).
 * - verifier → read-only + check_diagnostics + run_command (но run_command
 *   ограничен whitelist'ом проверочных команд в command-policy.isVerifierCommand).
 * - executor → read-only + apply_patch + write_file (через mode-policy.decide) +
 *   run_command (через command-policy denylist, как у главного агента).
 * - роль не задана (delegate_task без роли) → безопасный read-only default.
 *
 * delegate_task / delegate_parallel исключаются ВСЕГДА (SUBAGENT_FORBIDDEN_TOOLS).
 */
export function getRoleToolset(role?: string | null): string[] {
  let tools: string[]
  switch (role) {
    case 'executor':
      tools = [...READ_ONLY_TOOLS, 'apply_patch', 'write_file', 'run_command', 'check_diagnostics']
      break
    case 'verifier':
      tools = [...READ_ONLY_TOOLS, 'check_diagnostics', 'run_command']
      break
    case 'researcher':
    case 'critic':
    case 'planner':
    default:
      // researcher/critic/planner и неизвестная/пустая роль — строго read-only
      tools = [...READ_ONLY_TOOLS]
      break
  }
  // Defence-in-depth: даже если выше кто-то добавит delegate_* — вырезаем.
  return tools.filter(t => !SUBAGENT_FORBIDDEN_TOOLS.has(t))
}
