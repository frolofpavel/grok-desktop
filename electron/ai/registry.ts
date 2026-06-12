import { createGrokProvider, GROK_MODELS } from './grok'
import { createGrokCliProvider, GROK_CLI_MODELS } from './grok-cli'
import type { ChatProvider } from './types'
import type { AgentMode } from './mode-policy'

export type ProviderId = 'grok' | 'grok-cli'

export interface ProviderDescriptor {
  id: ProviderId
  name: string
  /** Short transport tag shown to the user: "API" / "CLI" / "—" */
  transport: 'API' | 'CLI'
  /** Settings key for the API key (null if not key-based, e.g. CLI). */
  secretKey: string | null
  /** Available model ids; "auto" for CLI where the binary picks. */
  models: string[]
  defaultModel: string
  /** Whether function calling / file tools are supported in this build. */
  supportsTools: boolean
  /** Human-readable model label shown in the chat status pill. */
  shortLabel: string
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  grok: {
    id: 'grok',
    name: 'Grok',
    transport: 'API',
    secretKey: 'xai_api_key',
    models: GROK_MODELS,
    defaultModel: 'grok-4',
    supportsTools: true,
    shortLabel: 'Grok'
  },
  'grok-cli': {
    id: 'grok-cli',
    name: 'Grok Build',
    transport: 'CLI',
    secretKey: null,
    models: GROK_CLI_MODELS,
    defaultModel: 'auto',
    supportsTools: false,
    shortLabel: 'Grok Build'
  }
}

export interface CreateOptions {
  apiKey?: string | null
  model?: string
  cwd?: string
  signal?: AbortSignal
  /** Промпт из Project Settings UI — пробрасывается до buildCliPrompt чтобы
   *  попасть в payload CLI-провайдеров. Для API-провайдеров не нужен (там
   *  ipc/ai.ts напрямую вызывает prepareSystemContext с этим полем). */
  projectSystemPrompt?: string | null
  /** Промпт активного скилла — пробрасывается до buildCliPrompt (<skill_layer>),
   *  чтобы CLI-провайдеры видели активный скилл, как и API-провайдеры. */
  skillPrompt?: string | null
  /** Топ-5 воспоминаний проекта — пробрасываются в buildCliPrompt для CLI-провайдеров,
   *  чтобы они получали тот же контекст памяти что и API-провайдеры. */
  memories?: Array<{ type: string; content: string; tags: string[] }>
  /** Уровень усилий модели: влияет на max_tokens и extended thinking.
   *  'quick' — короткие ответы; 'standard' (default) — без изменений; 'deep' — максимальное мышление. */
  effortLevel?: 'quick' | 'standard' | 'deep'
  /** Режим агента — CLI-провайдеры маппят его во флаги песочницы.
   *  Для API-провайдеров режим применяется в ipc/ai.ts через mode-policy.decide. */
  agentMode?: AgentMode
}

export function createProvider(id: ProviderId, opts: CreateOptions): ChatProvider {
  switch (id) {
    case 'grok': {
      if (!opts.apiKey) throw new Error('xAI (Grok) API key not set')
      return createGrokProvider({ apiKey: opts.apiKey, model: opts.model, effortLevel: opts.effortLevel })
    }
    case 'grok-cli':
      return createGrokCliProvider({ cwd: opts.cwd, signal: opts.signal, model: opts.model, projectSystemPrompt: opts.projectSystemPrompt, skillPrompt: opts.skillPrompt, memories: opts.memories })
  }
}
