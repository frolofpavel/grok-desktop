/** Safe renderer URL for a project icon file on disk (custom Electron protocol). */
export function projectIconSrc(iconPath: string | null | undefined): string | null {
  if (!iconPath) return null
  return `gg-project-icon://local/${encodeURIComponent(iconPath)}`
}