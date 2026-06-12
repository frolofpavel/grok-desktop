import { useCallback, useEffect, useState } from 'react'
import type { AgentMode } from '../components/ModePicker'

const KNOWN: AgentMode[] = ['ask', 'accept-edits', 'plan', 'auto', 'bypass']
function parse(v: string | null | undefined): AgentMode {
  return (v && (KNOWN as string[]).includes(v)) ? (v as AgentMode) : 'ask'
}

const POLL_MS = 2000

export function useAgentMode(): { mode: AgentMode; setMode: (m: AgentMode) => Promise<void> } {
  const [mode, setLocal] = useState<AgentMode>('ask')

  const refresh = useCallback(async () => {
    const v = await window.api.settings.getKey('agent_mode')
    setLocal(parse(v))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => { if (!cancelled) await refresh() })()
    const t = window.setInterval(refresh, POLL_MS)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [refresh])

  const setMode = useCallback(async (m: AgentMode) => {
    await window.api.settings.setKey('agent_mode', m)
    setLocal(m)
  }, [])

  return { mode, setMode }
}
