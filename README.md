# Grok Desktop

Desktop AI coding agent for Grok (xAI). Electron + TypeScript + React, local-first: your API key, your machine, no cloud account.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> TODO: replace the app icon in `resources/` (still the old Verstak icon).

---

## What is it

Grok Desktop is a desktop AI coding assistant built around Grok models. Two providers:

| Provider | Transport | Needs |
|---|---|---|
| **Grok API** | xAI REST API | `XAI_API_KEY` (Settings) |
| **Grok Build** | CLI (`grok` binary) | installed + logged-in CLI |

Project context, chat history and memory are stored locally in SQLite.

## Features

- **5 agent modes** — `ask` / `accept-edits` / `plan` / `auto` / `bypass`, switched with keys 1–5
- **Undo & checkpoints** — per-file undo stack + one-click rollback of a whole agent session
- **Skills** — frontmatter `.md` files become system prompts + tool allowlists; auto-import from `~/.claude/skills/` and `~/.verstak/skills/`, slash commands in the composer
- **Artifacts** — `generate_html` / `generate_docx` / `render_chart` (SVG) with embedded preview
- **Built-in terminal** (node-pty + xterm.js) with error detection → "Fix in chat"
- **Cost controller** — token/cost estimate per send, status-bar totals
- **Persistent memory** — core memory (`MEMORY.md`/`USER.md`), archival facts, conversation search
- **Connectors** — GitHub, SSH executor, generic HTTP API
- **Security** — secret scanner (`[REDACTED:type]`), path policy blocking `.env`/keys/creds, no telemetry

## Quick Start

```bash
git clone <repo-url>
cd grok-desktop
npm install --legacy-peer-deps
npm run dev
```

Open Settings, paste your xAI API key — or select Grok Build if the `grok` CLI is on your PATH.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev mode with HMR |
| `npm run build` | Production bundle → `out/` |
| `npm run type` | `tsc --noEmit` |
| `npm run test:fast` | Vitest (skip native rebuild) |
| `npm run test` | Rebuild better-sqlite3 + Vitest |
| `npm run dist:win` | NSIS + portable `.exe` |

Before committing: `npm run type && npm run test:fast` must pass.

## Stack

Electron 40 · React 19 · TypeScript · Zustand · better-sqlite3 · Vite · node-pty · xterm.js

## License

MIT
