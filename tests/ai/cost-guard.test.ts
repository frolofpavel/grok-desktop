import { describe, it, expect } from 'vitest'
import { createCostGuard } from '../../electron/ai/cost-guard'

describe('createCostGuard', () => {
  it('null/0 cap = guard выключен, ничего не блокирует', () => {
    const g = createCostGuard(null)
    const check = g.recordAndCheck('claude', 'claude-sonnet-4-6', 10_000_000, 10_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(check.capCents).toBeNull()
  })

  it('CLI провайдеры всегда $0 (подписка), не считаются', () => {
    const g = createCostGuard(0.01)  // очень маленький cap
    const check = g.recordAndCheck('claude-cli', 'claude-sonnet-4-6', 100_000_000, 100_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(g.current()).toBe(0)
  })

  it('Sonnet API за 1M input + 1M output = $18 → cap $20 не превышен', () => {
    const g = createCostGuard(20)
    const check = g.recordAndCheck('claude', 'claude-sonnet-4-6', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(false)
    expect(check.cents).toBe(1800)
  })

  it('Sonnet API превышает cap $5 → exceeded=true', () => {
    const g = createCostGuard(5)
    const check = g.recordAndCheck('claude', 'claude-sonnet-4-6', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(true)
    expect(check.message).toMatch(/израсходов/)
    expect(check.message).toMatch(/\$5/)
  })

  it('кумулятивный счёт по нескольким вызовам', () => {
    const g = createCostGuard(0.50)  // $0.50 = 50 cents
    // Sonnet: 100K input = 100K/1M * $3 = $0.30 → 30 cents
    g.recordAndCheck('claude', 'claude-sonnet-4-6', 100_000, 0, 0)
    expect(g.current()).toBeCloseTo(30, 0)
    // Ещё 100K input = +30 cents = 60 → превысит $0.50
    const check = g.recordAndCheck('claude', 'claude-sonnet-4-6', 100_000, 0, 0)
    expect(check.exceeded).toBe(true)
  })

  it('неизвестная модель не считается, не блокирует', () => {
    const g = createCostGuard(0.01)
    const check = g.recordAndCheck('claude', 'mystery-model-xyz', 1_000_000, 1_000_000, 0)
    expect(check.exceeded).toBe(false)
  })

  it('cached input снижает биллинг', () => {
    const g = createCostGuard(20)
    // 1M cached vs 1M billable input — разница 10× по cost
    const check1 = g.recordAndCheck('claude', 'claude-sonnet-4-6', 1_000_000, 0, 1_000_000)
    // Cached = $0.30 / 1M, billable input - $3 / 1M.
    // input=1M, cached=1M → billableInput = 0, cachedCost = 1M * 0.3/1M = $0.30
    expect(check1.cents).toBeCloseTo(30, 0)
  })
})
