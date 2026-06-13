import { useProject } from '../store/projectStore'
import { useProvider } from '../hooks/useProvider'

export function CommandConfirm() {
  const { pendingCommand, setPendingCommand } = useProject()
  const provider = useProvider()
  if (!pendingCommand) return null
  const ref = pendingCommand

  const isCli = provider.id === 'grok-cli'
  const title = isCli ? 'Grok Build хочет выполнить команду' : 'AI хочет выполнить команду'

  async function accept() {
    await window.api.ai.resolveCommand(ref.callId, true, ref.sendId)
    setPendingCommand(null)
  }
  async function reject() {
    await window.api.ai.resolveCommand(ref.callId, false, ref.sendId)
    setPendingCommand(null)
  }

  return (
    <div className="gg-modal-backdrop" onClick={reject}>
      <div className="gg-modal" onClick={e => e.stopPropagation()}>
        <div className="gg-modal-header">
          <div>
            <div className="gg-modal-title">{title}</div>
            <div className="gg-text-tertiary" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
              Команда выполнится в корне проекта. Проверь — выглядит безопасно?
            </div>
          </div>
        </div>

        <div className="gg-modal-body" style={{ padding: '16px 22px' }}>
          <div className="gg-cmd-box">
            <span className="gg-cmd-prompt">$</span>
            <code className="gg-cmd-text">{pendingCommand.command}</code>
          </div>
        </div>

        <div className="gg-modal-footer">
          <button className="gg-btn gg-btn-danger" onClick={reject}>Отклонить</button>
          <button className="gg-btn gg-btn-success" onClick={accept}>Выполнить</button>
        </div>
      </div>
    </div>
  )
}
