import { describe, it, expect } from 'vitest'
import { buildCliPrompt } from '../../electron/ai/cli-prompt'
import type { ChatMessage } from '../../electron/ai/types'

/**
 * Регрессия (grok-cli «отвечает на первое сообщение»): payload собирался,
 * потом тупо резался до argv-cap С КОНЦА — а реальное user-сообщение приписано
 * последним, поэтому именно оно и срезалось. Grok видел только system layer и
 * отвечал дежурным приветствием на любое сообщение. Фикс: maxChars в
 * buildCliPrompt гарантирует, что system-layer И само сообщение уцелеют,
 * обрезая середину (историю/контекст).
 */
describe('buildCliPrompt — бюджет argv-cap (grok-cli)', () => {
  // Воспроизводит сценарий со скрина: серия сообщений, последнее — реальный вопрос.
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Здарова, молодой!' },
    { role: 'assistant', content: 'Здарова. Чем помочь?' },
    { role: 'user', content: 'У тебя же подключены АПИ директа и метрики?' },
    { role: 'assistant', content: 'На связи — чем заняться?' },
    { role: 'user', content: 'АПИ у тебя подключены какие-то? Проверь' }
  ]

  it('последнее user-сообщение уцелевает даже при превышении лимита', async () => {
    const payload = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: null,
      messages,
      maxChars: 8000
    })
    expect(payload.length).toBeLessThanOrEqual(8000)
    // Сам вопрос обязан быть в payload (раньше срезался с конца).
    expect(payload).toContain('АПИ у тебя подключены какие-то? Проверь')
    // И он в самом конце (это «prompt» для CLI).
    expect(payload.trimEnd().endsWith('АПИ у тебя подключены какие-то? Проверь')).toBe(true)
  })

  it('без maxChars payload содержит и историю, и вопрос', async () => {
    const payload = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: null,
      messages
    })
    expect(payload).toContain('АПИ у тебя подключены какие-то? Проверь')
    expect(payload).toContain('conversation_history')
  })

  it('длинный вопрос побеждает: при крошечном бюджете режется head, не вопрос', async () => {
    const longQuestion = 'Проверь подключение: ' + 'директ '.repeat(200)
    const payload = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: null,
      messages: [{ role: 'user', content: longQuestion }],
      maxChars: 4000
    })
    expect(payload.length).toBeLessThanOrEqual(4000)
    expect(payload).toContain(longQuestion)
  })
})
