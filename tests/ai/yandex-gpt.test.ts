import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildModelUri,
  buildYandexMessages,
  createYandexGptProvider,
  YANDEX_GPT_MODELS
} from '../../electron/ai/yandex-gpt'
import type { ChatMessage, ChatEvent } from '../../electron/ai/types'

describe('yandex-gpt — pure helpers', () => {
  it('buildModelUri составляет gpt://folder/model', () => {
    expect(buildModelUri('b1g123abc', 'yandexgpt/latest')).toBe('gpt://b1g123abc/yandexgpt/latest')
    expect(buildModelUri('myfolder', 'yandexgpt-lite/latest')).toBe('gpt://myfolder/yandexgpt-lite/latest')
  })

  it('buildYandexMessages: system-сообщения объединяются, остальные сохраняют порядок', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'Rule 1' },
      { role: 'user',   content: 'Привет' },
      { role: 'system', content: 'Rule 2' },
      { role: 'assistant', content: 'Здравствуй' },
      { role: 'user',   content: 'Как дела?' }
    ]
    const result = buildYandexMessages(msgs)
    expect(result).toEqual([
      { role: 'system',    text: 'Rule 1\n\nRule 2' },
      { role: 'user',      text: 'Привет' },
      { role: 'assistant', text: 'Здравствуй' },
      { role: 'user',      text: 'Как дела?' }
    ])
  })

  it('buildYandexMessages: пустой content становится пустой строкой', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: '' }
    ]
    expect(buildYandexMessages(msgs)).toEqual([{ role: 'user', text: '' }])
  })

  it('YANDEX_GPT_MODELS содержит все ожидаемые модели', () => {
    expect(YANDEX_GPT_MODELS).toContain('yandexgpt/latest')
    expect(YANDEX_GPT_MODELS).toContain('yandexgpt-lite/latest')
    expect(YANDEX_GPT_MODELS).toContain('yandexgpt-32k/latest')
  })
})

describe('yandex-gpt — createYandexGptProvider validation', () => {
  it('пустой folderId → бросает ошибку ДО fetch', () => {
    expect(() => createYandexGptProvider({ apiKey: 'k', folderId: '' }))
      .toThrow(/Folder ID не задан/)
  })

  it('пустой apiKey → бросает ошибку', () => {
    expect(() => createYandexGptProvider({ apiKey: '', folderId: 'b1g123' }))
      .toThrow(/API ключ не задан/)
  })

  it('пробельный folderId → бросает ошибку', () => {
    expect(() => createYandexGptProvider({ apiKey: 'k', folderId: '   ' }))
      .toThrow(/Folder ID не задан/)
  })
})

describe('yandex-gpt — streaming send()', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  /**
   * Helper: создаёт mock-fetch response с заданными NDJSON-строками.
   * Имитирует ReadableStream поведение body.
   */
  function mockNdjsonResponse(lines: object[]): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const obj of lines) {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        }
        controller.close()
      }
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
  }

  async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
    const out: ChatEvent[] = []
    for await (const ev of events) out.push(ev)
    return out
  }

  it('Yandex возвращает накопленный текст → дельта вычисляется правильно', async () => {
    // Yandex: каждый chunk содержит ПОЛНЫЙ текст накопленный к этому моменту.
    // Парсер должен вычитать prevText чтобы получить дельту.
    fetchSpy.mockResolvedValue(mockNdjsonResponse([
      { result: { alternatives: [{ message: { text: 'Привет' } }] } },
      { result: { alternatives: [{ message: { text: 'Привет, как' } }] } },
      { result: { alternatives: [{ message: { text: 'Привет, как дела?' } }] } },
      { result: { alternatives: [{ message: { text: 'Привет, как дела?' } }], usage: {
        inputTextTokens: '15', completionTokens: '8', totalTokens: '23'
      } } }
    ]))

    const provider = createYandexGptProvider({ apiKey: 'k', folderId: 'b1g' })
    const events = await collect(provider.send([{ role: 'user', content: 'Привет' }], []))
    const textEvents = events.filter((e): e is { type: 'text'; text: string } => e.type === 'text')
    expect(textEvents.map(e => e.text)).toEqual(['Привет', ', как', ' дела?'])
    const usage = events.find((e): e is { type: 'usage'; usage: { inputTokens: number; outputTokens: number; model?: string } } => e.type === 'usage')
    expect(usage?.usage.inputTokens).toBe(15)
    expect(usage?.usage.outputTokens).toBe(8)
    // done всегда последним
    expect(events[events.length - 1].type).toBe('done')
  })

  it('modelUri в request body содержит folderId и model', async () => {
    fetchSpy.mockResolvedValue(mockNdjsonResponse([]))
    const provider = createYandexGptProvider({ apiKey: 'k', folderId: 'b1g999', model: 'yandexgpt-lite/latest' })
    await collect(provider.send([{ role: 'user', content: 'test' }], []))

    const [_url, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse((init?.body as string) ?? '{}')
    expect(body.modelUri).toBe('gpt://b1g999/yandexgpt-lite/latest')
    // maxTokens должен быть СТРОКОЙ (особенность API)
    expect(body.completionOptions.maxTokens).toBe('8000')
    expect(typeof body.completionOptions.maxTokens).toBe('string')
  })

  it('tools.length > 0 — tools передаются в формате YandexGPT', async () => {
    fetchSpy.mockResolvedValue(mockNdjsonResponse([]))
    const provider = createYandexGptProvider({ apiKey: 'k', folderId: 'b1g' })
    await collect(provider.send(
      [{ role: 'user', content: 'test' }],
      [{ name: 'read_file', description: 'read', parameters: {} }]
    ))
    const body = JSON.parse((fetchSpy.mock.calls[0][1]?.body as string) ?? '{}')
    // После добавления function calling tools передаются в формате YandexGPT
    expect(body.tools).toBeDefined()
    expect(body.tools[0]).toHaveProperty('function')
    expect(body.tools[0].function.name).toBe('read_file')
  })

  it('HTTP 401 → понятная ошибка', async () => {
    fetchSpy.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const provider = createYandexGptProvider({ apiKey: 'bad', folderId: 'b1g' })
    const events = await collect(provider.send([{ role: 'user', content: 't' }], []))
    const err = events.find((e): e is { type: 'error'; message: string } => e.type === 'error')
    expect(err?.message).toMatch(/HTTP 401/)
  })

  it('Authorization header = Api-Key + ключ', async () => {
    fetchSpy.mockResolvedValue(mockNdjsonResponse([]))
    const provider = createYandexGptProvider({ apiKey: 'AQVN-test-key', folderId: 'b1g' })
    await collect(provider.send([{ role: 'user', content: 't' }], []))

    const init = fetchSpy.mock.calls[0][1]
    const headers = init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Api-Key AQVN-test-key')
    expect(headers['x-folder-id']).toBe('b1g')
  })
})
