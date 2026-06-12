import { ipcMain } from 'electron'
import type { Feedback } from '../storage/feedback'

export function registerFeedbackIpc(feedback: Feedback): void {
  ipcMain.handle('feedback:list', (_e, projectPath: string | null, limit?: number) => feedback.list(projectPath, limit))
  ipcMain.handle('feedback:submit', (_e, input: { projectPath: string | null; providerId: string | null; rating: number | null; message: string }) =>
    feedback.submit(input)
  )
  ipcMain.handle('feedback:remove', (_e, id: number) => feedback.remove(id))
}
