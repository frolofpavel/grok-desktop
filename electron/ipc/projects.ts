import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { setActiveProjectPath } from '../state/project-state'
import { ensureUserLayer } from '../ai/user-layer'
import type { Projects } from '../storage/projects'
import { deleteProjectIconFile, importProjectIcon } from '../storage/project-icons'
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
      // upsert — touch alone silently no-ops if the project was never registered
      // (e.g. restored from last_project_path without going through pick()).
      projects.upsert(path)
      void ensureUserLayer(path).catch(() => { /* non-critical */ })
    }
  })

  ipcMain.handle('app:home-dir', () => app.getPath('home'))
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:rename', (_e, path: string, name: string) => projects.rename(path, name))
  ipcMain.handle('projects:update-meta', (_e, path: string, patch: { name?: string }) => {
    // Принимаем ТОЛЬКО name. iconPath из renderer игнорируем — иконка ставится
    // строго через pick-icon/clear-icon (там путь генерит main внутри
    // project-icons). Иначе renderer мог бы записать произвольный путь как
    // iconPath и через protocol-хендлер прочитать любой файл.
    return projects.updateMeta(path, { name: patch?.name })
  })
  ipcMain.handle('projects:pick-icon', async (_e, projectPath: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Иконка проекта',
      properties: ['openFile'],
      filters: [
        { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const existing = projects.list().find(p => p.path === projectPath)
    if (existing?.iconPath) deleteProjectIconFile(existing.iconPath)
    const iconPath = importProjectIcon(projectPath, result.filePaths[0])
    return projects.updateMeta(projectPath, { iconPath })
  })
  ipcMain.handle('projects:clear-icon', (_e, projectPath: string) => {
    const existing = projects.list().find(p => p.path === projectPath)
    if (existing?.iconPath) deleteProjectIconFile(existing.iconPath)
    return projects.updateMeta(projectPath, { iconPath: null })
  })
  ipcMain.handle('projects:remove', (_e, path: string) => {
    const existing = projects.list().find(p => p.path === path)
    if (existing?.iconPath) deleteProjectIconFile(existing.iconPath)
    projects.remove(path)
    forgetMemorizedProject(path)
  })
}
