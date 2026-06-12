/**
 * Hard cost cap для агентских сессий. Если cumulative cost превышает лимит
 * settings.cost_cap_usd_per_session — emit error + abort.
 *
 * Зачем: длинный агент-цикл может пожечь $20-50 если уходит в спираль.
 * Cost controller (UI pill) показывает только постфактум. Этот guard
 * останавливает ДО того как улетит много денег.
 *
 * Источник: V3 Plan раздел 11 «Cost discipline».
 */

import type { ProviderId } from './registry'

interface ModelPrice {
  input: number
  output: number
  cached?: number
}

// Цены в $ per 1M tokens. Должны быть синхронизированы с src/lib/pricing.ts.
// Дубликат сознательный — renderer и main не имеют shared modules.
const PRICES: Record<string, ModelPrice> = {
  'grok-4':                { input: 5.0,  output: 15.0 },
  'grok-4-fast':           { input: 0.20, output: 0.50 },
  'grok-3':                { input: 3.0,  output: 15.0 }
}

const CLI_FREE: Set<ProviderId> = new Set(['grok-cli'])

export interface CostGuard {
  /** Накопить usage и проверить cap. Возвращает true если превышено → abort. */
  recordAndCheck(providerId: ProviderId, model: string, input: number, output: number, cached: number): {
    exceeded: boolean
    cents: number
    capCents: number | null
    message?: string
  }
  /** Текущая накопленная стоимость в центах. */
  current(): number
}

/**
 * @param capUsd максимум $ за сессию. Null/0 = guard disabled (поведение прежнее).
 */
export function createCostGuard(capUsd: number | null): CostGuard {
  const capCents = capUsd && capUsd > 0 ? Math.round(capUsd * 100) : null
  let cumulative = 0

  return {
    recordAndCheck(providerId, model, input, output, cached) {
      if (CLI_FREE.has(providerId)) {
        // CLI = подписка, $0
        return { exceeded: false, cents: cumulative, capCents }
      }
      const price = PRICES[model]
      if (!price) {
        // Неизвестная модель — не считаем, не блокируем
        return { exceeded: false, cents: cumulative, capCents }
      }
      const billableInput = Math.max(0, input - cached)
      const inputCost = (billableInput / 1_000_000) * price.input
      const cachedCost = price.cached ? (cached / 1_000_000) * price.cached : 0
      const outputCost = (output / 1_000_000) * price.output
      const total = inputCost + cachedCost + outputCost
      cumulative += Math.round(total * 100)

      if (capCents != null && cumulative >= capCents) {
        return {
          exceeded: true,
          cents: cumulative,
          capCents,
          message: `Сессия израсходовала $${(cumulative / 100).toFixed(2)} (лимит $${(capCents / 100).toFixed(2)}). ` +
                   `Остановлена hard cost cap'ом из Settings. Подними лимит или начни новую сессию.`
        }
      }
      return { exceeded: false, cents: cumulative, capCents }
    },
    current() {
      return cumulative
    }
  }
}
