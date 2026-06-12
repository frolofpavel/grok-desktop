import { useEffect, useState } from 'react'
import { useProject } from '../store/projectStore'
import type { ProjectMeta } from '../types/api'
import iconUrl from '../assets/icon.png'
import { ProjectSettings } from './ProjectSettings'

function initial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '·'
}

interface ProjectChipProps {
  project: ProjectMeta
  active: boolean
  unread: boolean
  streaming: boolean
  onClick: () => void
  onSettings: () => void
}

function ProjectChip({ project, active, unread, streaming, onClick, onSettings }: ProjectChipProps) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className={`gg-rail-chip ${active ? 'is-active' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${project.name}\n${project.path}`}
    >
      <button
        type="button"
        className="gg-rail-square"
        style={{ background: project.color }}
        onClick={onClick}
      >
        {initial(project.name)}
      </button>
      {(unread || streaming) && (
        <span
          className={`gg-rail-unread ${streaming ? 'is-streaming' : ''}`}
          title={streaming ? 'AI работает в этом проекте' : 'Есть новый ответ'}
        />
      )}
      {hover && (
        <button
          type="button"
          className="gg-rail-settings"
          onClick={e => { e.stopPropagation(); onSettings() }}
          title="Настройки проекта"
        >⚙</button>
      )}
    </div>
  )
}

interface ProjectRailProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function ProjectRail({ sidebarOpen, onToggleSidebar }: ProjectRailProps) {
  const { path, projectList, sessions, setProject, refreshProjectList } = useProject()
  const [bootstrapped, setBootstrapped] = useState(false)
  const [settingsProject, setSettingsProject] = useState<ProjectMeta | null>(null)

  useEffect(() => {
    void (async () => {
      await refreshProjectList()
      const list = useProject.getState().projectList
      if (!useProject.getState().path && list.length > 0) {
        await setProject(list[0].path)
      }
      setBootstrapped(true)
    })()
  }, [])
  void bootstrapped  // keep eslint quiet — the flag prevents repeated auto-open

  async function addProject() {
    const picked = await window.api.projects.pick()
    if (picked) await setProject(picked)
  }

  return (
    <>
      <div className="gg-rail">
        <button
          type="button"
          className="gg-rail-home"
          onClick={() => useProject.getState().closeProject()}
          title="Главная"
        >
          <img src={iconUrl} alt="Verstak" />
        </button>
        <button
          type="button"
          className={`gg-rail-toggle ${sidebarOpen ? 'is-open' : ''}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Скрыть боковую панель (Ctrl+B)' : 'Показать боковую панель (Ctrl+B)'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>
        <div className="gg-rail-divider" />
        <div className="gg-rail-list">
          {projectList.map(p => {
            const session = sessions[p.path]
            return (
              <ProjectChip
                key={p.path}
                project={p}
                active={path === p.path}
                unread={!!session?.hasUnread}
                streaming={!!session?.isStreaming}
                onClick={() => { if (path !== p.path) void setProject(p.path) }}
                onSettings={() => setSettingsProject(p)}
              />
            )
          })}
          <button
            type="button"
            className="gg-rail-add"
            onClick={() => void addProject()}
            title="Открыть проект"
          >+</button>
        </div>
      </div>

      {settingsProject && (
        <ProjectSettings
          project={settingsProject}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </>
  )
}
