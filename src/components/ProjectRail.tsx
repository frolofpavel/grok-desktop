import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from '../store/projectStore'
import type { ProjectMeta } from '../types/api'
import iconUrl from '../assets/icon.png'
import { ProjectAvatar } from './ProjectAvatar'

const RAIL_EXPANDED_KEY = 'gg-rail-expanded'
const RAIL_WIDTH_COLLAPSED = '56px'
const RAIL_WIDTH_EXPANDED = '200px'

function readRailExpanded(): boolean {
  try {
    return localStorage.getItem(RAIL_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

function filterProjects(list: ProjectMeta[], query: string, activePath: string | null): ProjectMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const matches = list.filter(
    p => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  )
  if (activePath && !matches.some(p => p.path === activePath)) {
    const active = list.find(p => p.path === activePath)
    if (active) return [active, ...matches]
  }
  return matches
}

interface ProjectChipProps {
  project: ProjectMeta
  active: boolean
  unread: boolean
  streaming: boolean
  expanded: boolean
  onClick: () => void
  onSettings: () => void
}

function ProjectChip({ project, active, unread, streaming, expanded, onClick, onSettings }: ProjectChipProps) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className={`gg-rail-chip ${active ? 'is-active' : ''} ${expanded ? 'is-expanded' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={expanded ? project.path : `${project.name}\n${project.path}`}
    >
      <button
        type="button"
        className="gg-rail-chip-btn"
        onClick={onClick}
      >
        <ProjectAvatar project={project} />
        {expanded && <span className="gg-rail-label">{project.name}</span>}
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
  onOpenProjectSettings: (project: ProjectMeta) => void
}

export function ProjectRail({ sidebarOpen, onToggleSidebar, onOpenProjectSettings }: ProjectRailProps) {
  const { path, projectList, sessions, setProject, refreshProjectList } = useProject()
  const [bootstrapped, setBootstrapped] = useState(false)
  const [railExpanded, setRailExpanded] = useState(readRailExpanded)
  const [projectQuery, setProjectQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const filteredProjects = useMemo(
    () => filterProjects(projectList, projectQuery, path),
    [projectList, projectQuery, path]
  )
  const showSearch = projectList.length >= 2
  const hasActiveFilter = projectQuery.trim().length > 0

  function openSearch() {
    setRailExpanded(true)
    window.setTimeout(() => searchRef.current?.focus(), 180)
  }

  useEffect(() => {
    document.documentElement.style.setProperty('--gg-rail-w', railExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED)
    try {
      localStorage.setItem(RAIL_EXPANDED_KEY, railExpanded ? '1' : '0')
    } catch { /* ignore */ }
  }, [railExpanded])

  useEffect(() => {
    void (async () => {
      await refreshProjectList()
      const state = useProject.getState()
      if (!state.path) {
        const list = state.projectList
        const last = await window.api.settings.getKey('last_project_path')
        const lastInList = last && list.some(p => p.path === last) ? last : null
        if (lastInList) {
          await setProject(lastInList)
        } else if (list.length > 0) {
          await setProject(list[0].path)
        } else {
          const home = await window.api.app.getHomeDir()
          const fallback = (last && last.length > 0) ? last : home
          if (fallback) await setProject(fallback)
        }
      }
      setBootstrapped(true)
    })()
  }, [])
  void bootstrapped

  async function addProject() {
    const picked = await window.api.projects.pick()
    if (picked) await setProject(picked)
  }

  return (
      <div className={`gg-rail ${railExpanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          className="gg-rail-home"
          onClick={() => useProject.getState().closeProject()}
          title="Главная"
        >
          <img src={iconUrl} alt="Grok Desktop" />
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
        <button
          type="button"
          className={`gg-rail-expand ${railExpanded ? 'is-expanded' : ''}`}
          onClick={() => setRailExpanded(v => !v)}
          title={railExpanded ? 'Свернуть панель проектов' : 'Развернуть — показать названия'}
          aria-expanded={railExpanded}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {railExpanded ? (
              <polyline points="15 6 9 12 15 18" />
            ) : (
              <polyline points="9 6 15 12 9 18" />
            )}
          </svg>
          {railExpanded && <span className="gg-rail-expand-label">Проекты</span>}
        </button>
        {!railExpanded && showSearch && (
          <button
            type="button"
            className="gg-rail-search-btn"
            onClick={openSearch}
            title="Поиск по проектам"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
          </button>
        )}
        <div className="gg-rail-divider" />
        {railExpanded && showSearch && (
          <div className="gg-rail-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="gg-input gg-rail-search"
              placeholder="Поиск проекта…"
              value={projectQuery}
              onChange={e => setProjectQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setProjectQuery('') }}
              aria-label="Поиск по проектам"
            />
            {hasActiveFilter && (
              <button
                type="button"
                className="gg-rail-search-clear"
                onClick={() => setProjectQuery('')}
                title="Очистить поиск"
              >×</button>
            )}
          </div>
        )}
        <div className="gg-rail-list">
          {filteredProjects.length === 0 && hasActiveFilter && (
            <div className="gg-rail-empty">Ничего не найдено</div>
          )}
          {filteredProjects.map(p => {
            const session = sessions[p.path]
            return (
              <ProjectChip
                key={p.path}
                project={p}
                active={path === p.path}
                unread={!!session?.hasUnread}
                streaming={!!session?.isStreaming}
                expanded={railExpanded}
                onClick={() => { if (path !== p.path) void setProject(p.path) }}
                onSettings={() => onOpenProjectSettings(p)}
              />
            )
          })}
          <button
            type="button"
            className="gg-rail-add"
            onClick={() => void addProject()}
            title="Открыть проект"
          >
            {railExpanded ? <span className="gg-rail-add-label">+ Открыть</span> : '+'}
          </button>
        </div>
      </div>
  )
}
