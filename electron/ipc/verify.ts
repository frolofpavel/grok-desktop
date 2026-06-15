import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { classifyCommand } from '../ai/command-policy'
import { scanText } from '../ai/secret-scanner'

const execFileAsync = promisify(execFile)

/**
 * `verify:exec` — runs a shell command on behalf of Plan autopilot. Different
 * from `ai:tool/run_command` in that the user has already approved the verify
 * command in the Plan view (it's typed in autopilot settings), so we skip
 * the per-call confirmation. Command policy (denylist) still applies.
 */
export function registerVerifyIpc(getProjectRoot: () => string | null): void {
  ipcMain.handle('verify:exec', async (e, command: string) => {
    // SECURITY: reject calls from anything that isn't the top-level main frame.
    // <webview> tags and out-of-process frames have a non-top sender — we must
    // not let untrusted web content reach this no-confirmation shell exec.
    if (!e.sender || e.senderFrame?.parent != null) {
      return { exitCode: 1, stdout: '', stderr: 'Запрещено: verify:exec доступен только основному окну' }
    }
    const cwd = getProjectRoot()
    if (!cwd) return { exitCode: 1, stdout: '', stderr: 'Проект не открыт' }
    const verdict = classifyCommand(command)
    if (!verdict.allowed) {
      return { exitCode: 1, stdout: '', stderr: `Blocked by safety policy: ${verdict.reason}` }
    }
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command]
    try {
      const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
        cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
      })
      // Редактируем вывод через secret-scanner — verify-команды печатают логи,
      // в которых могут оказаться токены/ключи.
      return {
        exitCode: 0,
        stdout: scanText(String(stdout ?? '')).redacted,
        stderr: scanText(String(stderr ?? '')).redacted
      }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string }
      const exitCode = typeof e.code === 'number' ? e.code : 1
      return {
        exitCode,
        stdout: scanText(String(e.stdout ?? '')).redacted,
        stderr: scanText(String(e.stderr ?? e.message ?? '')).redacted
      }
    }
  })
}
