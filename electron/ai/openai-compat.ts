import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import type { ChatProvider, ChatMessage, ChatEvent, ToolDefinition, ToolResult } from './types'

export interface OpenAiCompatOptions {
  id: string
  name: string
  models: string[]
  defaultModel: string
  apiKey: string
  baseUrl?: string
  model?: string
  effortLevel?: 'quick' | 'standard' | 'deep'
}

interface OpenAiContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

function buildUserContent(message: ChatMessage): string | OpenAiContentPart[] {
  if (!message.attachments?.length) return message.content
  const parts: OpenAiContentPart[] = []
  if (message.content) parts.push({ type: 'text', text: message.content })
  for (const att of message.attachments) {
    if (att.mimeType.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.data}` } })
    }
  }
  return parts.length > 0 ? parts : ''
}

/**
 * Convert our ChatMessage list to OpenAI Chat Completions message list.
 * - Assistant messages with toolCalls become assistant role + tool_calls field.
 * - User messages with toolResults become a *sequence* of `role: 'tool'` messages.
 *   The original user content (if any) becomes a regular user message before them.
 */
function buildOpenAiMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) out.push({ role: 'system', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const entry: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || ''
      }
      if (m.toolCalls?.length) {
        entry.tool_calls = m.toolCalls.map(c => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) }
        }))
      }
      out.push(entry)
      continue
    }
    // role === 'user'
    if (m.toolResults?.length) {
      // Tool results travel as their own role:'tool' entries, one per result.
      // Any actual user text in the same logical turn is emitted FIRST as user.
      if (m.content) out.push({ role: 'user', content: buildUserContent(m) as never })
      for (const r of m.toolResults) {
        const content = r.error
          ? `Error: ${r.error}\n${typeof r.result === 'string' ? r.result : JSON.stringify(r.result).slice(0, 5000)}`
          : (typeof r.result === 'string' ? r.result : JSON.stringify(r.result).slice(0, 5000))
        out.push({ role: 'tool', tool_call_id: r.id, content })
      }
    } else {
      out.push({ role: 'user', content: buildUserContent(m) as never })
    }
  }
  return out
}

export function createOpenAiCompatProvider(opts: OpenAiCompatOptions): ChatProvider {
  const model = opts.model ?? opts.defaultModel
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl })
  const effortLevel = opts.effortLevel ?? 'standard'

  return {
    id: opts.id,
    name: opts.name,
    models: opts.models,

    async *send(messages: ChatMessage[], tools: ToolDefinition[], _results?: ToolResult[]): AsyncIterable<ChatEvent> {
      const apiMessages = buildOpenAiMessages(messages)
      const apiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools.length > 0
        ? tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters as Record<string, unknown>
            }
          }))
        : undefined

      // Accumulators for streaming tool calls (OpenAI sends incremental delta.tool_calls)
      const inProgress: Record<number, { id: string; name: string; args: string }> = {}

      const maxTokens = effortLevel === 'quick' ? 2048 : effortLevel === 'deep' ? 16384 : 4096

      try {
        const stream = await client.chat.completions.create({
          model,
          messages: apiMessages,
          stream: true,
          max_tokens: maxTokens,
          stream_options: { include_usage: true },
          ...(apiTools ? { tools: apiTools } : {})
        })

        let usageSent = false
        for await (const chunk of stream) {
          // Final chunk may carry only usage (no choices)
          if ((chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage && !usageSent) {
            const u = (chunk as { usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage
            usageSent = true
            yield {
              type: 'usage',
              usage: {
                inputTokens: u.prompt_tokens,
                outputTokens: u.completion_tokens,
                cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
                model
              }
            }
          }
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { type: 'text', text: delta.content }
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!inProgress[idx]) {
                inProgress[idx] = { id: tc.id ?? randomUUID(), name: tc.function?.name ?? '', args: '' }
              }
              if (tc.id) inProgress[idx].id = tc.id
              if (tc.function?.name) inProgress[idx].name = tc.function.name
              if (tc.function?.arguments) inProgress[idx].args += tc.function.arguments
            }
          }
          const finish = chunk.choices?.[0]?.finish_reason
          if (finish === 'tool_calls') {
            for (const k of Object.keys(inProgress)) {
              const t = inProgress[Number(k)]
              let args: Record<string, unknown> = {}
              try { args = t.args ? JSON.parse(t.args) : {} } catch { args = {} }
              yield { type: 'tool-call', call: { id: t.id, name: t.name, args } }
            }
            // Clear so next turn starts fresh if reused
            for (const k of Object.keys(inProgress)) delete inProgress[Number(k)]
          }
        }
        yield { type: 'done' }
      } catch (err) {
        yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
