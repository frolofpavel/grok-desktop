import type { Database } from 'better-sqlite3'
import { searchMemories } from '../storage/memories'

export interface Suggestion {
  title: string
  description: string
  source: 'memory' | 'journal' | 'pattern'
  priority: 'high' | 'medium' | 'low'
}

export function generateSuggestions(db: Database, projectPath: string): Suggestion[] {
  const suggestions: Suggestion[] = []

  // 1. Проверяем незавершённые задачи в журнале
  let journal: Array<{ title: string; detail: string | null }> = []
  try {
    journal = db.prepare(
      `SELECT title, detail FROM journal WHERE project_path = ? AND kind = 'session' ORDER BY created_at DESC LIMIT 5`
    ).all(projectPath) as Array<{ title: string; detail: string | null }>
  } catch { /* игнорируем — таблица может не существовать */ }

  for (const entry of journal) {
    if (entry.detail?.includes('TODO') || entry.detail?.includes('осталось') || entry.detail?.includes('remaining')) {
      suggestions.push({
        title: 'Continue: ' + entry.title.slice(0, 60),
        description: entry.detail?.slice(0, 150) ?? '',
        source: 'journal',
        priority: 'high'
      })
    }
  }

  // 2. Проверяем известные баги в памяти
  try {
    const bugs = searchMemories(db, projectPath, 'bug', 3)
    for (const mem of bugs) {
      suggestions.push({
        title: 'Known issue: ' + mem.content.slice(0, 60),
        description: mem.tags.join(', '),
        source: 'memory',
        priority: 'medium'
      })
    }
  } catch { /* память может быть недоступна */ }

  // 3. Проверяем паттерны в памяти
  try {
    const patterns = searchMemories(db, projectPath, 'pattern', 3)
    for (const mem of patterns) {
      suggestions.push({
        title: 'Pattern: ' + mem.content.slice(0, 60),
        description: mem.tags.join(', '),
        source: 'pattern',
        priority: 'low'
      })
    }
  } catch { /* память может быть недоступна */ }

  return suggestions.slice(0, 5)
}
