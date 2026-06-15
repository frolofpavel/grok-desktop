import { useCallback, useEffect, useState } from 'react'

export const UI_SCALE_KEY = 'ui_scale_percent'
export const DEFAULT_UI_SCALE_PERCENT = 100
export const MIN_UI_SCALE_PERCENT = 75
export const MAX_UI_SCALE_PERCENT = 200

export const UI_SCALE_PRESETS = [100, 125, 150, 175, 200] as const

export function normalizeUiScalePercent(raw: string | number | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_UI_SCALE_PERCENT
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_UI_SCALE_PERCENT
  return Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, Math.round(n)))
}

export function useUiScale(): {
  uiScalePercent: number
  setUiScalePercent: (percent: number) => Promise<void>
} {
  const [uiScalePercent, setLocal] = useState(DEFAULT_UI_SCALE_PERCENT)

  useEffect(() => {
    let cancelled = false
    void window.api.settings.getKey(UI_SCALE_KEY).then(v => {
      if (cancelled) return
      setLocal(normalizeUiScalePercent(v))
    })
    const off = window.api.settings.onUiScaleChanged?.((pct) => {
      if (cancelled) return
      setLocal(normalizeUiScalePercent(pct))
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const setUiScalePercent = useCallback(async (percent: number) => {
    const next = normalizeUiScalePercent(percent)
    setLocal(next)
    await window.api.settings.setKey(UI_SCALE_KEY, String(next))
  }, [])

  return { uiScalePercent, setUiScalePercent }
}