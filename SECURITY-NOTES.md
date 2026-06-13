# Security Notes - Grok Desktop

Grok Desktop is a local-first desktop agent. This document lists the current
security model, known limitations, and issues already closed.

## Current Scope

Grok Desktop intentionally exposes only two AI providers:

- **Grok API** through xAI's OpenAI-compatible API (`https://api.x.ai/v1`)
- **Grok Build** through the official local `grok` CLI

No legacy multi-provider API integrations are active in the app.

## Active Protections

- **Renderer isolation:** `nodeIntegration: false`, `contextIsolation: true`.
- **Production CSP:** packaged builds install a restrictive renderer CSP.
- **Path policy:** file access goes through `safeRealJoin()` to prevent symlink/path escape.
- **Forbidden secret paths:** `.env`, `*.key`, `creds*.json`, and private key paths are blocked from file tools.
- **Secret scanner:** API keys and common tokens are redacted before being placed in logs/context.
- **Mode policy:** file writes, command execution, and connector calls are gated by the active agent mode.
- **Command policy:** dangerous shell commands are classified and blocked consistently for local and SSH execution.
- **Audit log:** agent actions are written to a local audit log for inspection.
- **Local storage:** chats, memories, undo history, and audit logs are stored locally in SQLite.
- **No telemetry:** the app does not send usage telemetry.

## Known Limitations

- **Grok API transport trust:** API calls rely on Node/Electron's default TLS trust store. No certificate pinning is implemented.
- **Grok Build CLI trust boundary:** when using the official `grok` CLI provider, Grok Desktop delegates execution to the locally installed CLI and its authenticated session.
- **Preload sandbox trade-off:** Electron renderer sandbox is disabled because the preload is ESM. The app keeps `contextIsolation` on and `nodeIntegration` off.
- **MCP/tool risk depends on configuration:** user-added MCP servers can expose write, command, or network tools. The MCP settings UI classifies tool scope, but users should only enable trusted servers.
- **Local machine boundary:** a compromised local user account can read local app data, project files, and the SQLite database outside the app.

## Closed Issues

Closed during the 2026-06 hardening pass:

- SSH `venv` argument shell injection path fixed with quoting.
- SSH command denylist aligned with the local `run_command` classifier.
- `connector_query` now follows the same mode-policy gate as command execution.

## Show-Ready Checklist

Before publishing or demoing a release:

```bash
npm run type
npm run build
npm run test:fast
```

If `test:fast` fails with a `better-sqlite3` `NODE_MODULE_VERSION` mismatch, close the running Electron app and rerun the command so the native module can rebuild for Node.
