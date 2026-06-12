/**
 * Context Budget — разбор composed system-промпта на именованные слои и оценка
 * их размера в токенах. Делает видимым ЧТО реально ушло в контекст модели.
 *
 * Renderer-only, чистая логика. Имена тегов реплицированы из
 * electron/ai/compose-prompt.ts (renderer не импортит electron/). Если порядок
 * или имена тегов там меняются — обновить TAGS здесь.
 */

/** Именованная секция входа запуска: метка + текст слоя. */
export interface InputSection {
  label: string
  text: string
}

/** Один слой бюджета: метка для UI + размеры. */
export interface BudgetSection {
  label: string
  chars: number
  tokens: number
}

export interface ContextBudget {
  sections: BudgetSection[]
  totalChars: number
  totalTokens: number
  /** true если в системнике/истории найдены маркеры sliding-window сжатия. */
  compacted: boolean
}

/**
 * Эвристика оценки токенов: ~4 символа на токен. Это приближение —
 * реальный токенизатор у каждого провайдера свой (BPE/SentencePiece), цифры
 * расходятся. Совпадает с estimateTokens из electron/ai/context-limits.ts.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Слои composed system-промпта в порядке сборки (compose-prompt.ts).
const TAGS: { tag: string; label: string }[] = [
  { tag: 'verstak_system_layer', label: 'Системный слой' },
  { tag: 'user_layer', label: 'Правила проекта' },
  { tag: 'context_pack', label: 'Контекст-пак' },
  { tag: 'skill_layer', label: 'Скилл' },
  { tag: 'preflight_hint', label: 'Preflight-подсказка' }
]

// Маркеры sliding-window сжатия из electron/ai/compact-history.ts.
const COMPACT_MARKERS = ['[compacted:', '[…вырезано', 'chars omitted', '[Авто-компакшн']

/** Достаёт содержимое первого тега <tag ...>...</tag> (атрибуты допустимы). */
function extractTag(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(source)
  return m ? m[1].trim() : null
}

/**
 * Разбирает systemPrompt на именованные слои по тегам + сообщение пользователя.
 * Если тег найден — берём его контент; системный слой дополнительно ловим как
 * «голову» до первого тега, когда обёртки <verstak_system_layer> нет
 * (робастность к смене формата). userMessage — отдельная секция, это не часть
 * system-строки. Возвращает только непустые секции в порядке сборки.
 *
 * Общий сплиттер: используется и бюджетом контекста, и диффом между запусками.
 */
export function splitIntoSections(systemPrompt: string, userMessage: string): InputSection[] {
  const sections: InputSection[] = []
  const push = (label: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    sections.push({ label, text: trimmed })
  }

  for (const { tag, label } of TAGS) {
    const content = extractTag(systemPrompt, tag)
    if (content !== null) {
      push(label, content)
    } else if (tag === 'verstak_system_layer') {
      // Обёртки системного слоя нет — берём голову до первого known-тега.
      const firstTagIdx = systemPrompt.search(/<[a-z_]+(?:\s[^>]*)?>/i)
      const head = firstTagIdx >= 0 ? systemPrompt.slice(0, firstTagIdx) : systemPrompt
      push(label, head)
    }
  }

  push('Сообщение пользователя', userMessage)

  return sections
}

/**
 * Разбирает systemPrompt на слои по тегам. Если тег найден — берём его контент;
 * системный слой дополнительно ловим как «голову» до первого тега, когда
 * обёртки <verstak_system_layer> нет (робастность к смене формата).
 * userMessage и история передаются отдельно — это не часть system-строки.
 */
export function computeContextBudget(
  systemPrompt: string,
  userMessage: string,
  messages: { content: string }[]
): ContextBudget {
  const sections: BudgetSection[] = []
  const push = (label: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    sections.push({ label, chars: trimmed.length, tokens: estimateTokens(trimmed) })
  }

  for (const part of splitIntoSections(systemPrompt, userMessage)) {
    push(part.label, part.text)
  }

  const historyText = messages.map(m => m.content ?? '').join('')
  push('История/сообщения', historyText)

  const totalChars = sections.reduce((s, x) => s + x.chars, 0)
  const totalTokens = sections.reduce((s, x) => s + x.tokens, 0)

  const haystack = systemPrompt + historyText
  const compacted = COMPACT_MARKERS.some(marker => haystack.includes(marker))

  return { sections, totalChars, totalTokens, compacted }
}
