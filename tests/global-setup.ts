/**
 * Vitest globalSetup — self-healing ABI better-sqlite3 перед всеми тестами.
 *
 * Запускается один раз в Node-процессе vitest ДО старта воркеров. Если бинарь
 * better-sqlite3 собран под Electron ABI (после `npm run dev`), пересобирает его
 * под текущий Node ABI на диске — воркеры (отдельные процессы) подхватывают уже
 * правильный .node. Благодаря этому `npx vitest run` чинит себя сам, минуя
 * npm-pretest хук.
 *
 * Логика общая с scripts/safe-rebuild.cjs (CLI для npm pretest). Грузим через
 * нативный require, чтобы Vite не трансформировал .cjs и нативный require
 * better-sqlite3 отработал в том же ABI, что и тест-воркеры.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ensureNodeAbi } = require('../scripts/safe-rebuild.cjs') as {
  ensureNodeAbi: (opts?: { log?: Pick<Console, 'log' | 'warn'> }) => {
    status: 'ok' | 'rebuilt' | 'failed' | 'error'
    rebuilt: boolean
  }
}

export default function setup(): void {
  ensureNodeAbi({ log: console })
}
