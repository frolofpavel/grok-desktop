import { ipcMain } from 'electron'
import type { Journal, JournalKind } from '../storage/journal'

export function registerJournalIpc(journal: Journal): void {
  ipcMain.handle('journal:list', (_e, projectPath: string, limit?: number) => journal.list(projectPath, limit))
  ipcMain.handle('journal:append', (_e, projectPath: string, kind: JournalKind, title: string, detail?: string | null) =>
    journal.append(projectPath, kind, title, detail ?? null)
  )
  ipcMain.handle('journal:remove', (_e, id: number) => journal.remove(id))
  ipcMain.handle('journal:clear', (_e, projectPath: string) => journal.clear(projectPath))
}
