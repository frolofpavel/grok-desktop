import { useEffect, useMemo, useState, useCallback } from 'react'
import { useProject } from '../store/projectStore'
import type { SubSession, SessionTodo, StoredChatMessage } from '../types/api'
import { Markdown } from './Markdown'

/**
 * Панель Agents (Фаза 2, Идея 7) — Inspector 2.0 для суб-агентов.
 *
 * Живой список ВСЕХ суб-сессий проекта (running + done + error + cancelled):
 * роль, провайдер/модель, статус, задача, длительность, счётчик tool-вызовов.
 * Фильтры по роли/провайдеру/статусу. Клик → история суб-сессии (read-only).
 * Кнопка «притащить в чат» вставляет результат в композер основного чата.
 * Массовая отмена (Идея 6): «отменить всё» / по роли — через agents.cancel.
 *
 * Данные: window.api.agents (новый IPC). Поллинг раз в 2с пока открыта панель —
 * чтобы статусы running → done обновлялись без ручного refresh.
 */

const STATUS_LABEL: Record<string, string> = {
  running: 'идёт',
  done: 'готово',
  error: 'ошибка',
  cancelled: 'отменён'
}

function fmtDuration(start: number | null, end: number | null): string {
  if (!start) return '—'
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${ms}мс`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}с`
  return `${Math.floor(sec / 60)}м ${sec % 60}с`
}

function fmtCost(cents: number | null): string | null {
  if (cents == null || cents <= 0) return null
  return `$${(cents / 100).toFixed(2)}`
}

/**
 * Дерево делегирования (Фаза 4, Идея 3): раскладывает плоский список суб-сессий
 * в иерархию main → суб → под-суб по связи callId ↔ parentCallId. Возвращает
 * упорядоченный pre-order список с уровнем отступа на каждый узел. Узлы без
 * родителя (parentCallId == null) или с неизвестным родителем — корни (дети
 * главного агента). Защита от циклов: посещённые callId не разворачиваются дважды.
 */
function buildAgentTree(subs: SubSession[]): Array<{ sub: SubSession; level: number }> {
  const byParent = new Map<string, SubSession[]>()
  const knownCallIds = new Set(subs.map(s => s.callId).filter(Boolean) as string[])
  const roots: SubSession[] = []
  for (const s of subs) {
    const parent = s.parentCallId
    if (parent && knownCallIds.has(parent)) {
      const arr = byParent.get(parent) ?? []
      arr.push(s)
      byParent.set(parent, arr)
    } else {
      roots.push(s)
    }
  }
  const out: Array<{ sub: SubSession; level: number }> = []
  const visited = new Set<number>()
  const walk = (s: SubSession, level: number) => {
    if (visited.has(s.id)) return  // защита от циклов
    visited.add(s.id)
    out.push({ sub: s, level })
    const children = s.callId ? byParent.get(s.callId) ?? [] : []
    for (const c of children) walk(c, level + 1)
  }
  for (const r of roots) walk(r, 0)
  // На случай орфанов из цикла — добавим непосещённые в конец как корни.
  for (const s of subs) if (!visited.has(s.id)) walk(s, 0)
  return out
}

