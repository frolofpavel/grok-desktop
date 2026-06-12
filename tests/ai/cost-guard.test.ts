import { describe, it, expect } from 'vitest'
import { createCostGuard } from '../../electron/ai/cost-guard'

describe('createCostGuard', () => {
  it('null/0 cap = guard выключен, ничего не блокирует', () => {
    const g = createCostGuard(null)
    const check = g.recordAndCheck('grok', 'grok-4', 10_000_000, 10_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(check.capCents).toBeNull()
  })

  it('CLI провайдеры всегда $0 (подписка), не считаются', () => {
    const g = createCostGuard(0.01)  // очень маленький cap
    const check = g.recordAndCheck('grok-cli', 'auto', 100_000_000, 100_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(g.current()).toBe(0)
  })

  it('Grok-4 API за 1M input + 1M output = $20 → cap $25 не превышен', () => {
    const g = createCostGuard(25)
    const check = g.recordAndCheck('grok', 'grok-4', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(check.cents).toBe(2000)
  })

  it('Grok-4 API превышает cap $5 → exceeded=true', () => {
    const g = createCostGuard(5)
    const check = g.recordAndCheck('grok', 'grok-4', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(true)
    expect(check.message).toMatch(/израсходов/)
    expect(check.message).toMatch(/\$5/)
  })

  it('кумулятивный счёт по нескольким вызовам', () => {
    const g = createCostGuard(0.80)  // $0.80 = 80 cents
    // Grok-4: 100K input = 100K/1M * $5 = $0.50 → 50 cents
    g.recordAndCheck('grok', 'grok-4', 100_000, 0, 0)
    expect(g.current()).toBeCloseTo(50, 0)
    // Ещё 100K input = +50 cents = 100 → превысит $0.80
    const check = g.recordAndCheck('grok', 'grok-4', 100_000, 0, 0)
    expect(check.exceeded).toBe(true)
  })

  it('неизвестная модель не считается, не блокирует', () => {
    const g = createCostGuard(0.01)
    const check = g.recordAndCheck('grok', 'mystery-model-xyz', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(false)
  })

  it('cached input без cached-цены не биллится отдельно', () => {
    const g = createCostGuard(20)
    // У grok-4 нет cached-цены: input=1M, cached=1M → billableInput = 0,
    // cachedCost = 0 → итого $0.
    const check1 = g.recordAndCheck('grok', 'grok-4', 1_000_000, 0, 1_000_000)
    expect(check1.cents).toBe(0)
  })
})
