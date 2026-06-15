import { describe, it, expect } from 'vitest'
import {
  normalizeUiScalePercent,
  uiScalePercentToFactor,
  MIN_UI_SCALE_PERCENT,
  MAX_UI_SCALE_PERCENT,
  DEFAULT_UI_SCALE_PERCENT
} from '../electron/ui-scale'

describe('ui-scale', () => {
  it('defaults invalid values to 100', () => {
    expect(normalizeUiScalePercent(null)).toBe(DEFAULT_UI_SCALE_PERCENT)
    expect(normalizeUiScalePercent('')).toBe(DEFAULT_UI_SCALE_PERCENT)
    expect(normalizeUiScalePercent('abc')).toBe(DEFAULT_UI_SCALE_PERCENT)
  })

  it('clamps to min/max', () => {
    expect(normalizeUiScalePercent(50)).toBe(MIN_UI_SCALE_PERCENT)
    expect(normalizeUiScalePercent(300)).toBe(MAX_UI_SCALE_PERCENT)
  })

  it('converts percent to zoom factor', () => {
    expect(uiScalePercentToFactor(125)).toBe(1.25)
    expect(uiScalePercentToFactor(100)).toBe(1)
  })
})