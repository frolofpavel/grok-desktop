import { dialog, ipcMain, BrowserWindow } from 'electron'
import { setActiveProjectPath } from '../state/project-state'
import { ensureUserLayer } from '../ai/user-layer'
import type { Projects } from '../storage/projects'
import { forgetMemorizedProject } from './ai'

export function registerProjectIpc(projects: Projects): void {
  ipcMain.handle('projects:pick', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Открыть проект'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    projects.upsert(picked)
    setActiveProjectPath(picked)
    void ensureUserLayer(picked).catch(() => { /* non-critical */ })
    return picked
  })

  ipcMain.handle('projects:set-current', (_e, path: string | null) => {
    setActiveProjectPath(path)
    if (path) {
      projects.touch(path)
      void ensureUserLayer(path).catch(() => { /* non-critical */ })
    }
  })

  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:rename', (_e, path: string, name: string) => projects.rename(path, name))
  ipcMain.handle('projects:remove', (_e, path: string) => {
    projects.remove(path)
    // Clear projectPath fallback key from memory-injection cache.
    forgetMemorizedProject(path)
  })
}
