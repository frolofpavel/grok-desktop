/**
 * Минимальный YAML-frontmatter parser для скиллов.
 *
 * Зачем своя реализация а не пакет: скиллы — критичная функция, не хочется
 * тащить yaml/gray-matter и обновлять зависимости. Поддерживаем подмножество
 * YAML которое реально встречается в .md файлах скиллов:
 *   - string / number / boolean скаляры
 *   - массивы строк (block list `- foo`)
 *   - вложенные объекты (1 уровень depth, для context_loaders)
 *   - комментарии (#) игнорируются
 *
 * НЕ поддерживаем: anchors, multiline scalars кроме литералов, JSON-flow style.
 * Если у скилла сложный frontmatter — упадёт явной ошибкой, скилл не загрузится.
 */

export interface ParsedDoc {
  frontmatter: Record<string, unknown>
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseSkillDoc(raw: string): ParsedDoc {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) {
    return { frontmatter: {}, body: raw.trim() }
  }
  const yamlPart = m[1]
  const body = raw.slice(m[0].length).trim()
  const frontmatter = parseYamlSubset(yamlPart)
  return { frontmatter, body }
}

/**
 * Минимальный YAML parser. Работает построчно с отслеживанием indent для
 * массивов и вложенных объектов.
 */
function parseYamlSubset(src: string): Record<string, unknown> {
  const lines = src.split(/\r?\n/)
  const out: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) { i++; continue }

    const indent = line.length - line.trimStart().length
    if (indent > 0) { i++; continue } // skip orphan child lines at top level

    // key: value | key:
    const kv = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) { i++; continue }
    const key = kv[1]
    const rawValue = kv[2].trim()

    if (rawValue === '') {
      // Multi-line — следующая строка с большим indent это array или object
      const childLines: string[] = []
      const baseIndent = indent
      let j = i + 1
      while (j < lines.length) {
        const cl = lines[j]
        const ct = cl.trim()
        if (!ct || ct.startsWith('#')) { j++; continue }
        const ci = cl.length - cl.trimStart().length
        if (ci <= baseIndent) break
        childLines.push(cl)
        j++
      }
      out[key] = parseChildren(childLines)
      i = j
    } else {
      out[key] = parseScalarOrInline(rawValue)
      i++
    }
  }
  return out
}

/** Парсит блок дочерних строк: либо массив, либо объект, либо вложенный массив объектов. */
function parseChildren(lines: string[]): unknown {
  if (lines.length === 0) return null
  const firstTrimmed = lines[0].trim()
  if (firstTrimmed.startsWith('- ')) {
    // Массив: либо строк, либо объектов (если внутри есть key:)
    const items: unknown[] = []
    let current: string[] | null = null
    let currentIndent = 0
    for (const line of lines) {
      const trimmed = line.trim()
      const indent = line.length - line.trimStart().length
      if (trimmed.startsWith('- ')) {
        // Завершить предыдущий элемент
        if (current) items.push(parseObjectLines(current))
        current = null
        const itemBody = trimmed.slice(2).trim()
        if (itemBody.includes(':') && itemBody.match(/^[A-Za-z_][\w-]*\s*:/)) {
          // Это начало объекта: `- id: foo`. Добавляем как первую строку нового объекта.
          current = [itemBody]
          currentIndent = indent + 2
        } else {
          items.push(parseScalarOrInline(itemBody))
        }
      } else if (current && indent >= currentIndent) {
        current.push(line.slice(currentIndent))
      }
    }
    if (current) items.push(parseObjectLines(current))
    return items
  }
  // Объект
  return parseObjectLines(lines)
}

function parseObjectLines(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) { i++; continue }
    const kv = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) { i++; continue }
    const key = kv[1]
    const rawValue = kv[2].trim()
    if (rawValue === '') {
      // Nested children — собираем по indent
      const baseIndent = line.length - line.trimStart().length
      const children: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const cl = lines[j]
        const ct = cl.trim()
        if (!ct) { j++; continue }
        const ci = cl.length - cl.trimStart().length
        if (ci <= baseIndent) break
        children.push(cl.slice(baseIndent + 2))
        j++
      }
      out[key] = parseChildren(children)
      i = j
    } else {
      out[key] = parseScalarOrInline(rawValue)
      i++
    }
  }
  return out
}

function parseScalarOrInline(value: string): unknown {
  // Inline массив: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(s => parseScalar(s.trim()))
  }
  return parseScalar(value)
}

function parseScalar(value: string): unknown {
  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~' || value === '') return null
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
  return value
}
