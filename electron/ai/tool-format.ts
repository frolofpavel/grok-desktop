/**
 * Хелперы для конвертации Verstak ToolDefinition в форматы разных провайдеров.
 */

import type { ToolDefinition } from './types'

/**
 * Конвертирует ToolDefinition[] в формат OpenAI / GigaChat.
 */
export function toOpenAiTools(tools: ToolDefinition[]): unknown[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}

/**
 * Конвертирует ToolDefinition[] в формат YandexGPT.
 */
export function toYandexTools(tools: ToolDefinition[]): unknown[] {
  return tools.map(t => ({
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}
