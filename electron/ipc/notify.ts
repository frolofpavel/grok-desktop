import { ipcMain, Notification, BrowserWindow, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
  return null
}

function windowsPowerShellPath(): string {
  return join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Standard Windows notification WAV from %WINDIR%\\Media (sound-only, without toast). */
function playWindowsNotificationSound(isError = false): void {
  if (process.platform !== 'win32') return
  const media = join(process.env.WINDIR ?? 'C:\\Windows', 'Media')
  const wav = isError
    ? firstExisting(media, ['Windows Background.wav', 'Windows Error.wav', 'Windows Notify System Generic.wav'])
    : firstExisting(media, [
        'Windows Notify System Generic.wav',
        'Windows Notify.wav',
        'notify.wav'
      ])
  if (!wav) return
  const escaped = wav.replace(/'/g, "''")
  const script = [
    "[void][Reflection.Assembly]::LoadWithPartialName('System.Media')",
    `$p = New-Object System.Media.SoundPlayer('${escaped}')`,
    '$p.PlaySync()'
  ].join('; ')
  execFile(
    windowsPowerShellPath(),
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    { windowsHide: true },
    () => {}
  )
}

export function registerNotifyIpc(getMainWindow: () => BrowserWindow | null, iconPath: string): void {
  ipcMain.handle('app:is-focused', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle('notify:play-sound', (_e, opts?: { isError?: boolean }) => {
    playWindowsNotificationSound(!!opts?.isError)
    return true
  })

  ipcMain.handle('notify:show', (_e, opts: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false
    const title = (opts.title ?? 'Grok Desktop').slice(0, 120)
    const body = (opts.body ?? '').slice(0, 240)
    let icon = nativeImage.createEmpty()
    try {
      icon = nativeImage.createFromPath(iconPath)
    } catch { /* fallback without icon */ }

    const n = new Notification({
      title,
      body,
      icon,
      silent: true
    })
    n.on('click', () => {
      const win = getMainWindow()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    n.show()
    return true
  })
}
