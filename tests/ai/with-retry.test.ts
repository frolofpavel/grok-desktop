import { describe, it, expect, vi } from 'vitest'
import { isRetriableError, withInitialRetry } from '../../electron/ai/with-retry'

describe('isRetriableError', () => {
  it('429 → retriable', () => {
    expect(isRetriableError({ status: 429 })).toBe(true)
    expect(isRetriableError({ statusCode: 429 })).toBe(true)
  })

  it('5xx → retriable (только список: 500/502/503/504/522/524)', () => {
    expect(isRetriableError({ status: 500 })).toBe(true)
    expect(isRetriableError({ status: 503 })).toBe(true)
    expect(isRetriableError({ status: 504 })).toBe(true)
    expect(isRetriableError({ status: 522 })).toBe(true)
  })

  it('4xx (не 429) → NOT retriable', () => {
    expect(isRetriableError({ status: 400 })).toBe(false)
    expect(isRetriableError({ status: 401 })).toBe(false)
    expect(isRetriableError({ status: 403 })).toBe(false)
    expect(isRetriableError({ status: 404 })).toBe(false)
  })

  it('node net codes → retriable', () => {
    expect(isRetriableError({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetriableError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isRetriableError({ code: 'ENOTFOUND' })).toBe(true)
  })

  it('wrapped in cause (undici fetch) → retriable', () => {
    expect(isRetriableError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } })).toBe(true)
  })

  it('textual fallback (RU/EN substrings)', () => {
    expect(isRetriableError(new Error('Rate limit exceeded'))).toBe(true)
    expect(isRetriableError(new Error('Service Unavailable'))).toBe(true)
    expect(isRetriableError(new Error('socket hang up'))).toBe(true)
    expect(isRetriableError(new Error('overloaded_error'))).toBe(true)
  })

  it('обычная application-ошибка → NOT retriable', () => {
    expect(isRetriableError(new Error('Invalid argument'))).toBe(false)
    expect(isRetriableError({ status: 422, message: 'validation' })).toBe(false)
  })

  it('null / undefined / strings → NOT retriable', () => {
    expect(isRetriableError(null)).toBe(false)
    expect(isRetriableError(undefined)).toBe(false)
    expect(isRetriableError('boom')).toBe(false)
  })
})

describe('withInitialRetry', () => {
  it('успех с первой попытки — никакого retry', async () => {
    const factory = vi.fn(async function* () {
      yield 'a'
      yield 'b'
    })
    const out: string[] = []
    for await (const v of withInitialRetry(factory)) out.push(v)
    expect(out).toEqual(['a', 'b'])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('retry при retriable error до первого yield', async () => {
    let attempt = 0
    const factory = vi.fn(async function* () {
      attempt++
      if (attempt < 3) {
        const err: Error & { status?: number } = new Error('rate limit')
        err.status = 429
        throw err
      }
      yield 'finally'
    })
    const out: string[] = []
    for await (const v of withInitialRetry(factory, { maxAttempts: 4 })) out.push(v)
    expect(out).toEqual(['finally'])
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('НЕ retry если ошибка ПОСЛЕ первого yield (стрим уже стартовал)', async () => {
    const factory = vi.fn(async function* () {
      yield 'first'
      const err: Error & { status?: number } = new Error('rate limit')
      err.status = 429
      throw err
    })
    const out: string[] = []
    let caught: unknown = null
    try {
      for await (const v of withInitialRetry(factory)) out.push(v)
    } catch (e) {
      caught = e
    }
    expect(out).toEqual(['first'])
    expect((caught as Error).message).toBe('rate limit')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('НЕ retry если ошибка non-retriable', async () => {
    const factory = vi.fn(async function* () {
      const err: Error & { status?: number } = new Error('bad request')
      err.status = 400
      throw err
      yield 'unreachable'
    })
    let caught: unknown = null
    try {
      for await (const _ of withInitialRetry(factory)) { /* */ }
    } catch (e) { caught = e }
    expect((caught as Error).message).toBe('bad request')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('исчерпывает попытки если все падают, выбрасывает последнюю ошибку', async () => {
    const factory = vi.fn(async function* () {
      const err: Error & { status?: number } = new Error('503')
      err.status = 503
      throw err
      yield 'never'
    })
    let caught: unknown = null
    try {
      for await (const _ of withInitialRetry(factory, { maxAttempts: 3 })) { /* */ }
    } catch (e) { caught = e }
    expect((caught as Error).message).toBe('503')
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('вызывает onRetry callback на каждую попытку', async () => {
    let attempt = 0
    const factory = vi.fn(async function* () {
      attempt++
      if (attempt < 2) {
        const err: Error & { status?: number } = new Error('rate')
        err.status = 429
        throw err
      }
      yield 'ok'
    })
    const retries: Array<{ attempt: number }> = []
    for await (const _ of withInitialRetry(factory, {
      onRetry: info => retries.push({ attempt: info.attempt })
    })) { /* */ }
    expect(retries).toHaveLength(1)
    expect(retries[0].attempt).toBe(0)
  })
})
