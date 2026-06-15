import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'
import { resolveSafeTerminalCwd } from '../../electron/ipc/terminal'

const HOME = homedir()
const REPO = process.cwd() // существующая директория, играет роль known root

describe('resolveSafeTerminalCwd', () => {
  it('returns the requested cwd when it is inside a known root', () => {
    const sub = join(REPO, 'electron') // подпапка репо реально существует
    expect(resolveSafeTerminalCwd(sub, [REPO])).toBe(sub)
  })

  it('returns the root itself when cwd === root', () => {
    expect(resolveSafeTerminalCwd(REPO, [REPO])).toBe(REPO)
  })

  it('falls back to home for a known system path outside all roots', () => {
    const systemPath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'
    expect(resolveSafeTerminalCwd(systemPath, [REPO])).toBe(HOME)
  })

  it('falls back to home when cwd is undefined', () => {
    expect(resolveSafeTerminalCwd(undefined, [REPO])).toBe(HOME)
  })

  it('falls back to home when the requested path does not exist', () => {
    const ghost = join(REPO, 'no-such-dir-xyz-123')
    expect(resolveSafeTerminalCwd(ghost, [REPO])).toBe(HOME)
  })

  it('falls back to home when no roots are configured', () => {
    expect(resolveSafeTerminalCwd(REPO, [])).toBe(HOME)
  })
})
