import { useEffect, useState } from 'react'
import { useProject } from '../store/projectStore'
import type { Plan, PlanStep, PlanStatus, StepStatus } from '../types/api'

/**
 * Workflow — визуальная история агентных пайплайнов (read-only).
 *
 * Каждый план — это многошаговый запуск агента. PlanView показывает их как
 * список; здесь мы показываем тот же план как СВЯЗНУЮ ЦЕПОЧКУ шагов-узлов со
 * статусами — чтобы видеть поток выполнения целиком. Никакого редактирования,
 * только визуализация поверх существующего IPC window.api.plans.list.
 */

const STEP_LABEL: Record<StepStatus, string> = {
  pending: 'ждёт',
  running: 'выполняется',
  done: 'готово',
  skipped: 'пропущено',
  failed: 'ошибка'
}

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'черновик',
  running: 'выполняется',
  done: 'завершён',
  cancelled: 'отменён'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Verification chip: status текстом + знаком. Неизвестные значения показываем как есть.
function verificationChip(status: string): { sign: string; cls: string } {
  const s = status.toLowerCase()
  if (s === 'passed' || s === 'pass' || s === 'ok') return { sign: '✓', cls: 'is-pass' }
  if (s === 'failed' || s === 'fail' || s === 'error') return { sign: '✗', cls: 'is-fail' }
  return { sign: '—', cls: 'is-unknown' }
}

function StepNode({ step, index }: { step: PlanStep; index: number }) {
  const [open, setOpen] = useState(false)
  const hasDetail = Boolean(step.detail || step.result)
  // Execution-trace бейджи показываем только когда данные реально есть (старые шаги → null).
  const runId = step.runId ?? null
  const verification = step.verificationStatus ?? null
  const changedFiles = step.changedFilesCount ?? null
  const chip = verification ? verificationChip(verification) : null
  return (
    <div className="gg-wf-node-wrap">
      <button
        className={`gg-wf-node is-${step.status} ${open ? 'is-open' : ''}`}
        onClick={() => hasDetail && setOpen(v => !v)}
        title={hasDetail ? 'Показать детали' : STEP_LABEL[step.status]}
      >
        <span className="gg-wf-node-idx">{index + 1}</span>
        <span className="gg-wf-node-dot" aria-hidden />
        <span className="gg-wf-node-title">{step.title}</span>
        <span className="gg-wf-node-status">{STEP_LABEL[step.status]}</span>
      </button>
      {(runId || chip || (changedFiles !== null && changedFiles > 0)) && (
        <div className="gg-wf-node-trace">
          {runId && (
            <span className="gg-wf-trace-run" title={`run: ${runId}`}>
              🔗 {runId.length > 8 ? `${runId.slice(0, 8)}…` : runId}
            </span>
          )}
          {chip && (
            <span className={`gg-wf-trace-verify ${chip.cls}`} title={`Верификация: ${verification}`}>
              {chip.sign} {verification}
            </span>
          )}
          {changedFiles !== null && changedFiles > 0 && (
            <span className="gg-wf-trace-files" title={`Изменено файлов: ${changedFiles}`}>
              {changedFiles} файлов
            </span>
          )}
        </div>
      )}
      {open && hasDetail && (
        <div className="gg-wf-node-detail">
          {step.detail && <div className="gg-wf-node-detail-text">{step.detail}</div>}
          {step.result && <div className="gg-wf-node-result">{step.result}</div>}
        </div>
      )}
    </div>
  )
}

function PipelineCard({ plan }: { plan: Plan }) {
  const doneCount = plan.steps.filter(s => s.status === 'done').length
  const totalCount = plan.steps.length
  return (
    <div className={`gg-wf-card is-${plan.status}`}>
      <div className="gg-wf-card-head">
        <span className="gg-wf-card-title">{plan.title}</span>
        <span className={`gg-wf-badge is-${plan.status}`}>{PLAN_STATUS_LABEL[plan.status]}</span>
        <span className="gg-wf-card-count">{doneCount}/{totalCount} готово</span>
        <span className="gg-wf-card-time">{formatTime(plan.createdAt)}</span>
        {plan.completedAt && <span className="gg-wf-card-time">→ {formatTime(plan.completedAt)}</span>}
      </div>
      <div className="gg-wf-pipeline">
        {plan.steps.length === 0 && <div className="gg-wf-empty-steps">— в плане нет шагов —</div>}
        {plan.steps.map((step, i) => (
          <div className="gg-wf-segment" key={step.id}>
            <StepNode step={step} index={i} />
            {i < plan.steps.length - 1 && <span className="gg-wf-connector" aria-hidden>→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkflowView() {
  const { path } = useProject()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh() {
    if (!path) return
    setLoading(true)
    try {
      const list = await window.api.plans.list(path)
      // Newest first.
      setPlans([...list].sort((a, b) => b.createdAt - a.createdAt))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [path])

  if (!path) {
    return (
      <div className="gg-panel">
        <div className="gg-panel-empty" style={{ marginTop: 80 }}>Открой проект чтобы видеть пайплайны</div>
      </div>
    )
  }

  return (
    <div className="gg-panel">
      <div className="gg-panel-header">
        <h2 className="gg-panel-title">Workflow</h2>
        <div className="gg-panel-meta">{plans.length} пайплайн(ов)</div>
      </div>

      <div className="gg-inspector-toolbar">
        <button className="gg-btn gg-btn-ghost" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Загрузка…' : '↻ Обновить'}
        </button>
      </div>

      <div className="gg-panel-body">
        {plans.length === 0 && (
          <div className="gg-panel-empty">
            Пока нет пайплайнов. Когда агент строит план через create_plan, он появится здесь как визуальная цепочка.
          </div>
        )}

        <div className="gg-wf-list">
          {plans.map(plan => <PipelineCard key={plan.id} plan={plan} />)}
        </div>
      </div>
    </div>
  )
}
