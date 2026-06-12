/**
 * Static safety rules for AI-issued shell commands.
 *
 * Two layers:
 *   1. DENYLIST — patterns that are NEVER allowed to run, even with user
 *      confirmation. These are clearly destructive operations a coding agent
 *      should never need (drive wipes, OS reinstall, mass deletions outside
 *      the project, network shenanigans on hosts, etc.).
 *
 *   2. CONFIRMATION (everything else) — all other commands require an explicit
 *      user click in the UI before they execute. The confirmation flow lives in
 *      `ipc/ai.ts`; this module only classifies.
 *
 * The denylist is intentionally tight — false positives that block legit work
 * are worse than false negatives that prompt for confirmation, because the
 * confirmation gate is the real safety net.
 */

export interface CommandClassification {
  /** Pass to user-confirmation UI. */
  allowed: boolean
  /** Reason shown to user / model if blocked. */
  reason?: string
}

interface DenyRule {
  pattern: RegExp
  reason: string
}

const DENY_RULES: DenyRule[] = [
  // rm catch-all: any rm invocation with -r AND -f flags (combined or split) targeting root/home/parent
  { pattern: /\brm\b(?=[^\n]*\b-[a-z]*r[a-z]*\b|[^\n]*-r\b)(?=[^\n]*-[a-z]*f|[^\n]*-f\b)[^\n]*\s+(\/|~|\$HOME|\.\.)/i, reason: 'Запрещено: rm -r -f за пределами проекта или на корень' },
  // Also block plain rm -rf on root regardless of flag order (legacy/simpler)
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f?|-rf|-fr|-r\s+-f|-f\s+-r)\s+(\/|~|\$HOME|\.\.)/i, reason: 'Запрещено: rm -rf за пределами проекта или на корень' },
  { pattern: /\b(format|mkfs|fdisk|diskpart)\b/i,                       reason: 'Запрещено: операции над дисками / файловой системой' },
  { pattern: /\bdd\s+if=.*of=\/dev\b/i,                                  reason: 'Запрещено: запись на сырой блочный девайс через dd' },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,           reason: 'Запрещено: fork-bomb' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,           reason: 'Запрещено: выключение / перезагрузка системы' },
  { pattern: /\bcurl\b[^|]*\|\s*(sh|bash|zsh|powershell|pwsh|cmd)\b/i,   reason: 'Запрещено: pipe curl-вывода в shell (классический RCE-вектор)' },
  { pattern: /\b(wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|iex|powershell|cmd)\b/i, reason: 'Запрещено: pipe сетевого ответа в shell' },
  { pattern: /\bsudo\s+rm\b/i,                                           reason: 'Запрещено: sudo rm' },
  { pattern: /\bgit\s+push\s+.*--force\b/i,                              reason: 'Запрещено: git push --force (фиксить вручную при необходимости)' },
  { pattern: /\bgit\s+(reset\s+--hard\s+HEAD~|clean\s+-fdx|filter-(repo|branch))/i, reason: 'Запрещено: разрушающие git операции' },
  { pattern: /\.ssh|id_rsa|id_ed25519|\.aws\/credentials|\.npmrc/i,      reason: 'Запрещено: чтение/копирование ключей и токенов' },
  // PowerShell EncodedCommand bypass: payload is base64, denylist can't inspect contents
  { pattern: /\bpowershell(\.exe)?\b[^\n]*\s-[eE](?:nc(?:oded(?:command)?)?)?\b/i, reason: 'Запрещено: powershell -EncodedCommand (запутанная команда)' },
  // cmd /c with variable expansion is a common obfuscation pattern
  { pattern: /\bcmd(\.exe)?\s+\/[cC]\b[^\n]*(%[^%\s]+%|![\w]+!)/i,        reason: 'Запрещено: cmd /c с переменными расширения — попытка обфускации' },
  // Invoke-Expression (PowerShell eval) is RCE-by-design
  { pattern: /\b(iex|invoke-expression)\b/i,                              reason: 'Запрещено: PowerShell Invoke-Expression / iex' }
]

/**
 * Normalize a command before checking — collapses whitespace runs so patterns
 * that match `\s+` don't trip on multi-space obfuscation.
 */
function normalize(s: string): string {
  return s.replace(/[\t ]+/g, ' ').trim()
}

/**
 * Человекочитаемый список того, что денилист команд блокирует НАВСЕГДА
 * (даже с подтверждением пользователя). Используется Policy Center для показа
 * правил «опасных команд» — единый источник истины, без дублирования паттернов.
 */
export function dangerousCommandLabels(): string[] {
  // Уникализируем reason'ы (некоторые правила делят формулировку), сохраняя порядок.
  const seen = new Set<string>()
  const out: string[] = []
  for (const rule of DENY_RULES) {
    if (!seen.has(rule.reason)) {
      seen.add(rule.reason)
      out.push(rule.reason)
    }
  }
  return out
}

export function classifyCommand(command: string): CommandClassification {
  const trimmed = normalize(command)
  if (!trimmed) return { allowed: false, reason: 'Пустая команда' }
  for (const rule of DENY_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { allowed: false, reason: rule.reason }
    }
  }
  return { allowed: true }
}
