/**
 * Глобальная очередь суб-задач (Фаза 2, Идея 6).
 *
 * Проблема: несколько delegate_parallel / десятки субов могут одновременно
 * лупить провайдеры (особенно один rate-limited xAI ключ) и захламлять UI.
 * Раньше concurrency был локальным на ОДИН delegate_parallel (CONCURRENCY=4).
 * Теперь — единый семафор на весь процесс: сколько бы батчей ни запустилось,
 * одновременно стримит не более GLOBAL_SUB_CONCURRENCY субов, остальные ждут
 * в очереди. Можно держать 20–50 задач в очереди, выполняя N разом.
 *
 * Плюс: группы (tag) для массовой отмены и cost-cap на весь батч.
 *
 * Модуль не зависит от Electron/БД — чистая логика, тестируемая в vitest.
 */

// Сколько суб-стримов выполняется одновременно на весь процесс. Держит провайдер
// живым при 20–50 задачах в очереди. Можно поднять под мощный аккаунт.
export const GLOBAL_SUB_CONCURRENCY = 6

/** Дескриптор активной/ожидающей суб-задачи в реестре отмены. */
interface QueuedEntry {
  /** Группа/тег батча — для массовой отмены «по тегу». */
  group: string | null
  /** Роль суба — для отмены «по роли». */
  role: string | null
  /** Прерыватель этой конкретной задачи. */
  abort: () => void
}

/** Простой асинхронный семафор с FIFO-очередью ожидающих. */
class Semaphore {
  private active = 0
  private waiters: Array<() => void> = []
  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('aborted')
    if (this.active < this.limit) {
      this.active++
      return
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(release)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error('aborted'))
      }
      const release = () => {
        signal?.removeEventListener('abort', onAbort)
        this.active++
        resolve()
      }
      this.waiters.push(release)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  release(): void {
    this.active--
    const next = this.waiters.shift()
    if (next) next()
  }

  get inFlight(): number { return this.active }
  get queued(): number { return this.waiters.length }
}

/**
 * Реестр суб-задач процесса: глобальный семафор + карта активных задач для
 * массовой отмены. Один на процесс (см. экспортируемый singleton ниже).
 */
export class SubAgentQueue {
  private readonly sem = new Semaphore(GLOBAL_SUB_CONCURRENCY)
  private readonly entries = new Map<number, QueuedEntry>()
  private seq = 0

  /**
   * Зарегистрировать задачу и дождаться слота в глобальном семафоре. Возвращает
   * release() (вызвать в finally) + ticketId для индивидуальной отмены.
   * Бросает 'aborted' если signal сработал в очереди.
   */
  async enter(opts: { group: string | null; role: string | null; abort: () => void }, signal?: AbortSignal): Promise<{ release: () => void; ticketId: number }> {
    const ticketId = ++this.seq
    this.entries.set(ticketId, { group: opts.group, role: opts.role, abort: opts.abort })
    try {
      await this.sem.acquire(signal)
    } catch (err) {
      this.entries.delete(ticketId)
      throw err
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.entries.delete(ticketId)
      this.sem.release()
    }
    return { release, ticketId }
  }

  /** Снять задачу из реестра без освобождения слота (на случай отмены до входа). */
  forget(ticketId: number): void {
    this.entries.delete(ticketId)
  }

  /**
   * Массовая отмена. Фильтр: all — все; по group; по role. Возвращает сколько
   * задач прервано. Сами задачи завершатся через свои AbortController'ы.
   */
  cancel(filter: { all?: boolean; group?: string | null; role?: string | null }): number {
    let count = 0
    for (const entry of this.entries.values()) {
      const match = filter.all
        || (filter.group != null && entry.group === filter.group)
        || (filter.role != null && entry.role === filter.role)
      if (match) {
        try { entry.abort() } catch { /* abort не должен ронять цикл */ }
        count++
      }
    }
    return count
  }

  /** Текущее состояние очереди — для диагностики/панели. */
  stats(): { inFlight: number; queued: number; tracked: number } {
    return { inFlight: this.sem.inFlight, queued: this.sem.queued, tracked: this.entries.size }
  }
}

/** Singleton очереди на весь main-процесс. */
export const subAgentQueue = new SubAgentQueue()
