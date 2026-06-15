/**
 * CLI prompt builder — common logic for stuffing system layer + user layer +
 * context pack + history into a single stdin payload for CLI providers.
 *
 * Why this exists (and why we don't share runApiConversation):
 *
 * 1. CLI providers in `stream-json` mode are effectively ONE-SHOT — they don't
 *    support multi-turn back-and-forth over a single stdin session. So we
 *    must serialize the conversation into the prompt itself.
 *
 * 2. grok-cli (Grok Build) doesn't have an aggressive system prompt of its
 *    own; we send the full system layer.
 *
 * 3. Attachments — CLI's `stream-json` mode doesn't accept inline images.
 *    We mention attachment names as a textual hint and let the user know.
 */

import { SYSTEM_LAYER_PROMPT } from './system-layer'
import { prepareParts } from './compose-system'
import type { ChatMessage } from './types'

export type CliProviderId = 'grok-cli'

/**
 * True if the CLI provider reads this user_layer file by itself on startup.
 * grok-cli — no documented convention file, always inject.
 */
function cliReadsLayerNatively(providerId: CliProviderId, layerPath: string | null): boolean {
  void providerId; void layerPath
  return false
}

interface BuildCliPromptOpts {
  providerId: CliProviderId
  projectPath: string | null
  messages: ChatMessage[]
  /** Optional override — caller may inject recent writes for context-pack. */
  recentWrites?: Array<{ filePath: string; createdAt: number }>
  /** Promt из Project Settings (см. compose-system.ts). Передаётся вниз в
   *  prepareParts, дописывается к user_layer. */
  projectSystemPrompt?: string | null
  /** Промпт активного скилла (специализация роли). Наслаивается секцией
   *  <skill_layer> поверх system/user/context — как в API-пути. */
  skillPrompt?: string | null
  /** Топ-5 воспоминаний проекта — те же что инжектятся API-провайдерам.
   *  Передаются в prepareParts → buildContextPack. */
  memories?: Array<{ type: string; content: string; tags: string[] }>
}

/**
 * Build the full stdin payload for a CLI provider. Returns the assembled
 * string that should be written to the subprocess's stdin.
 */
