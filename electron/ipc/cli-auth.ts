/**
 * IPC handlers для logout/relogin CLI-провайдеров. Тонкая обёртка над
 * electron/ai/cli-auth.ts.
 */

import { ipcMain } from 'electron'
import { logoutCli, reloginCli, isCliProvider, getAllCliStatus, type LogoutResult, type ReloginResult } from '../ai/cli-auth'

export function registerCliAuthIpc() {
  ipcMain.handle('cli-auth:status-all', async () => {
    return getAllCliStatus()
  })

  ipcMain.handle('cli-auth:logout', async (_event, providerId: string): Promise<LogoutResult> => {
    if (!isCliProvider(providerId)) {
      return { ok: false, method: 'creds-deleted', removedFiles: [], message: `Unknown CLI providerId: ${providerId}` }
    }
    return logoutCli(providerId)
  })

  ipcMain.handle('cli-auth:relogin', async (_event, providerId: string): Promise<ReloginResult> => {
    if (!isCliProvider(providerId)) {
      return { ok: false, message: `Unknown CLI providerId: ${providerId}` }
    }
    return reloginCli(providerId)
  })
}
