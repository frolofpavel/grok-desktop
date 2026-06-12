import { useEffect, useRef, useState } from 'react'
import { useSkills } from '../store/skillStore'

/**
 * Skill picker — кнопка 🎭 в composer-toolbar + popup со списком скиллов.
 *
 * Поведение:
 *  - Если активного скилла нет: кнопка «🎭 Скилл».
 *  - Если активен: кнопка показывает icon + name + крестик для снятия.
 *  - Клик → popup с group'ами «Серверные / Пользовательские / Built-in».
 *  - Каждый скилл — описание + slash trigger + source badge.
 *  - В popup есть кнопка «↻ Обновить» — refresh из registry.
 *  - Esc / клик вне popup — закрыть.
 */

export function SkillPicker() {
  const skills = useSkills(s => s.skills)
  const activeSkillId = useSkills(s => s.activeSkillId)
  const loading = useSkills(s => s.loading)
  const lastRefreshAt = useSkills(s => s.lastRefreshAt)
  const serverReachable = useSkills(s => s.serverReachable)
  const setActiveSkill = useSkills(s => s.setActiveSkill)
  const refresh = useSkills(s => s.refresh)

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Загружаем список один раз при первом рендере
  useEffect(() => {
    if (skills.length === 0 && !loading) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Закрытие popup по клику вне + Esc
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = activeSkillId ? skills.find(s => s.id === activeSkillId) : null

  // Группировка по источнику
  const grouped = {
    server: skills.filter(s => s.source === 'server'),
    user: skills.filter(s => s.source === 'user'),
    'built-in': skills.filter(s => s.source === 'built-in')
  }

  function pick(id: string | null) {
    setActiveSkill(id)
    setOpen(false)
  }

  return (
    <div className="gg-skill-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`gg-skill-picker-btn ${active ? 'is-active' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={active ? `Активный скилл: ${active.name ?? active.id}` : 'Выбрать скилл (системный промпт + tools)'}
      >
        {active ? (
          <>
            <span className="gg-skill-icon">{active.icon ?? '🎭'}</span>
            <span className="gg-skill-name">{active.name ?? active.id}</span>
            <span
              className="gg-skill-clear"
              onClick={e => { e.stopPropagation(); pick(null) }}
              title="Снять скилл"
            >×</span>
          </>
        ) : (
          <>
            <span className="gg-skill-icon">🎭</span>
            <span>Скилл</span>
          </>
        )}
      </button>
      {open && (
        <div className="gg-skill-popup">
          <div className="gg-skill-popup-header">
            <span className="gg-skill-popup-title">Скиллы агента</span>
            <button
              type="button"
              className="gg-skill-refresh"
              onClick={() => void refresh()}
              disabled={loading}
              title={lastRefreshAt ? `Обновлено: ${new Date(lastRefreshAt).toLocaleTimeString('ru-RU')}` : 'Никогда не обновлялось'}
            >{loading ? '⌛' : '↻'}</button>
          </div>
          <div className="gg-skill-popup-status">
            {serverReachable
              ? <span className="gg-skill-server-ok">✓ Сервер скиллов: подключён</span>
              : <span className="gg-skill-server-off">⊝ Сервер: недоступен — built-in fallback</span>}
          </div>

          {activeSkillId && (
            <button
              type="button"
              className="gg-skill-popup-item is-clear"
              onClick={() => pick(null)}
            >
              <span className="gg-skill-icon">∅</span>
              <span className="gg-skill-popup-item-body">
                <span className="gg-skill-popup-item-name">Без скилла</span>
                <span className="gg-skill-popup-item-desc">Обычный чат, без специального промпта</span>
              </span>
            </button>
          )}

          {(['server', 'user', 'built-in'] as const).map(group => {
            const items = grouped[group]
            if (items.length === 0) return null
            const groupLabel = group === 'server' ? 'С сервера агентства' : group === 'user' ? 'Личные' : 'Встроенные'
            return (
              <div key={group} className="gg-skill-group">
                <div className="gg-skill-group-label">{groupLabel} · {items.length}</div>
                {items.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`gg-skill-popup-item ${s.id === activeSkillId ? 'is-active' : ''}`}
                    onClick={() => pick(s.id)}
                  >
                    <span className="gg-skill-icon">{s.icon ?? '🎭'}</span>
                    <span className="gg-skill-popup-item-body">
                      <span className="gg-skill-popup-item-name">
                        {s.name ?? s.id}
                        {s.slash && <code className="gg-skill-popup-slash">/{s.slash}</code>}
                      </span>
                      {s.description && (
                        <span className="gg-skill-popup-item-desc">{s.description}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}

          {skills.length === 0 && !loading && (
            <div className="gg-skill-popup-empty">
              Скиллов нет. Сервер недоступен и built-in пуст — это не должно случиться.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
