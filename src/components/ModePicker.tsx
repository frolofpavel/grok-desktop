import { useEffect, useRef, useState } from 'react'

/**
 * Agent mode picker — visible toggle для пяти режимов работы агента.
 * По аналогии с Claude Code (Ask / Accept / Plan / Auto / Bypass).
 *
 * Mode хранится в settings под ключом 'agent_mode'. Main процесс
 * читает его через getAgentMode() при каждом ai:send и пробрасывает
 * в ToolContext, где tool-handlers решают confirm/auto-accept/block.
 */

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'auto' | 'bypass'

interface ModeOption {
  id: AgentMode
  label: string
  description: string
  icon: string
  shortcut: string
}

const MODES: ModeOption[] = [
  { id: 'ask',          icon: '🛡', label: 'Запрос разрешений',  description: 'Подтверждение каждого изменения. Безопасно.',           shortcut: '1' },
  { id: 'accept-edits', icon: '✏', label: 'Принимать правки',   description: 'Файлы авто, команды через подтверждение.',              shortcut: '2' },
  { id: 'plan',         icon: '📋', label: 'Режим планирования', description: 'Только чтение и планирование. Без изменений.',          shortcut: '3' },
  { id: 'auto',         icon: '⚡', label: 'Авто-режим',         description: 'Всё авто-принимается. Осторожно.',                       shortcut: '4' },
  { id: 'bypass',       icon: '🚀', label: 'Без подтверждений',  description: 'Никаких диалогов. Для опытных и CI.',                    shortcut: '5' }
]

function shortLabel(mode: AgentMode): string {
  return MODES.find(m => m.id === mode)?.label ?? mode
}

function shortIcon(mode: AgentMode): string {
  return MODES.find(m => m.id === mode)?.icon ?? '?'
}

interface Props {
  /** Current mode, polled from settings. */
  mode: AgentMode
  /** Called when user picks a different mode. */
  onChange: (next: AgentMode) => void
}

export function ModePicker({ mode, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Keyboard shortcuts 1-5 when popover is open
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      const idx = parseInt(e.key, 10)
      if (idx >= 1 && idx <= MODES.length) {
        e.preventDefault()
        onChange(MODES[idx - 1].id)
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onChange])

  return (
    <div className="gg-mp-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`gg-mode-pill is-mode-${mode}`}
        onClick={() => setOpen(v => !v)}
        title={`Режим агента: ${shortLabel(mode)}. Клик чтобы сменить.`}
      >
        <span className="gg-mode-icon">{shortIcon(mode)}</span>
        <span className="gg-mode-label">{shortLabel(mode)}</span>
      </button>

      {open && (
        <div className="gg-mp-popover">
          <div className="gg-mp-section">
            <div className="gg-mp-section-title">Режим работы агента</div>
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                className={`gg-mp-row ${mode === m.id ? 'is-active' : ''}`}
                onClick={() => { onChange(m.id); setOpen(false) }}
              >
                <span className="gg-mp-row-label">
                  {m.icon} {m.label}
                </span>
                <span className="gg-mp-row-meta">
                  {m.description}
                  <span style={{ marginLeft: 8, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>{m.shortcut}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
