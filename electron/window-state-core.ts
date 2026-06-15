export const MAIN_WINDOW_STATE_KEY = 'main_window_bounds'

export interface MainWindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

const DEFAULT_WIDTH = 1400
const DEFAULT_HEIGHT = 900
const MIN_WIDTH = 800
const MIN_HEIGHT = 500
const MAX_WIDTH = 7680
const MAX_HEIGHT = 4320

export const DEFAULT_MAIN_WINDOW_STATE: MainWindowState = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeMainWindowState(raw: unknown): MainWindowState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MAIN_WINDOW_STATE }
  const s = raw as Partial<MainWindowState>
  const width = clamp(Number(s.width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH)
  const height = clamp(Number(s.height) || DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT)
  const x = s.x == null ? undefined : clamp(Number(s.x), -MAX_WIDTH, MAX_WIDTH)
  const y = s.y == null ? undefined : clamp(Number(s.y), -MAX_HEIGHT, MAX_HEIGHT)
  return {
    width,
    height,
    x: Number.isFinite(x) ? x : undefined,
    y: Number.isFinite(y) ? y : undefined,
    isMaximized: Boolean(s.isMaximized)
  }
}
