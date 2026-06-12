/**
 * Реестр context loaders для скиллов.
 *
 * Каждый loader = функция которая по запросу скилла подгружает данные
 * (текущая дата, project_map, ...) и возвращает
 * markdown который инжектится в первое user сообщение нового чата.
 *
 * Источник: V3 Plan раздел 6.4.
 *
 * Лоадеры референсятся из frontmatter скилла:
 *   context_loaders:
 *     - id: today_brief
 *       impl: load_today_brief
 *       runs_on: always
 *
 * Здесь регистрируется implementation по имени.
 */

export interface LoaderContext {
  /** Аргумент slash-команды если она была: `/dossier alfa` → arg='alfa'. */
  arg?: string
  /** Текущий project root если есть. */
  projectPath: string | null
  /** Settings reader для лоадеров которые лезут в credentials. */
  getSecret?: (key: string) => string | null
}

export interface LoaderResult {
  /** Markdown который попадёт в первое user-message в чате. */
  markdown: string
  /** Опционально — короткий лейбл для Timeline pill «🧠 контекст: {label}». */
  label?: string
}

export type ContextLoader = (ctx: LoaderContext) => Promise<LoaderResult | null>

// ============================================================================
// Реестр
// ============================================================================

const REGISTRY: Record<string, ContextLoader> = {
  load_today_brief
}

export function lookupLoader(impl: string): ContextLoader | null {
  return REGISTRY[impl] ?? null
}

export function listLoaders(): string[] {
  return Object.keys(REGISTRY)
}

// ============================================================================
// Реализации лоадеров — без external creds, работают сразу
// ============================================================================

/**
 * load_today_brief — простая дата + день недели как orientation marker.
 * Агент знает «сегодня пятница 23 мая, рабочий день».
 */
async function load_today_brief(ctx: LoaderContext): Promise<LoaderResult | null> {
  void ctx
  const now = new Date()
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  const dayOfWeek = days[now.getDay()]
  const dateStr = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const isWeekend = now.getDay() === 0 || now.getDay() === 6
  return {
    markdown: `## 📅 Сейчас\n\n**${dayOfWeek}, ${dateStr}, ${time}**\n${isWeekend ? '_Выходной день._' : '_Рабочий день._'}`,
    label: dayOfWeek
  }
}
