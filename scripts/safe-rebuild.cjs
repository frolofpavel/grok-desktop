#!/usr/bin/env node
/**
 * Self-healing ABI для better-sqlite3 перед тестами.
 *
 * Зачем — better-sqlite3 в node_modules компилируется под Electron'овский
 * Node ABI (NODE_MODULE_VERSION 143) при `npm run dev` (predev → electron-rebuild).
 * Vitest бежит под чистым Node (ABI 137), и тесты которые открывают БД падают
 * `NODE_MODULE_VERSION mismatch`.
 *
 * Решение: перед тестами пробуем загрузить better-sqlite3 под текущим Node ABI.
 *   - грузится → ничего не делаем (быстрый путь, без лишней пересборки);
 *   - ABI mismatch → пересобираем под Node (`npm rebuild ... --runtime=node`);
 *   - rebuild упал (EBUSY/EPERM — .node заблокирован запущенным Electron) →
 *     предупреждаем, но НЕ валим: тесты запустятся, sqlite-группа просто упадёт
 *     как раньше.
 *
 * Экспортирует ensureNodeAbi() для переиспользования из Vitest globalSetup
 * (tests/global-setup.ts) — так self-healing работает и при прямом
 * `npx vitest run` (минуя npm-pretest хук). При запуске как CLI (npm pretest)
 * выполняет ту же проверку и всегда завершается exit 0.
 */
const { spawnSync } = require('child_process')
const { platform } = require('os')

/**
 * Пробует загрузить better-sqlite3 под текущим Node ABI.
 * @returns {{ok: true} | {ok: false, abiMismatch: boolean, message: string}}
 */
function probe() {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.prepare('select 1 as x').get()
    db.close()
    return { ok: true }
  } catch (err) {
    const message = String((err && err.message) || err).split('\n')[0]
    const abiMismatch = /NODE_MODULE_VERSION/i.test(String((err && err.message) || err))
    return { ok: false, abiMismatch, message }
  }
}

function rebuild() {
  const npmCmd = platform() === 'win32' ? 'npm.cmd' : 'npm'
  // На Windows spawn .cmd требует shell:true (иначе EINVAL в Node 24+).
  return spawnSync(
    npmCmd,
    ['rebuild', 'better-sqlite3', '--runtime=node', '--update-binary'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: platform() === 'win32', encoding: 'utf8' }
  )
}

/**
 * Гарантирует, что better-sqlite3 собран под текущий Node ABI.
 * Никогда не бросает и не блокирует — худший случай возвращает 'failed'.
 * @param {{log?: Pick<Console,'log'|'warn'>}} [opts]
 * @returns {{status: 'ok'|'rebuilt'|'failed'|'error', rebuilt: boolean}}
 */
function ensureNodeAbi(opts = {}) {
  const log = opts.log || console
  const abi = process.versions.modules

  const first = probe()
  if (first.ok) {
    log.log(`[safe-rebuild] better-sqlite3 уже под Node ABI ${abi} ✓`)
    return { status: 'ok', rebuilt: false }
  }

  if (!first.abiMismatch) {
    // Не ABI-проблема (например модуль не установлен) — пересборка не поможет.
    log.warn(`[safe-rebuild] better-sqlite3 не загрузился (не ABI mismatch): ${first.message}`)
    return { status: 'error', rebuilt: false }
  }

  log.log(`[safe-rebuild] ABI mismatch — пересобираю better-sqlite3 под Node ABI ${abi}…`)
  const res = rebuild()

  if (res.error) {
    log.warn(`[safe-rebuild] spawn error: ${res.error.message}. Пропускаю.`)
    return { status: 'failed', rebuilt: false }
  }
  if (res.status === 0) {
    log.log('[safe-rebuild] better-sqlite3 пересобран под Node ABI ✓')
    return { status: 'rebuilt', rebuilt: true }
  }

  const combined = `${res.stdout || ''}\n${res.stderr || ''}`.toLowerCase()
  const isBusy =
    combined.includes('ebusy') || combined.includes('eperm') ||
    combined.includes('resource busy') || combined.includes('operation not permitted')
  if (isBusy) {
    log.warn('[safe-rebuild] rebuild skipped: .node файл заблокирован (видимо запущен `npm run dev`).')
    log.warn('[safe-rebuild] sqlite-тесты могут падать с NODE_MODULE_VERSION mismatch.')
    log.warn('[safe-rebuild] Закрой Electron-приложение и запусти ещё раз — тогда rebuild пройдёт.')
  } else {
    log.warn(`[safe-rebuild] rebuild failed (exit ${res.status}), пропускаю и продолжаю.`)
    if (res.stderr) log.warn(String(res.stderr).slice(0, 400))
  }
  return { status: 'failed', rebuilt: false }
}

module.exports = { ensureNodeAbi }

// CLI-режим (npm pretest) — выполнить и всегда выйти 0, чтобы не блокировать тесты.
if (require.main === module) {
  ensureNodeAbi({ log: console })
  process.exit(0)
}
