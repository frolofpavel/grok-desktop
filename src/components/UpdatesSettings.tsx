import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'

type Status = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'

export function UpdatesSettings() {
  const t = useT()
  const [version, setVersion] = useState('…')
  const [status, setStatus] = useState<Status>('idle')
  const [remoteVersion, setRemoteVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.app.getVersion().then(setVersion)
    const offAvailable = window.api.updater.onAvailable(({ version: v }) => {
      setRemoteVersion(v)
      setStatus('downloading')
    })
    const offProgress = window.api.updater.onProgress(({ percent: p }) => {
      setPercent(p)
      setStatus('downloading')
    })
    const offDownloaded = window.api.updater.onDownloaded(({ version: v }) => {
      setRemoteVersion(v)
      setStatus('ready')
    })
    const offNotAvailable = window.api.updater.onNotAvailable(() => {
      setStatus('current')
    })
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offNotAvailable()
    }
  }, [])

  const check = useCallback(async () => {
    setStatus('checking')
    setError('')
    const result = await window.api.updater.check()
    if (result.error) {
      setError(result.error)
      setStatus('error')
      return
    }
    if (!result.available) {
      setStatus('current')
      return
    }
    if (result.version) setRemoteVersion(result.version)
    setStatus('downloading')
  }, [])

  return (
    <div className="gg-settings-extra">
      <div className="gg-settings-section-title">{t.settings.updates}</div>
      <div className="gg-settings-hint" style={{ marginBottom: 16 }}>{t.settings.updatesHint}</div>

      <div className="gg-settings-row">
        <label className="gg-settings-label">{t.settings.currentVersion}</label>
        <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>v{version}</div>
      </div>

      <div className="gg-settings-row">
        <label className="gg-settings-label">{t.settings.checkUpdates}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <button type="button" className="gg-btn gg-btn-ghost" onClick={() => void check()} disabled={status === 'checking'}>
            {status === 'checking' ? t.settings.checkingUpdates : t.settings.checkUpdates}
          </button>
          {status === 'current' && <span className="gg-settings-hint">{t.settings.upToDate}</span>}
          {status === 'downloading' && remoteVersion && (
            <span className="gg-settings-hint">
              {t.settings.downloadingUpdate.replace('{version}', remoteVersion).replace('{percent}', String(percent))}
            </span>
          )}
          {status === 'ready' && remoteVersion && (
            <div className="gg-updates-ready-row">
              <span className="gg-settings-hint">{t.settings.updateReady.replace('{version}', remoteVersion)}</span>
              <button type="button" className="gg-btn gg-btn-primary" onClick={() => void window.api.updater.install()}>
                {t.settings.installUpdate}
              </button>
            </div>
          )}
          {status === 'error' && <span className="gg-settings-hint" style={{ color: 'var(--error)' }}>{error || t.settings.updateError}</span>}
        </div>
      </div>
    </div>
  )
}