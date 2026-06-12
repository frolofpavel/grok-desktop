/**
 * IPC handlers для logout/relogin CLI-провайдеров. Тонкая обёртка над
 * electron/ai/cli-auth.ts с очисткой связанных settings (например, при
 * logout claude-cli — также чистим settings.claude_code_oauth_token который
 * хранился отдельно в SafeStorage для headless+Max обхода).
 */

import { ipcMain } from 'electron'
import { logoutCli, reloginCli, isCliProvider, getAllCliStatus, type LogoutResult, type ReloginResult } from '../ai/cli-auth'
import type { Settings } from '../storage/settings'

export function registerCliAuthIpc(settings: Settings) {
  ipcMain.handle('cli-auth:status-all', async () => {
    return getAllCliStatus()
  })

  ipcMain.handle('cli-auth:logout', async (_event, providerId: string): Promise<LogoutResult> => {
    if (!isCliProvider(providerId)) {
      return { ok: false, method: 'creds-deleted', removedFiles: [], message: `Unknown CLI providerId: ${providerId}` }
    }
    const result = await logoutCli(providerId)
    // Side-effect: для claude-cli чистим наш отдельный OAuth token из Settings
    // (он использовался как fallback для headless+Max через env var
    // CLAUDE_CODE_OAUTH_TOKEN). После logout он логически невалиден.
    if (providerId === 'claude-cli' && result.ok) {
      try { settings.setSecret('claude_code_oauth_token', '') } catch { /* ignore */ }
    }
    return result
  })

  ipcMain.handle('cli-auth:relogin', async (_event, providerId: string): Promise<ReloginResult> => {
    if (!isCliProvider(providerId)) {
      return { ok: false, message: `Unknown CLI providerId: ${providerId}` }
    }
    return reloginCli(providerId)
  })
}
