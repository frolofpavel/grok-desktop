import { useEffect, useState } from 'react'
import { useT } from '../i18n'

/**
 * Полоска внизу экрана — прогресс скачивания и кнопка «Установить».
 */
export function UpdateNotification() {
  const t = useT()
  const [state, setState] = useState<'idle' | 'downloading' | 'ready'>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    const offAvailable = window.api.updater.onAvailable(({ version: v }) => {
      setVersion(v)
      setState('downloading')
    })
    const offProgress = window.api.updater.onProgress(({ percent: p }) => {
      setPercent(p)
    })
    const offDownloaded = window.api.updater.onDownloaded(({ version: v }) => {
      setVersion(v)
      setState('ready')
    })
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
    }
  }, [])

  if (state === 'idle') return null

  return (
    <div className="gg-update-bar">
      {state === 'downloading' && (
        <>
          <span>
            {t.updates.downloadingBar
              .replace('{version}', version)
              .replace('{percent}', String(percent))}
          </span>
          <div className="gg-update-progress" style={{ width: `${percent}%` }} />
        </>
      )}
      {state === 'ready' && (
        <>
          <span>{t.updates.readyBar.replace('{version}', version)}</span>
          <button type="button" onClick={() => void window.api.updater.install()}>
            {t.updates.install}
          </button>
        </>
      )}
    </div>
  )
}