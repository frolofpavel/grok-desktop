import { describe, it, expect } from 'vitest'
import { SubAgentQueue } from '../../electron/ai/sub-queue'

/**
 * Тесты глобальной очереди суб-задач (Фаза 2, Идея 6): семафор ограничивает
 * одновременность, очередь освобождается по release, массовая отмена дёргает
 * abort у нужных задач.
 */

describe('SubAgentQueue', () => {
  it('пропускает не более лимита одновременно, остальные ждут', async () => {
    // Свой инстанс с лимитом 2 через подмену константы невозможно (она в файле),
    // поэтому тестируем поведение реальной очереди: enter сразу для первых N,
    // последующие — после release. Проверяем через stats.
    const q = new SubAgentQueue()
    const slots: Array<{ release: () => void }> = []
    // Заходим столько раз, сколько лимит (6) — все должны пройти сразу.
    for (let i = 0; i < 6; i++) {
      slots.push(await q.enter({ group: null, role: null, abort: () => {} }))
    }
    expect(q.stats().inFlight).toBe(6)
    expect(q.stats().queued).toBe(0)

    // 7-я заявка должна встать в очередь (не зарезолвиться пока нет release).
    let seventhEntered = false
    const seventh = q.enter({ group: null, role: null, abort: () => {} }).then(s => { seventhEntered = true; return s })
    await Promise.resolve()
    expect(seventhEntered).toBe(false)
    expect(q.stats().queued).toBe(1)

    // Освобождаем один слот → 7-я входит.
    slots[0].release()
    const s7 = await seventh
    expect(seventhEntered).toBe(true)
    expect(q.stats().inFlight).toBe(6)

    // Чистим.
    s7.release()
    for (let i = 1; i < 6; i++) slots[i].release()
    expect(q.stats().inFlight).toBe(0)
  })

  it('cancel({all}) дёргает abort у всех активных и считает их', async () => {
    const q = new SubAgentQueue()
    let aborted = 0
    const slots = []
    for (let i = 0; i < 3; i++) {
      slots.push(await q.enter({ group: 'g1', role: 'researcher', abort: () => { aborted++ } }))
    }
    const cancelled = q.cancel({ all: true })
    expect(cancelled).toBe(3)
    expect(aborted).toBe(3)
    for (const s of slots) s.release()
  })

  it('cancel по group отменяет только нужную группу', async () => {
    const q = new SubAgentQueue()
    const abortedGroups: string[] = []
    const a = await q.enter({ group: 'batch-A', role: null, abort: () => abortedGroups.push('A') })
    const b = await q.enter({ group: 'batch-B', role: null, abort: () => abortedGroups.push('B') })
    const count = q.cancel({ group: 'batch-A' })
    expect(count).toBe(1)
    expect(abortedGroups).toEqual(['A'])
    a.release(); b.release()
  })

  it('cancel по role отменяет задачи только этой роли', async () => {
    const q = new SubAgentQueue()
    let exec = 0, critic = 0
    const a = await q.enter({ group: null, role: 'executor', abort: () => exec++ })
    const b = await q.enter({ group: null, role: 'critic', abort: () => critic++ })
    const count = q.cancel({ role: 'executor' })
    expect(count).toBe(1)
    expect(exec).toBe(1)
    expect(critic).toBe(0)
    a.release(); b.release()
  })

  it('release освобождает слот и снимает задачу из реестра', async () => {
    const q = new SubAgentQueue()
    const slot = await q.enter({ group: null, role: null, abort: () => {} })
    expect(q.stats().tracked).toBe(1)
    slot.release()
    expect(q.stats().tracked).toBe(0)
    // double-release безопасен
    slot.release()
    expect(q.stats().inFlight).toBe(0)
  })
})
