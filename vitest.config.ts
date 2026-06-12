import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Self-healing ABI better-sqlite3 (Node vs Electron) до старта воркеров.
    globalSetup: ['tests/global-setup.ts']
  }
})
