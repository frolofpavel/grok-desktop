import { ipcMain } from 'electron'
import type { Database } from 'better-sqlite3'
import { generateSuggestions } from '../ai/proactive'

export function registerSuggestionsIpc(db: Database): void {
  ipcMain.handle('suggestions:get', (_e, projectPath: string) => {
    try {
      return generateSuggestions(db, projectPath)
    } catch {
      return []
    }
  })
}
