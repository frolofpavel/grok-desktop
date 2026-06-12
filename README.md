# Grok Desktop

**The desktop experience for Grok and Grok Build.**

Local-first, high-control AI coding agent and product surface built exclusively for Grok models and the official Grok Build CLI.

![Grok Desktop main interface](assets/screenshots/main-chat.png)
![Provider switching between Grok API and Grok Build](assets/screenshots/provider-switch.png)
![Built-in terminal with error detection and "Fix in chat"](assets/screenshots/terminal-fix.png)
![Artifacts with live HTML and chart previews](assets/screenshots/artifacts.png)

Grok Desktop gives power users and developers a rich native interface on top of Grok — while staying deeply compatible with the terminal-first Grok Build workflow.

## Why a desktop client for Grok?

Grok and Grok Build are incredibly powerful. But many developers want more than the web chat or pure CLI:

- Persistent multi-chat workspaces with project context
- Fine-grained control over agent behavior (5 explicit modes: Ask / Accept-edits / Plan / Auto / Bypass)
- Rich artifacts (generated HTML, DOCX, SVG charts) with immediate preview
- Native terminal + automatic error detection that turns terminal failures into chat fixes
- First-class skills system (your `~/.claude/skills/` and `~/.verstak/skills/` become agent capabilities)
- Local SQLite storage — your chats, memory, undo history, and audit logs never leave your machine
- Strong security model (path sandboxing, secret redaction, command policy, mode gates)

Grok Desktop is designed as a companion and power layer for Grok users who spend serious time building with Grok.

## Two first-class providers

| Provider      | Transport       | Best for                          |
|---------------|-----------------|-----------------------------------|
| **Grok API**  | xAI REST (grok-4, grok-4-fast, grok-3) | Rich tool calling, long context, artifacts, vision via browser tools |
| **Grok Build**| Official CLI (`grok`) | Terminal-native workflows, direct integration with your existing Grok Build sessions |

You can switch per chat or per project. Grok Desktop was built with Grok Build in mind from day one.

## Core capabilities

- **5 agent modes** (1–5 keys) — from strict "ask every time" to full autonomy.
- **Session checkpoints + per-file undo** — one-click rollback of an entire agent session or individual files.
- **Skills as first-class citizens** — frontmatter `.md` files auto-loaded from standard locations + built-in. Slash commands in composer.
- **Powerful toolset** — `read_file`, `apply_patch` (preferred), `propose_edits`, `search_project`, `get_project_map`, `run_command`, browser tools (navigate/screenshot/read), connectors (GitHub, SSH, HTTP), MCP tools.
- **Context engineering** — project map, recent writes, sliding window compaction for long sessions, core memory (MEMORY.md / USER.md).
- **Cost & effort control** — per-message estimates, status bar totals, effort levels (quick/standard/deep).
- **Security & transparency** — path-policy (symlink-safe), secret scanner, command classification, full audit log, no telemetry.
- **Built-in terminal** with sidecar intelligence (error detection → "Fix in chat").
- **Artifacts** — `generate_html`, `generate_docx`, `render_chart` (SVG) with embedded live previews.

## Project rules integration (the meta part)

Grok Desktop automatically discovers and respects project rules files in the order:
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.verstak/RULES.md`

The loaded content becomes part of the agent's system prompt (user layer) on top of the immutable execution protocol. This project itself ships with both `AGENTS.md` and `CLAUDE.md` so the agent follows the same discipline when working inside the Grok Desktop codebase.

## Quick start

```bash
git clone https://github.com/frolofpavel/grok-desktop
cd grok-desktop
npm install --legacy-peer-deps
npm run dev
```

Then:
1. Open Settings and add your `XAI_API_KEY`, or
2. Select "Grok Build" if you already have the official `grok` CLI installed and authenticated.

Production builds:

```bash
npm run dist:win     # NSIS installer + portable .exe
```

Before committing any changes: `npm run type && npm run test:fast` must pass.

## Commands

| Command          | Description                              |
|------------------|------------------------------------------|
| `npm run dev`    | Development with HMR                     |
| `npm run build`  | Production bundle → `out/`               |
| `npm run type`   | TypeScript check                         |
| `npm run test:fast` | Fast tests (skips native rebuild)     |
| `npm run dist:win` | Windows installer + portable          |

## History

This project evolved from early experiments under the name **Verstak** (a multi-provider desktop agent platform). It has since been refocused exclusively on Grok and Grok Build:

- Grok-only provider surface
- Deep integration with the official Grok Build CLI
- Strong emphasis on product quality, safety, and developer control

Old repository (first version): https://github.com/frolofpavel/verstak

## Stack

Electron 40 · React 19 · TypeScript · Zustand · better-sqlite3 · Vite · node-pty + xterm.js · docx · exceljs

## Security notes

See `SECURITY-NOTES.md` for known limitations and the full defense-in-depth model (path policy, secret scanning, mode policy, command policy, renderer isolation).

## License

MIT — see [LICENSE](LICENSE).

## Status & vision

Grok Desktop is an independent project built to explore what a high-quality, local-first desktop product surface for Grok could look like.

It is not affiliated with xAI. The goal is to ship something useful for people who live in Grok and Grok Build every day — and to demonstrate what is possible when you build directly on their models and CLI.

Feedback, ideas, and collaboration welcome.

---

**Built with respect for the Grok product direction and the developers who use it daily.**
