import { describe, it, expect } from 'vitest'
import { compactToolHistory, diffSize } from '../../electron/ai/compact-history'
import type { ChatMessage } from '../../electron/ai/types'

function bigResult(name: string, size: number): ChatMessage {
  return {
    role: 'user',
    content: '',
    toolResults: [{ id: name + '-id', name, result: 'X'.repeat(size) }]
  }
}

describe('compactToolHistory', () => {
  it('не трогает свежие turns в окне (currentTurn <= KEEP_RECENT_TURNS)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'response' },
      bigResult('read_file', 5000)
    ]
    const out = compactToolHistory(msgs, 0)
    // currentTurn=0, cutoff < 0 → ничего не сжимается, только cap-проверка
    expect(out[2].toolResults![0].result).toBe('X'.repeat(5000))
  })

  it('сжимает старые tool results при currentTurn > KEEP_RECENT_TURNS', () => {
    // 6 turns с большими результатами
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 6; i++) {
      msgs.push({ role: 'assistant', content: `turn ${i}` })
      msgs.push(bigResult('read_file', 5000))
    }
    // currentTurn=6, KEEP_RECENT=3 → cutoff=3, turns 0,1,2,3 сжимаются (4 шт),
    // turns 4,5 остаются (2 шт)
    const out = compactToolHistory(msgs, 6)
    const toolMsgs = out.filter(m => m.toolResults && m.toolResults.length > 0)
    expect(toolMsgs).toHaveLength(6)
    // Старые сжаты: содержат [compacted: ...]
    expect(toolMsgs[0].toolResults![0].result).toMatch(/\[compacted:/)
    expect(toolMsgs[3].toolResults![0].result).toMatch(/\[compacted:/)
    // Свежие нет
    expect(toolMsgs[4].toolResults![0].result).toBe('X'.repeat(5000))
    expect(toolMsgs[5].toolResults![0].result).toBe('X'.repeat(5000))
  })

  it('не сжимает мелкие старые результаты (< 400 chars) — мало пользы', () => {
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: 'assistant', content: `turn ${i}` })
      msgs.push(bigResult('list_directory', 200))
    }
    const out = compactToolHistory(msgs, 5)
    const toolMsgs = out.filter(m => m.toolResults && m.toolResults.length > 0)
    // Все мелкие → ни один не сжат
    for (const tm of toolMsgs) {
      expect(tm.toolResults![0].result).toBe('X'.repeat(200))
    }
  })

  it('сильно жирные СВЕЖИЕ результаты обрезаются tail-strategy (cap 12000)', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: 'r' },
      bigResult('read_file', 50_000)
    ]
    const out = compactToolHistory(msgs, 0)
    const r = out[1].toolResults![0].result as string
    expect(r.length).toBeLessThan(50_000)
    expect(r.length).toBeLessThanOrEqual(12_000)
    expect(r).toMatch(/omitted|вырезано/)
  })

  it('не модифицирует оригинальный массив', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: 'a' },
      bigResult('read_file', 5000),
      { role: 'assistant', content: 'b' },
      bigResult('read_file', 5000),
      { role: 'assistant', content: 'c' },
      bigResult('read_file', 5000),
      { role: 'assistant', content: 'd' },
      bigResult('read_file', 5000)
    ]
    const before = JSON.stringify(msgs)
    compactToolHistory(msgs, 5)
    const after = JSON.stringify(msgs)
    expect(after).toBe(before)
  })

  it('diffSize показывает реальное сокращение', () => {
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 6; i++) {
      msgs.push({ role: 'assistant', content: `turn ${i}` })
      msgs.push(bigResult('read_file', 8000))
    }
    const out = compactToolHistory(msgs, 6)
    const stats = diffSize(msgs, out)
    expect(stats.savedChars).toBeGreaterThan(20_000)
    expect(stats.pct).toBeGreaterThan(30)
  })
})