// Просмотр истории суб-сессии (read-only) — модалка поверх панели.
function SubSessionViewer({ sub, onClose, onBring }: { sub: SubSession; onClose: () => void; onBring: (text: string) => void }) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.api.agents.history(sub.id).then(h => {
      if (!cancelled) { setMessages(h); setLoading(false) }
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sub.id])

  // Последний ответ ассистента — это «результат» суба, его и тащим в чат.
  const lastAssistant = useMemo(
    () => [...messages].reverse().find(m => m.role === 'assistant')?.content ?? '',
    [messages]
  )

  return (
    <div className="gg-inspector-csv-overlay" onClick={onClose}>
      <div className="gg-debug-modal" onClick={e => e.stopPropagation()}>
        <div className="gg-inspector-csv-head">
          <span>🤖 {sub.role ?? 'sub-agent'} · {sub.providerId ?? '?'} · {STATUS_LABEL[sub.status ?? ''] ?? sub.status}</span>
          <div className="gg-inspector-csv-actions">
            {lastAssistant && (
              <button className="gg-btn gg-btn-ghost" onClick={() => { onBring(lastAssistant); onClose() }}>↪ Притащить в чат</button>
            )}
            <button className="gg-btn gg-btn-ghost" onClick={onClose}>Закрыть</button>
          </div>
        </div>
        <div className="gg-debug-body">
          <div className="gg-debug-section-title">Задача</div>
          <pre className="gg-debug-pre">{sub.task ?? '—'}</pre>
          <div className="gg-debug-section-title">История ({messages.length})</div>
          {loading && <div className="gg-panel-empty">Загрузка…</div>}
          {!loading && messages.length === 0 && <div className="gg-panel-empty">История пуста.</div>}
          {messages.map(m => (
            <div key={m.id} className={`gg-agents-msg is-${m.role}`}>
              <div className="gg-agents-msg-role">{m.role === 'user' ? 'задача' : 'ответ'}</div>
              <div className="gg-agents-msg-body">
                {m.role === 'assistant' ? <Markdown text={m.content} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AgentsPanel() {
  const path = useProject(s => s.path)
  const setActiveView = useProject(s => s.setActiveView)
  const [subs, setSubs] = useState<SubSession[]>([])
  const [todos, setTodos] = useState<SessionTodo[]>([])
  const [queue, setQueue] = useState<{ inFlight: number; queued: number; tracked: number } | null>(null)
  const [viewing, setViewing] = useState<SubSession | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  const refresh = useCallback(async () => {
    if (!path) return
    try {
      const [list, stats, todoList] = await Promise.all([
        window.api.agents.list(path),
        window.api.agents.queueStats(),
        window.api.agents.todos(path)
      ])
      setSubs(list)
      setQueue(stats)
      setTodos(todoList)
    } catch { /* IPC может быть недоступен в dev — панель просто пустая */ }
  }, [path])

  // Поллинг раз в 2с пока панель открыта — живые статусы.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [refresh])

  const roles = useMemo(() => Array.from(new Set(subs.map(s => s.role).filter(Boolean))) as string[], [subs])
  const providers = useMemo(() => Array.from(new Set(subs.map(s => s.providerId).filter(Boolean))) as string[], [subs])

  const filtered = useMemo(() => subs.filter(s =>
    (!roleFilter || s.role === roleFilter) &&
    (!providerFilter || s.providerId === providerFilter) &&
    (!statusFilter || s.status === statusFilter)
  ), [subs, roleFilter, providerFilter, statusFilter])

  // Дерево делегирования: когда фильтры не активны — показываем иерархию
  // main → суб → под-суб с отступами. С активным фильтром структура рвётся,
  // поэтому показываем плоско (level 0).
  const treeActive = !roleFilter && !providerFilter && !statusFilter
  const tree = useMemo(
    () => treeActive ? buildAgentTree(filtered) : filtered.map(sub => ({ sub, level: 0 })),
    [filtered, treeActive]
  )

  const runningCount = subs.filter(s => s.status === 'running').length

  // Притащить результат суба в композер основного чата (переиспользуем
  // существующий CustomEvent gg-inject-prompt, что слушает Chat.tsx).
  function bringToChat(text: string) {
    const quoted = `Контекст от суб-агента:\n\n${text}\n\n---\n`
    window.dispatchEvent(new CustomEvent('gg-inject-prompt', { detail: quoted }))
    setActiveView('chat')
  }

  async function cancelAll() {
    await window.api.agents.cancel({ all: true }).catch(() => 0)
    void refresh()
  }
  async function cancelRole(role: string) {
    await window.api.agents.cancel({ role }).catch(() => 0)
    void refresh()
  }

  if (!path) {
    return (
      <div className="gg-panel">
        <div className="gg-panel-empty" style={{ marginTop: 80 }}>Открой проект чтобы видеть агентов</div>
      </div>
    )
  }

  return (
    <div className="gg-panel">
      <div className="gg-panel-header">
        <h2 className="gg-panel-title">Агенты</h2>
        <div className="gg-panel-meta">
          {subs.length} суб-сессий · {runningCount} активно
          {queue && ` · очередь: ${queue.inFlight} в работе / ${queue.queued} ждут`}
        </div>
      </div>

      <div className="gg-inspector-toolbar gg-agents-toolbar">
        <select className="gg-input gg-agents-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">Все роли</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="gg-input gg-agents-select" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}>
          <option value="">Все провайдеры</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="gg-input gg-agents-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="gg-agents-toolbar-spacer" />
        {runningCount > 0 && (
          <button className="gg-btn gg-btn-ghost gg-agents-cancel" onClick={() => void cancelAll()} title="Прервать все активные суб-агенты">
            ⛔ Отменить всё
          </button>
        )}
        <button className="gg-btn gg-btn-ghost" onClick={() => void refresh()}>↻</button>
      </div>

      <div className="gg-panel-body">
        {todos.length > 0 && (
          <div className="gg-todogate">
            <div className="gg-todogate-head">
              <span className="gg-todogate-title">TodoGate</span>
              <span className="gg-todogate-progress">{todos.filter(t => t.status === 'done').length}/{todos.length} готово</span>
            </div>
            <div className="gg-todogate-list">
              {todos.map(t => (
                <div key={t.id} className={`gg-todo-item is-${t.status}`} title={t.goal ?? ''}>
                  <span className="gg-todo-icon">
                    {t.status === 'done' ? '✅' : t.status === 'in_progress' ? '⏳' : t.status === 'blocked' ? '⛔' : '☐'}
                  </span>
                  <span className="gg-todo-title">{t.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {filtered.length === 0 && (
          <div className="gg-panel-empty">
            Пока нет суб-агентов. Когда главный агент делегирует задачи (delegate_task / delegate_parallel), они появятся здесь.
          </div>
        )}
        <div className="gg-run-list">
          {tree.map(({ sub: s, level }) => {
            const cost = fmtCost(s.costCents)
            // Узлы роя помечаются по sub_group (callId роя в group). Здесь —
            // эвристика: задача начинается с [swarm]. Бейдж 🐝 для наглядности.
            const isSwarm = (s.task ?? '').startsWith('[swarm')
            return (
              <div
                key={s.id}
                className={`gg-agent-card is-${s.status}${level > 0 ? ' is-child' : ''}`}
                style={level > 0 ? { marginLeft: level * 18 } : undefined}
              >
                <button className="gg-agent-card-main" onClick={() => setViewing(s)}>
                  {level > 0 && <span className="gg-agent-tree-branch" aria-hidden>↳</span>}
                  <span className={`gg-agent-status-dot is-${s.status}`} />
                  <span className="gg-agent-role">{isSwarm ? '🐝 ' : ''}{s.role ?? 'sub-agent'}</span>
                  <span className="gg-agent-provider">{s.providerId ?? '?'}{s.model ? ` · ${s.model}` : ''}</span>
                  {s.depth != null && s.depth > 0 && <span className="gg-agent-depth" title="глубина в дереве делегирования">d{s.depth}</span>}
                  <span className="gg-agent-task" title={s.task ?? ''}>{s.task ?? ''}</span>
                  <span className="gg-agent-meta">
                    {STATUS_LABEL[s.status ?? ''] ?? s.status}
                    {' · '}{fmtDuration(s.startedAt, s.endedAt)}
                    {s.toolCount != null && ` · 🔧${s.toolCount}`}
                    {cost && ` · ${cost}`}
                  </span>
                </button>
                {s.status === 'running' && s.role && (
                  <button className="gg-agent-card-cancel" title={`Отменить всех с ролью ${s.role}`} onClick={() => void cancelRole(s.role!)}>⛔</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {viewing && <SubSessionViewer sub={viewing} onClose={() => setViewing(null)} onBring={bringToChat} />}
    </div>
  )
}
