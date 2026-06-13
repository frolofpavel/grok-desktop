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
 * TodoGate (Фаза 3, Идея 2): доступ к оркестрационному todo-листу.
 * todo_update/todo_list даём всем ролям-исполнителям — они берут пункты в работу
 * и закрывают их (прозрачность прогресса). todo_create (создание листа) — НЕ
 * субам: лист создаёт главный агент / planner.
 */
const TODO_WORKER_TOOLS = ['todo_update', 'todo_list'] as const

/**
 * Инструменты, которые субагенту НИКОГДА нельзя давать — независимо от роли.
 * delegate_* / orchestrate = рекурсивное делегирование (Фаза 4), запрещено как
 * защита от бесконечной рекурсии и взрыва стоимости. orchestrate вызывает только
 * ГЛАВНЫЙ агент. Остальное — тяжёлые/побочные операции, не относящиеся к узкой
 * подзадаче субагента.
 */
export const SUBAGENT_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'delegate_task',
  'delegate_parallel',
  'orchestrate'
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
      // executor берёт пункты todo в работу и закрывает + сохраняет находки в память.
      tools = [...READ_ONLY_TOOLS, ...TODO_WORKER_TOOLS, 'apply_patch', 'write_file', 'run_command', 'check_diagnostics', 'memory_save']
      break
    case 'verifier':
      // verifier отмечает прогресс по todo + фиксирует выводы верификации в память (Идея 8).
      tools = [...READ_ONLY_TOOLS, ...TODO_WORKER_TOOLS, 'check_diagnostics', 'run_command', 'memory_save']
      break
    case 'researcher':
      // researcher берёт/закрывает todo + сохраняет находки в долговременную память (Идея 8).
      tools = [...READ_ONLY_TOOLS, ...TODO_WORKER_TOOLS, 'memory_save']
      break
    case 'planner':
      // planner может создавать todo-лист (декомпозиция) + видеть прогресс.
      tools = [...READ_ONLY_TOOLS, 'todo_create', ...TODO_WORKER_TOOLS]
      break
    case 'critic':
    default:
      // critic и неизвестная/пустая роль — read-only + просмотр прогресса todo.
      tools = [...READ_ONLY_TOOLS, 'todo_list']
      break
  }
  // Defence-in-depth: даже если выше кто-то добавит delegate_* — вырезаем.
  return tools.filter(t => !SUBAGENT_FORBIDDEN_TOOLS.has(t))
}
