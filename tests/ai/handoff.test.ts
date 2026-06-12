import { describe, it, expect } from 'vitest'
import { generateHandoff } from '../../electron/ai/handoff'
import type { ChatMessage } from '../../electron/ai/types'

const FIXED_NOW = Date.UTC(2026, 5, 6, 12, 0, 0)

function sampleMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'Почини баг в парсере диапазонов' },
    {
      role: 'assistant',
      content: 'Сейчас прочитаю файл и поправлю.',
      toolCalls: [
        { id: 'c1', name: 'read_file', args: { path: 'src/parser.ts' } },
        { id: 'c2', name: 'write_file', args: { path: 'src/parser.ts' } }
      ]
    },
    { role: 'user', content: '', toolResults: [{ id: 'c2', name: 'write_file', result: 'ok' }] },
    {
      role: 'assistant',
      content: 'Решено: добавил guard на пустой диапазон. Следующий шаг: добавить тест на edge case.'
    }
  ]
}

describe('generateHandoff', () => {
  it('содержит все четыре обязательные секции', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('## Что сделано')
    expect(md).toContain('## Текущее состояние')
    expect(md).toContain('## Следующий шаг')
    expect(md).toContain('## Контекст для продолжения')
  })

  it('извлекает изменённые файлы из toolCalls write_file/apply_patch', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('src/parser.ts')
    expect(md).toContain('Изменённые файлы')
  })

  it('выводит следующий шаг из маркера в последнем ответе ассистента', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('добавить тест на edge case')
  })

  it('собирает ключевые факты по маркеру решения', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('Решено: добавил guard')
  })

  it('считает tool calls и запросы пользователя', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('Tool calls: 2')
    expect(md).toContain('read_file×1')
    expect(md).toContain('write_file×1')
  })

  it('детерминирован — одинаковый вход даёт одинаковый выход', () => {
    const a = generateHandoff(sampleMessages(), { now: FIXED_NOW, title: 'X' })
    const b = generateHandoff(sampleMessages(), { now: FIXED_NOW, title: 'X' })
    expect(a).toBe(b)
  })

  it('пишет parent_id в шапку для incremental handoff', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW, parentId: 'handoff-abc' })
    expect(md).toContain('parent_id: `handoff-abc`')
  })

  it('помечает baseline когда parentId не задан', () => {
    const md = generateHandoff(sampleMessages(), { now: FIXED_NOW })
    expect(md).toContain('baseline')
  })

  it('фоллбэк: извлекает файлы из текста когда toolCalls отсутствуют', () => {
    const flat: ChatMessage[] = [
      { role: 'user', content: 'сделай' },
      { role: 'assistant', content: 'вызываю write_file("src/flat.ts") готово' }
    ]
    const md = generateHandoff(flat, { now: FIXED_NOW })
    expect(md).toContain('src/flat.ts')
  })

  it('не падает на пустом массиве сообщений', () => {
    const md = generateHandoff([], { now: FIXED_NOW })
    expect(md).toContain('# Handoff:')
    expect(md).toContain('## Следующий шаг')
  })
})
