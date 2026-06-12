import { describe, it, expect, vi } from 'vitest'
import { createGeminiProvider } from '../../electron/ai/gemini'

describe('GeminiProvider', () => {
  it('exposes id and models', () => {
    const provider = createGeminiProvider({ apiKey: 'test', model: 'gemini-2.5-pro' })
    expect(provider.id).toBe('gemini')
    expect(provider.models).toContain('gemini-2.5-pro')
  })

  it('streams text from mocked SDK', async () => {
    const fakeStream = (async function*() {
      yield { text: 'Hello ' }
      yield { text: 'world' }
    })()
    const sdk = {
      models: {
        generateContentStream: vi.fn().mockResolvedValue(fakeStream)
      }
    }
    const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-2.5-pro', sdk: sdk as never })
    const events: string[] = []
    for await (const ev of provider.send([{ role: 'user', content: 'hi' }], [])) {
      if (ev.type === 'text') events.push(ev.text)
      if (ev.type === 'done') break
    }
    expect(events.join('')).toBe('Hello world')
  })
})
