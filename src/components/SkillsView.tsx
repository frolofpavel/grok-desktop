import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import type { Skill } from '../types/api'

export function SkillsView({ onActivateSkill }: { onActivateSkill: (slash: string) => void }) {
  const t = useT()
  const [skills, setSkills] = useState<Skill[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    window.api.skills.list().then(setSkills).catch(() => {})
  }, [])

  const filtered = filter
    ? skills.filter(s =>
        (s.name ?? s.id).toLowerCase().includes(filter.toLowerCase()) ||
        s.description?.toLowerCase().includes(filter.toLowerCase())
      )
    : skills

  return (
    <div className="gg-skills-view">
      <div className="gg-skills-header">
        <h2>{t.views.skillsTitle}</h2>
        <input
          className="gg-input"
          placeholder="Search skills…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      <div className="gg-skills-grid">
        {filtered.map(s => (
          <button
            key={s.id}
            className="gg-skill-card"
            onClick={() => onActivateSkill(s.slash ?? s.id)}
            title={s.slash ? `/${s.slash}` : s.id}
          >
            <div className="gg-skill-card-icon">{s.icon ?? '⚡'}</div>
            <div className="gg-skill-card-body">
              <div className="gg-skill-card-name">{s.name ?? s.id}</div>
              <div className="gg-skill-card-desc">{s.description ?? ''}</div>
            </div>
            <div className="gg-skill-card-meta">
              {s.slash && <span className="gg-skill-slash">/{s.slash}</span>}
              <span className={`gg-skill-source gg-skill-source-${s.source}`}>{s.source}</span>
            </div>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="gg-skills-empty">
          <p>No skills found. Create .md files in .verstak/skills/ or connect a skills server.</p>
        </div>
      )}
    </div>
  )
}
