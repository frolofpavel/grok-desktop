import type { ChatMessage } from '../types/api'

/**
 * Сериализует last turn основного чата для отправки ревьюеру.
 *
 * Что включаем:
 * - Последнее user сообщение (что просили агента сделать).
 * - Последний assistant ответ (что агент написал).
 * - Краткие выжимки tool calls/results (если есть в thinking).
 *
 * Что НЕ включаем:
 * - Историю старше last turn (ревьюер смотрит ТОЛЬКО на последний шаг).
 * - Системные промпты / context pack (ревьюер сам знает свою задачу).
 *
 * Результат — обычный текст, который попадёт в user-message ревьюера.
 * Ревьюер получит его как «вот что произошло, проверь».
 */
export function composeReviewPayload(messages: ChatMessage[]): string {
  // Берём с конца: последний assistant, перед ним последний user.
  let lastAssistant: ChatMessage | null = null
  let lastUser: ChatMessage | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && !lastAssistant && m.content) {
      lastAssistant = m
    } else if (m.role === 'user' && !lastUser && lastAssistant) {
      // Находим user, который шёл ПЕРЕД lastAssistant
      lastUser = m
      break
    }
  }

  const lines: string[] = []
  lines.push('# Ревью последнего шага агента')
  lines.push('')

  if (lastUser) {
    lines.push('## Запрос пользователя')
    lines.push(truncate(lastUser.content, 4000))
    if (lastUser.attachments?.length) {
      lines.push('')
      lines.push(`_Вложений: ${lastUser.attachments.length} (${lastUser.attachments.map(a => a.name).join(', ')})_`)
    }
    lines.push('')
  }

  if (lastAssistant) {
    lines.push('## Ответ агента')
    lines.push(truncate(lastAssistant.content, 8000))
    if (lastAssistant.thinking) {
      lines.push('')
      lines.push('## Размышление агента (внутреннее)')
      lines.push(truncate(lastAssistant.thinking, 3000))
    }
    lines.push('')
  }

  lines.push('## Задача')
  lines.push('Прочитай запрос и ответ. Найди проблемы в работе агента и выдай отчёт в формате, описанном в системном промпте.')

  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n\n[...обрезано, всего ${text.length} символов]`
}
