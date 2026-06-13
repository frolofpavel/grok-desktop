import { describe, it, expect } from 'vitest'
import {
  MAX_DELEGATION_DEPTH,
  MAX_TOTAL_AGENTS_PER_SESSION,
  checkDelegationAllowed,
  SessionAgentCounter
} from '../../electron/ai/delegation-limits'

/**
 * Лимиты дерева делегирования (Фаза 4, Идея 3). Главный риск фичи — рекурсия и
 * взрыв количества агентов. Эти тесты фиксируют, что depth-гейт пускает на
 * depth < MAX и режет на пределе, а счётчик total режет на потолке. Без зелёных
 * этих тестов фичу включать нельзя.
 */

describe('checkDelegationAllowed — гейт глубины + количества', () => {
  it('пускает на depth < MAX_DELEGATION_DEPTH', () => {
    for (let d = 0; d < MAX_DELEGATION_DEPTH; d++) {
      expect(checkDelegationAllowed(d, 0, 1).allowed).toBe(true)
    }
  })

  it('блокирует на depth === MAX_DELEGATION_DEPTH (предел глубины)', () => {
    const gate = checkDelegationAllowed(MAX_DELEGATION_DEPTH, 0, 1)
    expect(gate.allowed).toBe(false)
    expect(gate.reason).toMatch(/глубин/i)
  })

  it('блокирует на depth выше предела', () => {
    expect(checkDelegationAllowed(MAX_DELEGATION_DEPTH + 5, 0, 1).allowed).toBe(false)
  })

  it('режет когда total + count превышает потолок числа агентов', () => {
    // ровно на границе — ещё можно
    const atEdge = checkDelegationAllowed(0, MAX_TOTAL_AGENTS_PER_SESSION - 1, 1)
    expect(atEdge.allowed).toBe(true)
    // на 1 больше — нельзя
    const over = checkDelegationAllowed(0, MAX_TOTAL_AGENTS_PER_SESSION, 1)
    expect(over.allowed).toBe(false)
    expect(over.reason).toMatch(/количеств|агент/i)
  })

  it('батч (count > 1) учитывается целиком против потолка', () => {
    // 95 уже потрачено, просим батч из 10 → 105 > 100 → нельзя
    const gate = checkDelegationAllowed(0, MAX_TOTAL_AGENTS_PER_SESSION - 5, 10)
    expect(gate.allowed).toBe(false)
  })
})

describe('SessionAgentCounter — общий потолок на всё дерево', () => {
  it('инкрементирует только при успешном резерве', () => {
    const c = new SessionAgentCounter()
    expect(c.count).toBe(0)
    expect(c.tryReserve(0, 3).allowed).toBe(true)
    expect(c.count).toBe(3)
    expect(c.tryReserve(0, 2).allowed).toBe(true)
    expect(c.count).toBe(5)
  })

  it('НЕ трогает счётчик при отказе по глубине', () => {
    const c = new SessionAgentCounter()
    const gate = c.tryReserve(MAX_DELEGATION_DEPTH, 1)
    expect(gate.allowed).toBe(false)
    expect(c.count).toBe(0)
  })

  it('режет на потолке total и не уходит за него', () => {
    const c = new SessionAgentCounter()
    // забиваем почти до потолка
    expect(c.tryReserve(0, MAX_TOTAL_AGENTS_PER_SESSION - 1).allowed).toBe(true)
    // ещё один — ок (ровно потолок)
    expect(c.tryReserve(0, 1).allowed).toBe(true)
    expect(c.count).toBe(MAX_TOTAL_AGENTS_PER_SESSION)
    // следующий — отказ, счётчик не растёт
    expect(c.tryReserve(0, 1).allowed).toBe(false)
    expect(c.count).toBe(MAX_TOTAL_AGENTS_PER_SESSION)
  })

  it('цикл делегирований не уходит в бесконечность — потолок гасит за конечное число шагов', () => {
    // Симулируем «суб делегирует суба, тот делегирует ещё» по 1 за шаг.
    // Даже если depth каким-то образом оставался бы 0, потолок total обязан
    // остановить процесс за <= MAX_TOTAL_AGENTS_PER_SESSION итераций.
    const c = new SessionAgentCounter()
    let steps = 0
    while (c.tryReserve(0, 1).allowed) {
      steps++
      if (steps > MAX_TOTAL_AGENTS_PER_SESSION + 10) break // тестовый предохранитель
    }
    expect(steps).toBe(MAX_TOTAL_AGENTS_PER_SESSION)
    expect(c.tryReserve(0, 1).allowed).toBe(false)
  })
})
