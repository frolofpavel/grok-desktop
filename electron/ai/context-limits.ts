/**
 * Максимальные контекстные окна для каждой модели.
 * Используется авто-компакшном (auto-compact) для определения момента сжатия.
 *
 * Принцип: если нет точного совпадения — используем консервативный дефолт 128k.
 * Это безопасно: лучше сжать чуть раньше, чем словить ошибку провайдера.
 */

export const CONTEXT_LIMITS: Record<string, number> = {
  // Grok (xAI)
  'grok-4': 131_072,
  'grok-4-fast': 131_072,
  'grok-3': 131_072,
}

/** ~4 симв. на токен — грубая оценка без токенизатора. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Возвращает лимит контекста для модели (с консервативным дефолтом). */
export function getContextLimit(model: string): number {
  return CONTEXT_LIMITS[model] ?? 128_000
}

/** Порог авто-компакшна — 95% контекстного окна. */
export const COMPACT_THRESHOLD = 0.95
