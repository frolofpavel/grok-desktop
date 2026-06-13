import { describe, it, expect } from 'vitest'
import { buildSwarmRoster } from '../../electron/ipc/tool-handlers'
import { getRoleToolset } from '../../electron/ai/role-tools'
import { MAX_DELEGATION_DEPTH } from '../../electron/ai/delegation-limits'

/**
 * Agent Swarms (Фаза 4, Идея 10). Тестируем чистый билдер ростера роя (состав
 * по size, разные углы) + что арбитр-механизм опирается на read-only роль critic.
 * Сетевые вызовы агентов/арбитра не трогаем — это интеграция.
 *
 * Плюс — depth-аспект Идеи 3: на разрешённой глубине суб-исполнитель получает
 * delegate_*, на предельной — нет.
 */

describe('buildSwarmRoster — состав роя по одной цели', () => {
  it('size по умолчанию (4): researcher + 2 executor-варианта + critic', () => {
    const roster = buildSwarmRoster(4)
    expect(roster).toHaveLength(4)
    expect(roster[0].role).toBe('researcher')          // разведчик
    expect(roster[roster.length - 1].role).toBe('critic') // критик последний
    const executors = roster.filter(m => m.role === 'executor')
    expect(executors.length).toBe(2)
  })

  it('executor-варианты атакуют цель с РАЗНЫХ углов (разнообразие попыток)', () => {
    const roster = buildSwarmRoster(5)
    const executors = roster.filter(m => m.role === 'executor')
    const angles = new Set(executors.map(m => m.angle))
    expect(angles.size).toBe(executors.length) // все углы уникальны
  })

  it('зажимает size в [2..8]', () => {
    expect(buildSwarmRoster(1).length).toBe(2)
    expect(buildSwarmRoster(99).length).toBe(8)
    expect(buildSwarmRoster(0).length).toBe(4)  // 0 → дефолт 4
  })

  it('всегда есть researcher (разведка) и critic (оценка) — основа консенсуса', () => {
    for (const size of [2, 3, 4, 6, 8]) {
      const roster = buildSwarmRoster(size)
      expect(roster.some(m => m.role === 'researcher')).toBe(true)
      expect(roster.some(m => m.role === 'critic')).toBe(true)
    }
  })
})

describe('арбитр роя — read-only роль critic (не правит код при синтезе)', () => {
  it('critic-набор не содержит write/command-tools', () => {
    const toolset = getRoleToolset('critic', { depth: 1 })
    for (const t of ['write_file', 'apply_patch', 'run_command']) {
      expect(toolset).not.toContain(t)
    }
  })
})

describe('depth-аспект делегирования (Идея 3) в whitelist', () => {
  it('executor на глубине < MAX получает delegate_* (может строить поддерево)', () => {
    const toolset = getRoleToolset('executor', { depth: MAX_DELEGATION_DEPTH - 1 })
    expect(toolset).toContain('delegate_task')
    expect(toolset).toContain('delegate_parallel')
  })

  it('executor на предельной глубине НЕ получает delegate_* (листовой узел)', () => {
    const toolset = getRoleToolset('executor', { depth: MAX_DELEGATION_DEPTH })
    expect(toolset).not.toContain('delegate_task')
    expect(toolset).not.toContain('delegate_parallel')
  })

  it('critic/verifier — листовые: delegate_* недоступен даже на малой глубине', () => {
    for (const role of ['critic', 'verifier']) {
      const toolset = getRoleToolset(role, { depth: 0 })
      expect(toolset).not.toContain('delegate_task')
      expect(toolset).not.toContain('delegate_parallel')
    }
  })

  it('orchestrate / swarm НЕ попадают субу ни на какой глубине (только главный агент)', () => {
    for (const role of ['executor', 'researcher', 'planner', 'critic', 'verifier']) {
      for (const depth of [0, 1, MAX_DELEGATION_DEPTH]) {
        const toolset = getRoleToolset(role, { depth })
        expect(toolset).not.toContain('orchestrate')
        expect(toolset).not.toContain('swarm')
      }
    }
  })
})
