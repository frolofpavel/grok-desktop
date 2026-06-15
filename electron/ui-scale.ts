import type { BrowserWindow } from 'electron'
import type { Settings } from './storage/settings'

export const UI_SCALE_KEY = 'ui_scale_percent'
export const DEFAULT_UI_SCALE_PERCENT = 100
export const MIN_UI_SCALE_PERCENT = 75
export const MAX_UI_SCALE_PERCENT = 200

export function normalizeUiScalePercent(raw: string | number | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_UI_SCALE_PERCENT
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_UI_SCALE_PERCENT
  return Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, Math.round(n)))
}

export function uiScalePercentToFactor(percent: number): number {
  return normalizeUiScalePercent(percent) / 100
}

let applyingZoom = false

export function applyUiScaleToWindow(win: BrowserWindow, percent: number): void {
  const normalized = normalizeUiScalePercent(percent)
  applyingZoom = true
  try {
    win.webContents.setZoomFactor(uiScalePercentToFactor(normalized))
  } finally {
    applyingZoom = false
  }
}

export function readUiScalePercent(settings: Settings): number {
  return normalizeUiScalePercent(settings.getSecret(UI_SCALE_KEY))
}

/** Apply saved scale on load; persist Ctrl+wheel zoom from Chromium. */
export function bindUiScaleToWindow(win: BrowserWindow, settings: Settings): void {
  const applySaved = () => applyUiScaleToWindow(win, readUiScalePercent(settings))

  win.webContents.on('did-finish-load', applySaved)

  win.webContents.on('zoom-changed', () => {
    if (applyingZoom) return
    const pct = normalizeUiScalePercent(Math.round(win.webContents.getZoomFactor() * 100))
    const prev = readUiScalePercent(settings)
    if (pct === prev) return
    settings.setSecret(UI_SCALE_KEY, String(pct))
    win.webContents.send('ui-scale:changed', pct)
  })
}