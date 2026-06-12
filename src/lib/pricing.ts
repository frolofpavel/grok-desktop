/**
 * Best-effort pricing table for cost estimation in the chat header.
 *
 * Prices are USD per million tokens (input / output). Keep this conservative
 * and document where each number came from. CLI providers run on user's
 * subscription so cost is reported as 0.
 *
 * Last updated: 2026-05 (snapshot — adjust as providers publish new pricing).
 */

import type { ProviderId } from '../hooks/useProvider'

interface ModelPrice {
  input: number   // $ per 1M input tokens
  output: number  // $ per 1M output tokens
  cached?: number // $ per 1M cached input tokens (when provider supports caching)
}

const PRICES: Record<string, ModelPrice> = {
  // xAI — x.ai/api
  'grok-4':                      { input: 5.0,  output: 15.0 },
  'grok-4-fast':                 { input: 0.20, output: 0.50 },
  'grok-3':                      { input: 3.0,  output: 15.0 }
}

const CLI_FREE: Set<ProviderId> = new Set(['grok-cli'])

export interface CostEstimate {
  /** Total USD, formatted as a string. null when provider is CLI (covered by subscription). */
  usd: string | null
  /** Approximate cents value for logic checks (0 for CLI). */
  cents: number
}

export function estimateCost(
  providerId: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): CostEstimate {
  if (CLI_FREE.has(providerId)) return { usd: null, cents: 0 }
  const price = PRICES[model]
  if (!price) return { usd: '—', cents: 0 }
  const billableInput = Math.max(0, inputTokens - cachedInputTokens)
  const inputCost = (billableInput / 1_000_000) * price.input
  const cachedCost = price.cached ? (cachedInputTokens / 1_000_000) * price.cached : 0
  const outputCost = (outputTokens / 1_000_000) * price.output
  const total = inputCost + cachedCost + outputCost
  const cents = Math.round(total * 100)
  let usd: string
  if (total < 0.01) usd = '<$0.01'
  else if (total < 1) usd = '$' + total.toFixed(2)
  else if (total < 100) usd = '$' + total.toFixed(2)
  else usd = '$' + total.toFixed(0)
  return { usd, cents }
}

/**
 * Cost severity для цветовой индикации pill: «спокойно / задумайся / стоп».
 * Пороги выбраны под типичную dev-сессию (мелкие правки): 50¢ — норма,
 * $2 — пора смотреть что происходит, $5+ — наверняка цикл / большой rip.
 *
 * Возвращает CSS-class suffix: '' / 'is-warn' / 'is-alert'.
 */
export type CostSeverity = '' | 'is-warn' | 'is-alert'
export function costSeverity(cents: number): CostSeverity {
  if (cents >= 500) return 'is-alert'  // $5+
  if (cents >= 200) return 'is-warn'   // $2+
  return ''
}

/**
 * Детальный breakdown для tooltip: разбивка стоимости на input / cached /
 * output, плюс цена за модель. Возвращает многострочный текст для title.
 */
export function costBreakdown(
  providerId: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): string {
  if (CLI_FREE.has(providerId)) {
    return `Провайдер: ${providerId} (CLI, подписка — стоимость = $0)\nТокены input: ${inputTokens}\nТокены output: ${outputTokens}`
  }
  const price = PRICES[model]
  if (!price) {
    return `Модель ${model}: цены неизвестны\nТокены input: ${inputTokens}\nТокены output: ${outputTokens}`
  }
  const billableInput = Math.max(0, inputTokens - cachedInputTokens)
  const inputCost = (billableInput / 1_000_000) * price.input
  const cachedCost = price.cached ? (cachedInputTokens / 1_000_000) * price.cached : 0
  const outputCost = (outputTokens / 1_000_000) * price.output
  const total = inputCost + cachedCost + outputCost
  const lines = [
    `Модель: ${model}`,
    `Цена: $${price.input}/M input, $${price.output}/M output${price.cached ? `, $${price.cached}/M cached` : ''}`,
    '',
    `↑ input: ${billableInput.toLocaleString()} × $${price.input}/M = $${inputCost.toFixed(4)}`,
    ...(cachedInputTokens > 0 && price.cached
      ? [`⟲ cached: ${cachedInputTokens.toLocaleString()} × $${price.cached}/M = $${cachedCost.toFixed(4)}`]
      : []),
    `↓ output: ${outputTokens.toLocaleString()} × $${price.output}/M = $${outputCost.toFixed(4)}`,
    `─────`,
    `Итого: $${total.toFixed(4)}`
  ]
  return lines.join('\n')
}
