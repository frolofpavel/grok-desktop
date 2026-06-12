/**
 * Single source of truth for the active project path in the main process.
 * Used by IPC handlers that need to enforce path boundaries (files:read,
 * AI tools, command execution).
 *
 * Mutated only by the projects:set-current IPC, which is invoked by the
 * renderer whenever the user opens / switches a project.
 */

let activeProjectPath: string | null = null

export function getActiveProjectPath(): string | null {
  return activeProjectPath
}

export function setActiveProjectPath(path: string | null): void {
  activeProjectPath = path && path.trim() ? path : null
}
