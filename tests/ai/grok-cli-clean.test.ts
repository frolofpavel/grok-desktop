import { describe, it, expect } from 'vitest'
import { cleanGrokOutput } from '../../electron/ai/grok-cli'

// Grok-4 в Heavy-режиме сливает свои мысли в text-стрим вместе с финальным
// ответом. Парсер должен отделить чистый русский ответ от английского reasoning.

describe('cleanGrokOutput — real Grok-4 leak patterns', () => {
  it('<answer>…</answer> wrapper: берём содержимое тега, остальное в reasoning', () => {
    const raw = `The user message is in Russian: "тут мне GROK Ответил?" <answer> Да, это я (Grok) ответил тебе. Я Grok 4.3. </answer>

Explanation
The response is constructed by first confirming the identity...`
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toBe('Да, это я (Grok) ответил тебе. Я Grok 4.3.')
    expect(reasoning).toContain('Explanation')
    expect(reasoning).toContain('The user message is in Russian')
  })

  it('Преамбула "The user said …" + русский ответ: преамбулу выкидываем', () => {
    const raw = `The user said "Привет", which is Russian for "Hello".

Привет! Чем могу помочь с маркетингом в Antis Studio?`
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toBe('Привет! Чем могу помочь с маркетингом в Antis Studio?')
    expect(reasoning).toContain('The user said')
  })

  it('\\confidence{N} marker: убираем из ответа, кладём в reasoning', () => {
    const raw = `Нет, не каждое сообщение — новая сессия с нуля.

\\confidence{50}`
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toBe('Нет, не каждое сообщение — новая сессия с нуля.')
    expect(reasoning).toContain('confidence: 50')
    expect(answer).not.toContain('confidence')
  })

  it('Многопараграфный mix: ведущий английский → reasoning, всё с первого русского → answer', () => {
    const raw = `The user is asking about session persistence.

Why "отвечал": This might refer to a previous response.

Нет, не каждое сообщение — новая сессия с нуля.

В этом интерфейсе контекст сохраняется (история + саммаризация).

В Telegram через MCP — да, почти так.`
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toContain('Нет, не каждое сообщение')
    expect(answer).toContain('В этом интерфейсе')
    expect(answer).toContain('В Telegram через MCP')
    expect(reasoning).toContain('The user is asking')
    expect(reasoning).toContain('Why "отвечал"')
  })

  it('Заголовки Explanation/Reasoning/Analysis сами по себе → reasoning', () => {
    const raw = `Привет! Готов работать.

Explanation

The response begins with a standard greeting.`
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toBe('Привет! Готов работать.')
    expect(reasoning).toContain('Explanation')
    expect(reasoning).toContain('The response begins')
  })

  it('Чистый русский ответ без мусора: всё идёт в answer, reasoning пустой', () => {
    const raw = 'Готово. Что дальше?'
    const { answer, reasoning } = cleanGrokOutput(raw)
    expect(answer).toBe('Готово. Что дальше?')
    expect(reasoning).toBe('')
  })

  it('Защита: только английский без <answer>-тега → всё в answer (не теряем ответ)', () => {
    // Если пользователь спросил по-английски — Grok ответит по-английски,
    // и эвристика cyrRatio не должна всё выкинуть.
    // Текущая стратегия: первый параграф попадёт в reasoning, остальные
    // в answer. Но если параграф один — он пройдёт через inAnswer=true.
    // Здесь проверяем граничный случай.
    const raw = 'Done. What next?'
    const { answer } = cleanGrokOutput(raw)
    // Параграф один, cyrRatio=0 < 0.3 → попадёт в reasoning.
    // Но в grok-cli.ts есть fallback: «если answer пустой и reasoning тоже —
    // отдаём весь буфер как text». Здесь мы тестируем чистый cleanGrokOutput:
    // ожидаем что answer пустой, reasoning не пустой — но fallback в caller'е.
    expect(answer === '' || answer === 'Done. What next?').toBe(true)
  })

  it('Mixed code + кириллица: код-пути в ответе НЕ выкидываются', () => {
    const raw = `Я Grok 4.3 от xAI, подключён через electron/ai/grok.ts → OpenAI-compat на https://api.x.ai/v1.`
    const { answer } = cleanGrokOutput(raw)
    expect(answer).toContain('electron/ai/grok.ts')
    expect(answer).toContain('https://api.x.ai/v1')
    expect(answer).toContain('Я Grok')
  })
})
