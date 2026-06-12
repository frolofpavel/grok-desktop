import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

// Используем console вместо electron-log (не хотим лишней зависимости)
autoUpdater.logger = null
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Проверяем обновления через 10 секунд после старта (не блокируем UI)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Нет интернета или GitHub недоступен — молча продолжаем
    })
  }, 10_000)

  // Повторная проверка каждые 4 часа
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)

  // Events → renderer
  autoUpdater.on('checking-for-update', () => {
    sendToRenderer(mainWindow, 'update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    sendToRenderer(mainWindow, 'update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer(mainWindow, 'update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer(mainWindow, 'update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer(mainWindow, 'update:downloaded', {
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    // Не показываем ошибку пользователю — обновления не критичны
    console.warn('[updater] error:', err.message)
  })

  // IPC: renderer может запросить установку
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // IPC: ручная проверка из Settings
  ipcMain.handle('update:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { available: !!result?.updateInfo, version: result?.updateInfo?.version }
    } catch {
      return { available: false, error: 'Не удалось проверить обновления' }
    }
  })
}

function sendToRenderer(win: BrowserWindow, channel: string, data?: unknown): void {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  } catch { /* window might be closing */ }
}
