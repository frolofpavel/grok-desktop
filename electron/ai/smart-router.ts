/**
 * Smart Model Router — оценивает сложность задачи и рекомендует модель.
 *
 * При effortLevel='standard' и отсутствии явного выбора модели пользователем
 * маршрутизатор выбирает дешёвую модель для простых запросов и мощную для
 * сложных. Это снижает стоимость при сохранении качества.
 */

import type { ChatMessage } from './types'
import { PROVIDERS, type ProviderId } from './registry'

export type TaskComplexity = 'simple' | 'moderate' | 'complex'

/**
 * Оценивает сложность задачи по последнему сообщению пользователя
 * и истории вызовов инструментов.
 */
export function estimateComplexity(messages: ChatMessage[], toolHistory: string[]): TaskComplexity {
  const lastUser = messages.filter(m => m.role === 'user').pop()
  if (!lastUser) return 'simple'

  const text = lastUser.content.toLowerCase()
  const len = text.length

  // Простые: короткие вопросы без сигналов сложной работы
  if (
    len < 100 &&
    !text.includes('refactor') &&
    !text.includes('fix') &&
    !text.includes('implement') &&
    !text.includes('create') &&
    !text.includes('build')
  ) return 'simple'

  // Сложные: длинные промпты или несколько сигналов сложной работы
  const complexSignals = [
    'refactor', 'architect', 'redesign', 'migrate', 'rewrite',
    'implement', 'build', 'create', 'test', 'debug', 'optimize'
  ]
  const complexCount = complexSignals.filter(s => text.includes(s)).length

  if (complexCount >= 2 || len > 500 || toolHistory.length > 5) return 'complex'

  return 'moderate'
}

/**
 * Рекомендует модель для данного провайдера и уровня сложности.
 * Возвращает null если провайдер не покрыт маппингом.
 */
export function recommendModel(providerId: string, complexity: TaskComplexity): string | null {
  const MAP: Record<string, Record<TaskComplexity, string>> = {
    'gemini-api': {
      simple: 'gemini-3-flash',
      moderate: 'gemini-3.5-flash',
      complex: 'gemini-3-pro',
    },
    'claude': {
      simple: 'claude-haiku-4-5',
      moderate: 'claude-sonnet-4-6',
      complex: 'claude-opus-4-5',
    },
    'openai': {
      simple: 'gpt-4o-mini',
      moderate: 'gpt-4o',
      complex: 'o1',
    },
    'grok': {
      simple: 'grok-4-fast',
      moderate: 'grok-4-fast',
      complex: 'grok-4',
    },
  }

  const model = MAP[providerId]?.[complexity] ?? null
  if (!model) return null

  // Safety validation: verify model exists in provider registry
  const descriptor = PROVIDERS[providerId as ProviderId]
  if (descriptor && !descriptor.models.includes(model)) {
    return descriptor.defaultModel
  }

  return model
}

/** Человекочитаемая метка для info-события. */
export function complexityLabel(complexity: TaskComplexity): string {
  switch (complexity) {
    case 'simple': return 'Simple task'
    case 'moderate': return 'Moderate task'
    case 'complex': return 'Complex task'
  }
}
