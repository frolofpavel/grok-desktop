import { describe, it, expect } from 'vitest'
import { estimateCost, costSeverity, costBreakdown } from '../../src/lib/pricing'

describe('estimateCost', () => {
  it('CLI провайдеры — free (usd=null)', () => {
    const c = estimateCost('grok-cli', 'auto', 10000, 5000, 0)
    expect(c.usd).toBeNull()
    expect(c.cents).toBe(0)
  })

  it('Неизвестная модель — usd=—', () => {
    const c = estimateCost('grok', 'unknown-model-xxx', 1000, 1000, 0)
    expect(c.usd).toBe('—')
  })

  it('Grok-4: 1M input + 1M output = $5 + $15 = $20', () => {
    const c = estimateCost('grok', 'grok-4', 1_000_000, 1_000_000, 0)
    expect(c.cents).toBe(2000)
    expect(c.usd).toBe('$20.00')
  })

  it('Cached input не биллится при отсутствии cached-цены', () => {
    // grok-4: input 5, cached-цены нет
    // 1M input, из них 500k cached → billable=500k * 5 = $2.50, cached бесплатно
    const c = estimateCost('grok', 'grok-4', 1_000_000, 0, 500_000)
    expect(c.cents).toBe(250)  // $2.50
  })

  it('Маленькая стоимость показывается как <$0.01', () => {
    const c = estimateCost('grok', 'grok-4-fast', 100, 50, 0)
    expect(c.usd).toBe('<$0.01')
  })
})

describe('costSeverity', () => {
  it('< $2 — нет уровня', () => {
    expect(costSeverity(0)).toBe('')
    expect(costSeverity(50)).toBe('')
    expect(costSeverity(199)).toBe('')
  })

  it('$2 - $5 — warn', () => {
    expect(costSeverity(200)).toBe('is-warn')
    expect(costSeverity(300)).toBe('is-warn')
    expect(costSeverity(499)).toBe('is-warn')
  })

  it('$5+ — alert', () => {
    expect(costSeverity(500)).toBe('is-alert')
    expect(costSeverity(1500)).toBe('is-alert')
  })
})

describe('costBreakdown', () => {
  it('Для CLI указывает подписку', () => {
    const b = costBreakdown('grok-cli', 'auto', 1000, 500, 0)
    expect(b).toMatch(/CLI/)
    expect(b).toMatch(/подписка/)
  })

  it('Для неизвестной модели указывает что цен нет', () => {
    const b = costBreakdown('grok', 'mystery', 100, 50, 0)
    expect(b).toMatch(/цены неизвестны/)
  })

  it('Для API содержит формулу с ценами и итог', () => {
    const b = costBreakdown('grok', 'grok-4', 1_000_000, 1_000_000, 0)
    expect(b).toMatch(/grok-4/i)
    expect(b).toMatch(/\$5.+input/)
    expect(b).toMatch(/\$15.+output/)
    expect(b).toMatch(/Итого: \$20/)
  })

  it('Cached блок не появляется когда у модели нет cached-цены', () => {
    const noCached = costBreakdown('grok', 'grok-4', 1000, 500, 0)
    expect(noCached).not.toMatch(/cached:/)
    // У grok-4 нет cached-цены — блок не показывается даже при cachedTokens > 0
    const withCached = costBreakdown('grok', 'grok-4', 1000, 500, 200)
    expect(withCached).not.toMatch(/cached:/)
  })
})
