import { describe, expect, it } from 'vitest'
import { DEFAULT_MAIN_WINDOW_STATE, normalizeMainWindowState } from '../electron/window-state-core'

describe('normalizeMainWindowState', () => {
  it('returns defaults for invalid input', () => {
    expect(normalizeMainWindowState(null)).toEqual(DEFAULT_MAIN_WINDOW_STATE)
    expect(normalizeMainWindowState('bad')).toEqual(DEFAULT_MAIN_WINDOW_STATE)
  })

  it('clamps size to sane bounds', () => {
    expect(normalizeMainWindowState({ width: 100, height: 100 })).toMatchObject({
      width: 800,
      height: 500
    })
  })

  it('preserves position and maximized flag', () => {
    expect(normalizeMainWindowState({
      width: 1600,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: true
    })).toEqual({
      width: 1600,
      height: 900,
      x: 120,
      y: 80,
      isMaximized: true
    })
  })
})
