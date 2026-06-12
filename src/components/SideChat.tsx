import { useEffect, useRef, useState } from 'react'
import { useProject } from '../store/projectStore'
import { useProvider } from '../hooks/useProvider'
import type { ProviderDescriptorDTO } from '../types/api'
import { Markdown } from './Markdown'

interface SideChatProps {
  /** Dedicated side-chat session id (created lazily by App). */
  sideChatId: number
  onClose: () => void
}

/**
 * Боковой чат — второй чат-поток, пристыкованный справа (как «Боковой чат» у
 * Codex). Работает параллельно основному чату в том же окне: свой стрим
 * сообщений + свой composer.
 *
 * Технически это обычный BACKGROUND-чат: его sessionId никогда не равен
 * activeChatId, поэтому события его стрима роутятся существующим listener'ом
 * в Chat.tsx в chatSnapshots[sideChatId] (ветка owner.kind==='chat' &&
 * owner.chatId !== activeChatId → applyEventToChat). Мы переиспользуем эту
 * инфраструктуру — основной чат полностью изолирован.
 */
export function SideChat({ sideChatId, onClose }: SideChatProps) {
  const provider = useProvider()
  // Live snapshot: stream-ответы прилетают в chatSnapshots[sideChatId] через
  // applyEventToChat, селектор перерисовывает панель.
  const snapshot = useProject(s => s.chatSnapshots[sideChatId])
  const path = useProject(s => s.path)
  const messages = snapshot?.messages ?? []
  const isStreaming = snapshot?.isStreaming ?? false

  const [input, setInput] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendIdRef = useRef<number | null>(null)

  // --- Независимый выбор модели бокового чата ---
  // Боковой чат держит СВОЙ providerId/model в локальном state и НЕ трогает
  // глобальный provider (useProvider). Дефолт: сохранённое в side-сессии, иначе
  // — текущая модель основного чата (читается один раз как стартовая точка).
  const [sideProviderId, setSideProviderId] = useState<string | null>(null)
  const [sideModel, setSideModel] = useState<string | null>(null)
  // Список всех провайдеров (метаданные) + множество «настроенных» (есть ключ
  // или CLI/локальный) — зеркалит фильтрацию ModelPicker, но локально для панели.
  const [providers, setProviders] = useState<ProviderDescriptorDTO[]>([])
  const [configuredIds, setConfiguredIds] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Инициализация выбранной модели: из side-сессии если задана, иначе из
  // основного чата. Читаем один раз на смену sideChatId — НЕ биндимся к
  // основному live.
  useEffect(() => {
    const session = useProject.getState().chatSessions.find(c => c.id === sideChatId)
    setSideProviderId(session?.providerId ?? provider.id)
    setSideModel(session?.model ?? provider.model ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideChatId])

  // Загружаем список провайдеров + «настроенные» (ключ задан / CLI не требует).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.api.providers.list()
        if (cancelled) return
        setProviders(list)
        // CLI/локальные (secretKey === null) считаем всегда настроенными.
        const configured = new Set<string>(list.filter(p => p.secretKey === null).map(p => p.id))
        const withKey = list.filter(p => p.secretKey !== null)
        const keyVals = await Promise.all(withKey.map(p => window.api.settings.getKey(p.secretKey as string)))
        if (cancelled) return
        withKey.forEach((p, i) => { if (keyVals[i]) configured.add(p.id) })
        setConfiguredIds(configured)
      } catch { /* IPC недоступен — список останется пустым, пикер просто не покажет опции */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Закрытие поповера по клику вне.
  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const sideProvider = providers.find(p => p.id === sideProviderId)
  const sideLabel = sideProvider?.shortLabel ?? sideProvider?.name ?? (sideProviderId ?? '—')
  const sideModelLabel = sideModel ?? sideProvider?.defaultModel ?? 'auto'

  // Выбрать провайдера в боковом чате: ставит дефолтную модель провайдера,
  // персистит в side-сессию. Основной чат не затрагивается.
  async function selectProvider(p: ProviderDescriptorDTO) {
    const nextModel = p.defaultModel || null
    setSideProviderId(p.id)
    setSideModel(nextModel)
    try {
      await window.api.chatSessions.setModel(sideChatId, p.id, nextModel)
    } catch { /* не блокируем UX если persist упал */ }
  }

  // Выбрать конкретную модель текущего провайдера бокового чата.
  async function selectModel(model: string) {
    setSideModel(model)
    try {
      await window.api.chatSessions.setModel(sideChatId, sideProviderId, model)
    } catch { /* не блокируем UX */ }
  }

  // На первом открытии подгружаем persisted-историю в снапшот (если он ещё
  // не заполнен живым стримом). Тянем один раз на смену sideChatId.
  useEffect(() => {
    let cancelled = false
    const store = useProject.getState()
    const snap = store.chatSnapshots[sideChatId]
    if (snap && snap.messages.length > 0) return  // уже есть содержимое
    void window.api.chats.list(sideChatId).then(history => {
      if (cancelled) return
      // Защита от гонки: если за время загрузки появился живой стрим — не трём
      const current = useProject.getState().chatSnapshots[sideChatId]
      if (current && current.messages.length > 0) return
      store.seedChatSnapshot(sideChatId, history.map(m => ({ role: m.role, content: m.content })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sideChatId])

  // Autoscroll on new content.
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
  }, [messages])

  function autoGrow() {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }
  useEffect(autoGrow, [input])

  async function send() {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    const store = useProject.getState()
    // История ДО нового сообщения — для отправки модели.
    const history = (store.chatSnapshots[sideChatId]?.messages ?? [])
      .filter(m => m.content)
      .map(m => ({ role: m.role, content: m.content }))
    const userMsg = { role: 'user' as const, content: text }
    // Кладём user + пустой assistant placeholder в снапшот бокового чата.
    store.pushUserToChatSnapshot(sideChatId, text)
    // Persist user message (как в основном чате).
    if (path) {
      void window.api.chats.append(sideChatId, path, 'user', text).catch(() => {})
    }
    // Отправляем с СОБСТВЕННЫМ провайдером/моделью бокового чата (override).
    // Основной чат и его выбор модели не затрагиваются.
    const sendId = await window.api.ai.sendWithOverrides(
      [...history, userMsg],
      path,
      { providerId: sideProviderId ?? undefined, model: sideModel },
      String(sideChatId)
    )
    sendIdRef.current = sendId
    // Регистрируем owner как 'chat' с chatId бокового чата — события стрима
    // уйдут в chatSnapshots[sideChatId], НЕ в активный основной чат.
    if (sendId > 0) {
      store.registerSendOwner(sendId, { kind: 'chat', chatId: sideChatId })
    } else {
      // Провайдер недоступен — снимаем placeholder-стриминг, чтобы UI не завис.
      store.applyEventToChat(sideChatId, { type: 'error', message: 'Провайдер недоступен' })
    }
  }

  async function stop() {
    const id = sendIdRef.current
    if (id == null) return
    await window.api.ai.stop(id).catch(() => {})
    useProject.getState().applyEventToChat(sideChatId, { type: 'done' })
    useProject.getState().forgetSendOwner(id)
    sendIdRef.current = null
  }

  return (
    <div className="gg-sidechat">
      <div className="gg-sidechat-header">
        <span>💬 Боковой чат</span>
        <div className="gg-sidechat-mp" ref={pickerRef}>
          <button
            type="button"
            className="gg-sidechat-mp-pill"
            onClick={() => setPickerOpen(v => !v)}
            title="Модель бокового чата (независима от основного)"
          >
            <span className="gg-sidechat-mp-name">{sideLabel}</span>
            <span className="gg-sidechat-mp-sep">·</span>
            <span className="gg-sidechat-mp-model">{sideModelLabel}</span>
          </button>
          {pickerOpen && (
            <div className="gg-sidechat-mp-popover">
              <div className="gg-sidechat-mp-section-title">Провайдер</div>
              {providers.map(p => {
                const isConfigured = configuredIds.has(p.id)
                const isActive = p.id === sideProviderId
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`gg-sidechat-mp-row ${isActive ? 'is-active' : ''} ${!isConfigured ? 'is-unconfigured' : ''}`}
                    disabled={!isConfigured}
                    title={isConfigured ? undefined : 'API-ключ не задан (Настройки)'}
                    onClick={() => { if (isConfigured) void selectProvider(p).then(() => setPickerOpen(false)) }}
                  >
                    <span className="gg-sidechat-mp-row-label">
                      {!isConfigured && '🔒 '}{p.shortLabel || p.name}
                    </span>
                    <span className="gg-sidechat-mp-row-meta">{p.transport}</span>
                  </button>
                )
              })}
              {sideProvider && sideProvider.models.length > 1 && (
                <>
                  <div className="gg-sidechat-mp-section-title">Модель</div>
                  {sideProvider.models.map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`gg-sidechat-mp-row ${m === sideModel ? 'is-active' : ''}`}
                      onClick={() => void selectModel(m).then(() => setPickerOpen(false))}
                    >
                      <span className="gg-sidechat-mp-row-label">{m}</span>
                      {m === sideModel && <span className="gg-sidechat-mp-row-meta">✓</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <button
          className="gg-sidechat-close"
          onClick={onClose}
          title="Закрыть боковой чат"
        >×</button>
      </div>
      <div className="gg-sidechat-stream" ref={streamRef}>
        {messages.length === 0 && (
          <div className="gg-sidechat-empty">
            Второй чат-поток рядом с основным. Спроси что-нибудь — основной чат не затрагивается.
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1
          const isStreamingAssistant = isLast && m.role === 'assistant' && isStreaming
          return (
            <div key={i} className={`gg-sidechat-msg ${m.role === 'user' ? 'is-user' : 'is-assistant'}`}>
              <div className="gg-sidechat-bubble">
                {m.content
                  ? (m.role === 'assistant'
                      ? <Markdown text={m.content} />
                      : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>)
                  : isStreamingAssistant
                    ? <div className="gg-typing"><span /><span /><span /></div>
                    : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="gg-sidechat-composer">
        <textarea
          ref={textareaRef}
          className="gg-sidechat-textarea"
          value={input}
          rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              void send()
            }
            if (e.key === 'Escape' && isStreaming) {
              e.preventDefault()
              void stop()
            }
          }}
          placeholder={isStreaming ? `${provider.label} печатает…` : 'Сообщение в боковой чат…'}
        />
        {isStreaming ? (
          <button className="gg-sidechat-send is-stop" onClick={() => void stop()} title="Остановить (Esc)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            className="gg-sidechat-send"
            onClick={() => void send()}
            disabled={input.trim().length === 0}
            title="Отправить (Enter)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l14 -8l-4 16l-4 -6l-6 -2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
