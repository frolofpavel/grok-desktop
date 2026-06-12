import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanLocalModelServers } from '../../electron/ai/local-models'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body
  } as Response
}

describe('scanLocalModelServers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('находит запущенный Ollama и возвращает модели', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://localhost:11434/api/tags') {
        return jsonResponse({ models: [{ name: 'llama3.3' }, { name: 'qwen2.5-coder' }] })
      }
      throw new Error('connection refused')
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = await scanLocalModelServers()

    expect(servers).toEqual([
      {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        running: true,
        models: ['llama3.3', 'qwen2.5-coder']
      }
    ])
  })

  it('пропускает reject и 500 без исключения', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://localhost:1234/v1/models') {
        return jsonResponse({ data: [{ id: 'local-model' }] })
      }
      if (url === 'http://localhost:8080/v1/models') {
        return jsonResponse({ error: 'boom' }, false)
      }
      throw new Error('connection refused')
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = await scanLocalModelServers()

    expect(servers).toEqual([
      {
        id: 'lmstudio',
        name: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        running: true,
        models: ['local-model']
      }
    ])
  })

  it('пропускает зависшие серверы по AbortController', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = scanLocalModelServers()
    await vi.advanceTimersByTimeAsync(900)

    await expect(pending).resolves.toEqual([])
  })

  it('возвращает пустой массив, если никто не ответил', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(scanLocalModelServers()).resolves.toEqual([])
  })
})
