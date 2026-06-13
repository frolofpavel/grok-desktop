import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Native deps that must stay external in Electron builds.
// They either contain native bindings or depend on CommonJS runtime paths.
const NATIVE_DEPS = [
  'electron',
  'better-sqlite3',
  'node-pty',
  '@homebridge/node-pty-prebuilt-multiarch',
  'openai'
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['electron'] })],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'electron/main.ts'),
        external: NATIVE_DEPS
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ include: ['electron'] })],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload.ts'),
        external: ['electron']
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'index.html') }
    },
    plugins: [react()]
  }
})
