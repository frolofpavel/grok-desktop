import { ipcMain } from 'electron'
import type { Plans, NewStep, PlanStatus, StepStatus } from '../storage/plans'

export function registerPlansIpc(plans: Plans): void {
  ipcMain.handle('plans:list', (_e, projectPath: string) => plans.list(projectPath))
  ipcMain.handle('plans:get', (_e, id: number) => plans.get(id))
  ipcMain.handle('plans:create', (_e, projectPath: string, title: string, steps: NewStep[]) =>
    plans.create(projectPath, title, steps)
  )
  ipcMain.handle('plans:set-status', (_e, id: number, status: PlanStatus) => {
    plans.updatePlanStatus(id, status)
  })
  ipcMain.handle('plans:update-step', (_e, id: number, patch: { status?: StepStatus; result?: string | null; runId?: string | null; verificationStatus?: string | null; changedFilesCount?: number | null }) => {
    plans.updateStep(id, patch)
  })
  ipcMain.handle('plans:remove', (_e, id: number) => plans.remove(id))
}
