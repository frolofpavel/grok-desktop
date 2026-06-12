import { useState, useEffect } from 'react'
import { useProject } from '../store/projectStore'
import type { ProjectMeta } from '../types/api'

interface ProjectSettingsProps {
  project: ProjectMeta
  onClose: () => void
}

export function ProjectSettings({ project, onClose }: ProjectSettingsProps) {
  const { removeProject, setProject } = useProject()
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Load system prompt from settings
  useEffect(() => {
    void (async () => {
      const val = await window.api.settings.getKey(`system_prompt_${project.path}`) as string | null
      setSystemPrompt(val ?? '')
    })()
  }, [project.path])

  async function handleSavePrompt() {
    setSaving(true)
    await window.api.settings.setKey(`system_prompt_${project.path}`, systemPrompt)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleRemove() {
    const ok = window.confirm(`Убрать «${project.name}» из списка?\nФайлы проекта не будут удалены.`)
    if (!ok) return
    onClose()
    await removeProject(project.path)
  }

  return (
    <div className="gg-modal-overlay" onClick={onClose}>
      <div
        className="gg-project-settings"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="gg-ps-header">
          <div className="gg-ps-title">
            <span
              className="gg-ps-color-dot"
              style={{ background: project.color }}
            />
            <span>{project.name}</span>
          </div>
          <button className="gg-ps-close" onClick={onClose} title="Закрыть">×</button>
        </div>

        <div className="gg-ps-body">
          {/* Path */}
          <section className="gg-ps-section">
            <div className="gg-ps-section-label">Папка</div>
            <div className="gg-ps-path">
              <span className="gg-ps-path-icon">📁</span>
              <span className="gg-ps-path-text" title={project.path}>{project.path}</span>
              <button
                className="gg-ps-path-open"
                onClick={() => void window.api.files.revealInExplorer?.(project.path).catch(() => {})}
                title="Открыть в проводнике"
              >↗</button>
            </div>
          </section>

          {/* System Prompt */}
          <section className="gg-ps-section">
            <div className="gg-ps-section-label">
              Системный промпт проекта
              <span className="gg-ps-section-hint">Добавляется к каждому чату в этом проекте</span>
            </div>
            <textarea
              className="gg-ps-textarea"
              placeholder="Например: Ты работаешь с проектом на TypeScript + React. Всегда используй строгую типизацию..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={6}
            />
            <div className="gg-ps-textarea-actions">
              <span className="gg-ps-char-count">{systemPrompt.length} символов</span>
              <button
                className={`gg-ps-save-btn ${saved ? 'is-saved' : ''}`}
                onClick={() => void handleSavePrompt()}
                disabled={saving}
              >
                {saved ? '✓ Сохранено' : saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </section>

          {/* Open project to edit */}
          <section className="gg-ps-section">
            <div className="gg-ps-section-label">Быстрые действия</div>
            <div className="gg-ps-actions">
              <button
                className="gg-ps-action-btn"
                onClick={() => { void setProject(project.path); onClose() }}
              >
                Открыть проект
              </button>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="gg-ps-section gg-ps-danger-zone">
            <div className="gg-ps-section-label gg-ps-danger-label">Danger Zone</div>
            <div className="gg-ps-danger-row">
              <div>
                <div className="gg-ps-danger-title">Убрать из списка</div>
                <div className="gg-ps-danger-desc">Файлы проекта не удаляются — только запись в Verstak.</div>
              </div>
              <button className="gg-ps-danger-btn" onClick={() => void handleRemove()}>
                Убрать
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
