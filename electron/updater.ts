import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'

autoUpdater.logger = null
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

const STARTUP_CHECK_MS = 4_000
const PERIODIC_CHECK_MS = 4 * 60 * 60 * 1000

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('update:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { available: !!result?.updateInfo?.version && result.updateInfo.version !== app.getVersion(), version: result?.updateInfo?.version }
    } catch {
      return { available: false, error: 'Не удалось проверить обновления' }
    }
  })

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer(mainWindow, 'update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    sendToRenderer(mainWindow, 'update:available', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer(mainWindow, 'update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer(mainWindow, 'update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer(mainWindow, 'update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err.message)
  })

  const runCheck = () => {
    autoUpdater.checkForUpdates().catch(() => {})
  }

  setTimeout(runCheck, STARTUP_CHECK_MS)
  setInterval(runCheck, PERIODIC_CHECK_MS)
}

function sendToRenderer(win: BrowserWindow, channel: string, data?: unknown): void {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  } catch { /* window might be closing */ }
}