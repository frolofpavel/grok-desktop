import { describe, it, expect } from 'vitest'
import { computeContextBudget } from '../../src/lib/context-budget'

const SYSTEM = [
  '<verstak_system_layer>\nПротокол агента тут\n</verstak_system_layer>',
  '<user_layer source="CLAUDE.md">\nПравила проекта\n</user_layer>',
  '<context_pack>\nRecent writes + map\n</context_pack>',
  '<skill_layer>\nСпециализация скилла\n</skill_layer>',
  '<preflight_hint>\nПодсказка про preflight\n</preflight_hint>'
].join('\n\n')

describe('computeContextBudget', () => {
  it('splits the composed system prompt into named layers', () => {
    const b = computeContextBudget(SYSTEM, 'привет', [])
    const labels = b.sections.map(s => s.label)
    expect(labels).toContain('Системный слой')
    expect(labels).toContain('Правила проекта')
    expect(labels).toContain('Контекст-пак')
    expect(labels).toContain('Скилл')
    expect(labels).toContain('Preflight-подсказка')
    expect(labels).toContain('Сообщение пользователя')
  })

  it('skips empty sections and sums history', () => {
    const b = computeContextBudget('<verstak_system_layer>\nтолько ядро\n</verstak_system_layer>', '', [
      { content: 'abcd' },
      { content: 'efgh' }
    ])
    const labels = b.sections.map(s => s.label)
    expect(labels).not.toContain('Сообщение пользователя')
    expect(labels).not.toContain('Правила проекта')
    const history = b.sections.find(s => s.label === 'История/сообщения')
    expect(history?.chars).toBe(8)
    expect(history?.tokens).toBe(2) // ceil(8/4)
  })

  it('token estimate is ceil(chars / 4) per section', () => {
    const b = computeContextBudget('<context_pack>\nx</context_pack>', '', [])
    const pack = b.sections.find(s => s.label === 'Контекст-пак')
    expect(pack?.chars).toBe(1)
    expect(pack?.tokens).toBe(1)
  })

  it('falls back to head when system wrapper tag is absent', () => {
    const noWrap = 'голый протокол без обёртки\n\n<context_pack>pack</context_pack>'
    const b = computeContextBudget(noWrap, '', [])
    const sys = b.sections.find(s => s.label === 'Системный слой')
    expect(sys).toBeDefined()
    expect(sys?.chars).toBeGreaterThan(0)
  })

  it('detects sliding-window compaction markers', () => {
    const withMarker = computeContextBudget(SYSTEM, '', [
      { content: '[compacted: read_file (5000 симв., turn 2) — обрезано sliding window]' }
    ])
    expect(withMarker.compacted).toBe(true)
    const clean = computeContextBudget(SYSTEM, 'обычный текст', [{ content: 'ничего особенного' }])
    expect(clean.compacted).toBe(false)
  })
})
