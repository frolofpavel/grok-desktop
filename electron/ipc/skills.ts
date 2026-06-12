/**
 * IPC handlers для скиллов.
 *
 * Каналы:
 *   skills:list             → Skill[]
 *   skills:get              (id) → Skill | null
 *   skills:refresh          → { added, updated, failed }
 *   skills:status           → { lastRefreshAt, serverReachable, total }
 *   skills:run-loaders      (skillId, arg?, projectPath?) → { context: string, labels: string[] }
 */

import { ipcMain } from 'electron'
import type { SkillRegistry } from '../ai/skills/types'
import { lookupLoader } from '../ai/skills/loaders'

interface RunLoadersDeps {
  getSecret?: (key: string) => string | null
}

export function registerSkillsIpc(registry: SkillRegistry, deps: RunLoadersDeps = {}): void {
  ipcMain.handle('skills:list', () => registry.list())
  ipcMain.handle('skills:get', (_e, id: string) => registry.get(id))
  ipcMain.handle('skills:refresh', () => registry.refresh())
  ipcMain.handle('skills:status', () => registry.status())

  /**
   * Запустить context loaders для указанного скилла. Возвращает собранный
   * markdown который renderer инжектит в первое user-message чата.
   *
   * trigger='chat_open' → запускаем loader'ы с runs_on='chat_open'.
   * trigger='slash_arg' → loader'ы которые ждут аргумент slash (например
   * load_client_card для /my-skill my-client).
   */
  ipcMain.handle('skills:run-loaders', async (_e, skillId: string, opts: { arg?: string; projectPath?: string | null; trigger: 'chat_open' | 'slash_arg' }) => {
    const skill = registry.get(skillId)
    if (!skill || !skill.context_loaders) return { context: '', labels: [] }
    const loaders = skill.context_loaders.filter(l => l.runs_on === opts.trigger)
    if (loaders.length === 0) return { context: '', labels: [] }
    const parts: string[] = []
    const labels: string[] = []
    for (const l of loaders) {
      const fn = lookupLoader(l.impl)
      if (!fn) {
        parts.push(`_(loader «${l.impl}» не найден в registry)_`)
        continue
      }
      try {
        const result = await fn({
          arg: opts.arg,
          projectPath: opts.projectPath ?? null,
          getSecret: deps.getSecret
        })
        if (result) {
          parts.push(result.markdown)
          if (result.label) labels.push(result.label)
        }
      } catch (err) {
        parts.push(`_(loader «${l.impl}» упал: ${err instanceof Error ? err.message : String(err)})_`)
      }
    }
    return { context: parts.join('\n\n---\n\n'), labels }
  })
}
