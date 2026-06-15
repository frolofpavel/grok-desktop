import { projectIconSrc } from '../lib/project-icon'
import type { ProjectMeta } from '../types/api'

function initial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '·'
}

export function ProjectAvatar({
  project,
  className = 'gg-rail-square',
  size
}: {
  project: Pick<ProjectMeta, 'name' | 'color' | 'iconPath'>
  className?: string
  size?: number
}) {
  const iconSrc = projectIconSrc(project.iconPath)
  const style = size
    ? { width: size, height: size, ...(iconSrc ? {} : { background: project.color }) }
    : iconSrc
      ? undefined
      : { background: project.color }

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        className={`${className} gg-project-avatar-img`}
        style={style}
        draggable={false}
      />
    )
  }

  return (
    <span className={className} style={style} aria-hidden>
      {initial(project.name)}
    </span>
  )
}