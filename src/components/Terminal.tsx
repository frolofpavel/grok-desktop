import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useProject } from '../store/projectStore'

export function Terminal() {
  const ref = useRef<HTMLDivElement>(null)
  const { path } = useProject()

  useEffect(() => {
    if (!ref.current || !path) return
    const term = new XTerm({
      fontSize: 12,
      fontFamily: '"Geist Mono", "JetBrains Mono", "SF Mono", Menlo, monospace',
      theme: {
        background: '#0a0b0d',
        foreground: '#e6e8ec',
        cursor: '#5b8dff',
        selectionBackground: 'rgba(91, 141, 255, 0.25)'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current)
    fit.fit()
    const onResize = () => { try { fit.fit() } catch { /* ignore */ } }
    window.addEventListener('resize', onResize)

    let termId = -1
    let offData: (() => void) | null = null
    void window.api.term.spawn(path).then(id => {
      termId = id
      offData = window.api.term.onData(({ id: gotId, data }) => {
        if (gotId === termId) term.write(data)
      })
      term.onData(d => { void window.api.term.write(termId, d) })
    })

    return () => {
      window.removeEventListener('resize', onResize)
      offData?.()
      if (termId > 0) void window.api.term.kill(termId)
      term.dispose()
    }
  }, [path])

  return <div ref={ref} style={{ height: '100%', width: '100%', background: '#0a0b0d', padding: '6px 8px' }} />
}