export async function buildCliPrompt(opts: BuildCliPromptOpts): Promise<string> {
  const { providerId, projectPath, messages, recentWrites, projectSystemPrompt, skillPrompt, memories } = opts

  const lastUser = messages.filter(m => m.role === 'user').at(-1)
  if (!lastUser) throw new Error('CLI prompt: нет user-сообщения')

  const sections: string[] = []

  // 1. user_layer + context_pack — assembled by the shared helper so we don't
  //    drift away from how ipc/ai.ts does it for API providers.
  const { userLayer, contextPack } = await prepareParts({
    projectPath,
    messages,
    recentWrites: recentWrites ?? [],
    projectSystemPrompt,
    memories
  })
  const trimmedUser = userLayer.content.trim()
  // Skip re-injecting user_layer when the CLI is known to read this exact file
  // itself. Otherwise we burn tokens twice and risk version drift between the
  // inline copy and the file the CLI re-read from disk.
  const skipUserLayer = cliReadsLayerNatively(providerId, userLayer.path)
  const effectiveUserLayer = skipUserLayer ? '' : trimmedUser
  const nativeLayerHint = skipUserLayer
    ? `\n[gg-runtime: твой нативный ${userLayer.path} уже прочитан CLI на старте — не повторяю здесь.]`
    : ''

  // 2. System envelope — grok-cli is neutral (no aggressive system prompt of
  //    its own), gets the full system_layer.
  {
    const userBlock = effectiveUserLayer
      ? `\n\n<user_layer source="${userLayer.path}">\n${effectiveUserLayer}\n</user_layer>`
      : nativeLayerHint
    sections.push(`${SYSTEM_LAYER_PROMPT}${userBlock}`)
  }

  // 3. Context pack — same content as API providers get, just appended as
  //    a separate section in stdin payload.
  if (contextPack) sections.push(contextPack)

  // 3.5. Skill layer — специализация роли агента (активный скилл). Наслаивается
  //      ПОВЕРХ system/user/context, как в API-пути (compose-prompt.ts
  //      <skill_layer>): это выбор пользователя, а не наш базовый регламент.
  const trimmedSkill = (skillPrompt ?? '').trim()
  if (trimmedSkill) sections.push(`<skill_layer>\n${trimmedSkill}\n</skill_layer>`)

  // 3. Conversation history — token-budgeted walk from newest to oldest.
  //    NEVER include system messages here (they're already above).
  //
  // Audit 2026-05-21 (vop B):
  //  - Previously slice(-10) was count-based: long sessions silently lost
  //    everything past turn-10. Replaced with a TOTAL_CHAR_BUDGET walk so
  //    short turns can pull in more history, while a single megaturn doesn't
  //    starve the rest. Floor: always include the last MIN_TURNS turns even
  //    if oversized — losing them outright is worse than blowing the budget.
  //  - Previously tool calls/results were serialized as `[tool calls: read_file]`
  //    name-only — CLI was BLIND to what the agent had already read. Now
  //    each tool_result body is included (truncated per-call) so a follow-up
  //    in CLI can reference earlier reads. Same for tool_call args.
  const turns = messages.filter(m => m.role !== 'system')
  // Drop the very last user message — we'll send it separately as the prompt
  const candidates = turns.slice(0, -1)
  const HISTORY_CHAR_BUDGET = 40_000
  const MIN_TURNS = 4
  const PER_MSG_BODY_CAP = 4000
  const PER_TOOL_RESULT_CAP = 1500
  const PER_TOOL_CALL_ARGS_CAP = 300

  /** Serialize a single message into the wire transcript form. Tool calls and
   *  results carry truncated args/body so a follow-up turn isn't blind. */
  function serializeMsg(m: ChatMessage): string {
    const role = m.role === 'assistant' ? 'ASSISTANT' : 'USER'
    let body = (m.content ?? '').slice(0, PER_MSG_BODY_CAP)
    if (m.toolCalls?.length) {
      const calls = m.toolCalls.map(c => {
        let argSummary = ''
        try {
          const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args)
          if (args && args !== '{}') argSummary = ` ${args.slice(0, PER_TOOL_CALL_ARGS_CAP)}`
        } catch { /* args не сериализуется — ничего страшного */ }
        return `${c.name}${argSummary}`
      }).join('\n  · ')
      body = body ? `${body}\n[tool_calls]\n  · ${calls}` : `[tool_calls]\n  · ${calls}`
    }
    if (m.toolResults?.length) {
      const results = m.toolResults.map(r => {
        const raw = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
        const truncated = raw.length > PER_TOOL_RESULT_CAP
          ? raw.slice(0, PER_TOOL_RESULT_CAP) + `\n[…truncated, всего ${raw.length} симв.]`
          : raw
        return `${r.name} →\n${truncated}`
      }).join('\n---\n')
      body = body ? `${body}\n[tool_results]\n${results}` : `[tool_results]\n${results}`
    }
    return `[${role}]: ${body}`
  }

  // Walk newest-to-oldest, push while we have room. Always include MIN_TURNS
  // even if they push us over budget — losing recent context is the worse
  // failure mode.
  const reversed: string[] = []
  let usedChars = 0
  for (let i = candidates.length - 1; i >= 0; i--) {
    const wire = serializeMsg(candidates[i])
    const within = usedChars + wire.length <= HISTORY_CHAR_BUDGET
    const isFloor = reversed.length < MIN_TURNS
    if (!within && !isFloor) break
    reversed.push(wire)
    usedChars += wire.length
  }
  const includedCount = reversed.length
  if (includedCount > 0) {
    const droppedCount = candidates.length - includedCount
    const transcript = reversed.reverse().join('\n\n')
    const droppedNote = droppedCount > 0
      ? ` dropped="${droppedCount}" reason="budget"`
      : ''
    sections.push(
      `<conversation_history turns="${includedCount}"${droppedNote}>\n${transcript}\n</conversation_history>`
    )
  }

  // 4. The actual user prompt — last message
  let userMessage = lastUser.content
  if (lastUser.attachments?.length) {
    const note = lastUser.attachments
      .map(a => `[прикреплён файл: ${a.name} (${a.mimeType}) — CLI не видит содержимое, опиши что нужно сделать]`)
      .join('\n')
    userMessage = userMessage ? `${userMessage}\n\n${note}` : note
  }
  sections.push(wrapCurrentUserRequest(userMessage))

  return sections.join('\n\n')
}

export const CURRENT_USER_REQUEST_OPEN = '<current_user_request>'
export const CURRENT_USER_REQUEST_CLOSE = '</current_user_request>'

export function wrapCurrentUserRequest(userMessage: string): string {
  return `${CURRENT_USER_REQUEST_OPEN}\n${userMessage}\n${CURRENT_USER_REQUEST_CLOSE}`
}

const CURRENT_USER_REQUEST_RE =
  /<current_user_request>\n([\s\S]*?)\n<\/current_user_request>\s*$/

/**
 * Fit a CLI payload into argv length cap WITHOUT dropping the latest user turn.
 * Naive slice(0, cap) keeps system/context at the start and cuts the current
 * user message at the end — model then answers the first turn forever.
 */
export function fitCliPayloadToArgvCap(payload: string, cap: number): string {
  if (payload.length <= cap) return payload
  const match = payload.match(CURRENT_USER_REQUEST_RE)
  if (!match || match.index == null) {
    // Fallback: keep tail (better than head for one-shot CLI)
    return payload.slice(payload.length - cap)
  }
  const userMsg = match[1]
  const wrappedUser = wrapCurrentUserRequest(userMsg)
  const head = payload.slice(0, match.index).trimEnd()
  const marker = '\n\n[truncated]\n\n'
  const headBudget = cap - wrappedUser.length - marker.length
  if (headBudget < 0) {
    return wrappedUser.slice(0, cap)
  }
  const trimmedHead = head.length > headBudget ? head.slice(0, headBudget) : head
  return trimmedHead + marker + wrappedUser
}
