import { describe, it, expect } from 'vitest'
import { parseDecomposition } from '../../electron/ipc/tool-handlers'
import { estimateComplexity, recommendModel } from '../../electron/ai/smart-router'

// Фаза 3, Идея 5 — Smart Orchestrator: декомпозиция цели на подзадачи + умный
// выбор модели на каждую. Тестируем чистые части (parseDecomposition + smart-router),
// сетевой вызов модели не трогаем.

describe('parseDecomposition — разбор ответа планировщика', () => {
  it('парсит чистый JSON-массив подзадач с ролями', () => {
    const text = '[{"id":"a","prompt":"найти конфиг","role":"researcher"},{"id":"b","prompt":"починить баг","role":"executor"}]'
    const tasks = parseDecomposition(text, 'goal', 5)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual({ id: 'a', prompt: 'найти конфиг', role: 'researcher' })
    expect(tasks[1].role).toBe('executor')
  })

  it('вырезает JSON из обёртки (```json + болтовня модели)', () => {
    const text = 'Вот декомпозиция:\n```json\n[{"id":"x","prompt":"проверить типы","role":"verifier"}]\n```\nГотово.'
    const tasks = parseDecomposition(text, 'goal', 5)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].role).toBe('verifier')
  })

  it('невалидную роль заменяет на executor', () => {
    const tasks = parseDecomposition('[{"prompt":"сделать","role":"hacker"}]', 'goal', 5)
    expect(tasks[0].role).toBe('executor')
  })

  it('режет до max_subtasks', () => {
    const arr = Array.from({ length: 10 }, (_, i) => `{"id":"t${i}","prompt":"p${i}","role":"executor"}`)
    const tasks = parseDecomposition(`[${arr.join(',')}]`, 'goal', 3)
    expect(tasks).toHaveLength(3)
  })

  it('пропускает пункты без prompt', () => {
    const tasks = parseDecomposition('[{"id":"a","role":"executor"},{"prompt":"ok","role":"executor"}]', 'goal', 5)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].prompt).toBe('ok')
  })

  it('фоллбэк при невалидном JSON: одна executor-подзадача = вся цель', () => {
    const tasks = parseDecomposition('модель ответила прозой без json', 'почини сборку', 5)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual({ id: 'task-1', prompt: 'почини сборку', role: 'executor' })
  })

  it('фоллбэк при пустом массиве', () => {
    const tasks = parseDecomposition('[]', 'цель', 5)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].role).toBe('executor')
  })
})

describe('smart-router per-subtask — выбор модели по сложности подзадачи', () => {
  it('простую короткую подзадачу → дешёвая grok-4-fast', () => {
    const complexity = estimateComplexity([{ role: 'user', content: 'list files' }], [])
    expect(complexity).toBe('simple')
    expect(recommendModel('grok', complexity)).toBe('grok-4-fast')
  })

  it('сложную подзадачу (несколько сигналов) → мощная grok-4', () => {
    const complexity = estimateComplexity([{ role: 'user', content: 'refactor and rewrite the build system and migrate config' }], [])
    expect(complexity).toBe('complex')
    expect(recommendModel('grok', complexity)).toBe('grok-4')
  })

  it('moderate подзадача → grok-4-fast (баланс цена/качество)', () => {
    const complexity = estimateComplexity([{ role: 'user', content: 'implement a small helper function for date parsing' }], [])
    expect(complexity).toBe('moderate')
    expect(recommendModel('grok', complexity)).toBe('grok-4-fast')
  })

  it('неизвестный провайдер → null (фоллбэк на defaultModel в оркестраторе)', () => {
    expect(recommendModel('unknown-provider', 'complex')).toBeNull()
  })
})
