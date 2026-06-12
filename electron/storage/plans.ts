import type { Database } from 'better-sqlite3'

export type PlanStatus = 'draft' | 'running' | 'done' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface PlanStep {
  id: number
  planId: number
  idx: number
  title: string
  detail: string | null
  status: StepStatus
  result: string | null
  // Execution-trace: какой run выполнил шаг, прошла ли верификация, сколько файлов изменилось.
  runId: string | null
  verificationStatus: string | null
  changedFilesCount: number | null
}

export interface Plan {
  id: number
  title: string
  status: PlanStatus
  createdAt: number
  completedAt: number | null
  steps: PlanStep[]
}

export interface NewStep {
  title: string
  detail?: string | null
}

export interface Plans {
  list: (projectPath: string) => Plan[]
  get: (id: number) => Plan | null
  create: (projectPath: string, title: string, steps: NewStep[]) => Plan
  updatePlanStatus: (id: number, status: PlanStatus) => void
  updateStep: (id: number, patch: { status?: StepStatus; result?: string | null; runId?: string | null; verificationStatus?: string | null; changedFilesCount?: number | null }) => void
  remove: (id: number) => void
}

interface PlanRow {
  id: number
  title: string
  status: PlanStatus
  createdAt: number
  completedAt: number | null
}

interface StepRow {
  id: number
  planId: number
  idx: number
  title: string
  detail: string | null
  status: StepStatus
  result: string | null
  runId: string | null
  verificationStatus: string | null
  changedFilesCount: number | null
}

export function createPlans(db: Database): Plans {
  function getSteps(planId: number): PlanStep[] {
    return db.prepare(`
      SELECT id, plan_id as planId, idx, title, detail, status, result,
             run_id as runId, verification_status as verificationStatus, changed_files_count as changedFilesCount
      FROM plan_steps WHERE plan_id = ? ORDER BY idx ASC
    `).all(planId) as StepRow[]
  }

  return {
    list(projectPath) {
      const rows = db.prepare(`
        SELECT id, title, status, created_at as createdAt, completed_at as completedAt
        FROM plans WHERE project_path = ?
        ORDER BY id DESC
      `).all(projectPath) as PlanRow[]
      return rows.map(r => ({ ...r, steps: getSteps(r.id) }))
    },
    get(id) {
      const row = db.prepare(`
        SELECT id, title, status, created_at as createdAt, completed_at as completedAt
        FROM plans WHERE id = ?
      `).get(id) as PlanRow | undefined
      if (!row) return null
      return { ...row, steps: getSteps(row.id) }
    },
    create(projectPath, title, steps) {
      const now = Date.now()
      const planInfo = db.prepare(
        'INSERT INTO plans (project_path, title, status, created_at) VALUES (?, ?, ?, ?)'
      ).run(projectPath, title, 'draft', now)
      const planId = Number(planInfo.lastInsertRowid)
      const insertStep = db.prepare(
        'INSERT INTO plan_steps (plan_id, idx, title, detail, status) VALUES (?, ?, ?, ?, ?)'
      )
      for (let i = 0; i < steps.length; i++) {
        insertStep.run(planId, i, steps[i].title, steps[i].detail ?? null, 'pending')
      }
      return {
        id: planId,
        title,
        status: 'draft',
        createdAt: now,
        completedAt: null,
        steps: getSteps(planId)
      }
    },
    updatePlanStatus(id, status) {
      const completedAt = status === 'done' ? Date.now() : null
      db.prepare('UPDATE plans SET status = ?, completed_at = ? WHERE id = ?').run(status, completedAt, id)
    },
    updateStep(id, patch) {
      const fields: string[] = []
      const params: unknown[] = []
      if (patch.status !== undefined) { fields.push('status = ?'); params.push(patch.status) }
      if (patch.result !== undefined) { fields.push('result = ?'); params.push(patch.result) }
      if (patch.runId !== undefined) { fields.push('run_id = ?'); params.push(patch.runId) }
      if (patch.verificationStatus !== undefined) { fields.push('verification_status = ?'); params.push(patch.verificationStatus) }
      if (patch.changedFilesCount !== undefined) { fields.push('changed_files_count = ?'); params.push(patch.changedFilesCount) }
      if (fields.length === 0) return
      params.push(id)
      db.prepare(`UPDATE plan_steps SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    },
    remove(id) {
      db.prepare('DELETE FROM plan_steps WHERE plan_id = ?').run(id)
      db.prepare('DELETE FROM plans WHERE id = ?').run(id)
    }
  }
}
