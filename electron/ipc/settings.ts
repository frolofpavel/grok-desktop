import { ipcMain, BrowserWindow } from 'electron'
import type { Settings } from '../storage/settings'
import {
  UI_SCALE_KEY,
  applyUiScaleToWindow,
  normalizeUiScalePercent
} from '../ui-scale'
import { detectInstalledClis } from '../ai/cli-detect'
import { PROVIDERS } from '../ai/registry'
import { runDoctor } from '../ai/doctor'
import { AGENT_MODES, decide, type AgentMode, type ToolDecision } from '../ai/mode-policy'
import { dangerousCommandLabels } from '../ai/command-policy'

export interface ProviderDescriptorDTO {
  id: string
  name: string
  transport: 'API' | 'CLI'
  secretKey: string | null
  models: string[]
  defaultModel: string
  supportsTools: boolean
  shortLabel: string
}

export type PolicyCategory = 'read' | 'edit' | 'command' | 'connector'

export interface PolicyMatrixRow {
  tool: string
  category: PolicyCategory
  decisions: Record<AgentMode, ToolDecision>
}

export interface PolicyMatrixDTO {
  modes: Array<{ id: AgentMode; label: string; description: string; icon: string }>
  rows: PolicyMatrixRow[]
  commandDanger: string[]
}

const POLICY_TOOLS: ReadonlyArray<{ tool: string; category: PolicyCategory }> = [
  { tool: 'read_file',       category: 'read' },
  { tool: 'write_file',      category: 'edit' },
  { tool: 'apply_patch',     category: 'edit' },
  { tool: 'run_command',     category: 'command' },
  { tool: 'connector_query', category: 'connector' }
]

function buildPolicyMatrix(): PolicyMatrixDTO {
  const rows: PolicyMatrixRow[] = POLICY_TOOLS.map(({ tool, category }) => {
    const decisions = {} as Record<AgentMode, ToolDecision>
    for (const m of AGENT_MODES) {
      decisions[m.id] = decide(tool, m.id)
    }
    return { tool, category, decisions }
  })
  return {
    modes: AGENT_MODES.map(m => ({ id: m.id, label: m.label, description: m.description, icon: m.icon })),
    rows,
    commandDanger: dangerousCommandLabels()
  }
}

export function registerSettingsIpc(settings: Settings): void {
  ipcMain.handle('settings:get-key', (_e, key: string) => settings.getSecret(key))
  ipcMain.handle('settings:set-key', (e, key: string, value: string) => {
    settings.setSecret(key, value)
    if (key === UI_SCALE_KEY) {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) {
        const pct = normalizeUiScalePercent(value)
        applyUiScaleToWindow(win, pct)
        win.webContents.send('ui-scale:changed', pct)
      }
    }
  })
  ipcMain.handle('cli:detect', () => detectInstalledClis())
  ipcMain.handle('providers:list', (): ProviderDescriptorDTO[] => {
    return Object.values(PROVIDERS).map(p => ({
      id: p.id,
      name: p.name,
      transport: p.transport,
      secretKey: p.secretKey,
      models: [...p.models],
      defaultModel: p.defaultModel,
      supportsTools: p.supportsTools,
      shortLabel: p.shortLabel
    }))
  })
  ipcMain.handle('policy:matrix', (): PolicyMatrixDTO => buildPolicyMatrix())
  ipcMain.handle('doctor:run', () => runDoctor(settings))
}