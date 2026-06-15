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

/** Сериализуемый дескриптор провайдера для renderer (без фабричных функций). */
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

/** Категория действия агента — для матрицы Policy Center. */
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

// Представительные инструменты по категориям. Decision считается из реальной
// decide() для каждого режима — рендерер ничего не дублирует.
const POLICY_TOOLS: ReadonlyArray<{ tool: string; category: PolicyCategory }> = [
  { tool: 'read_file',       category: 'read' },
  { tool: 'write_file',      category: 'edit' },
  { tool: 'apply_patch',     category: 'edit' },
  { tool: 'run_command',     category: 'command' },
  { tool: 'connector_query', category: 'connector' }
]

/** Снимок политики разрешений агента — единый источник правды через decide(). */
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

  // Единый источник истины для списка провайдеров и моделей — electron/ai/registry.ts.
  // Renderer получает данные через этот канал, а не хардкодит копию.
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

  // Policy Center — снимок «что разрешено агенту»: матрица decide(tool, mode)
  // по 5 режимам + список опасных команд. Вычисляется из реальных policy-функций
  // (mode-policy.decide + command-policy.dangerousCommandLabels), рендерер не
  // дублирует логику.
  ipcMain.handle('policy:matrix', (): PolicyMatrixDTO => buildPolicyMatrix())

  // Doctor — health-check настроенных провайдеров и коннекторов (config presence,
  // без сетевых вызовов). См. electron/ai/doctor.ts.
  ipcMain.handle('doctor:run', () => runDoctor(settings))
}
