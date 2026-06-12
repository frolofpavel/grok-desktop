/**
 * Context Diff — сравнение входов двух агентных запусков по слоям.
 *
 * Берёт две пары (systemPrompt, userMessage), бьёт каждую на именованные секции
 * через splitIntoSections (общий сплиттер из context-budget.ts) и для каждой
 * секции выдаёт статус: без изменений / изменился / добавлен / удалён.
 *
 * Renderer-only, чистая логика, без зависимостей и тяжёлых diff-библиотек.
 */

import { splitIntoSections } from './context-budget'

export type SectionDiffStatus = 'same' | 'changed' | 'added' | 'removed'

/** Один шаг построчного диффа. */
export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}

/** Дифф одной секции между запусками A (текущий) и B (сравниваемый). */
export interface SectionDiff {
  label: string
  status: SectionDiffStatus
  /** Длина секции в запуске A (символы), null если секции в A нет. */
  charsA: number | null
  /** Длина секции в запуске B (символы), null если секции в B нет. */
  charsB: number | null
  /** Символьная дельта A относительно B: добавлено/удалено. */
  addedChars: number
  removedChars: number
}

export interface RunInputLite {
  systemPrompt: string
  userMessage: string
}

/** Карта label → текст секции для одного входа (для построчной детализации). */
export function sectionMap(input: RunInputLite): Map<string, string> {
  return new Map(splitIntoSections(input.systemPrompt, input.userMessage).map(s => [s.label, s.text]))
}

/**
 * Сравнивает две секции и возвращает per-section статусы. A — «текущий» запуск,
 * B — «сравниваемый». Порядок секций — как в A, затем секции, что есть только в B
 * (статус removed: были в B, исчезли в A).
 */
export function diffSections(a: RunInputLite, b: RunInputLite): SectionDiff[] {
  const secA = new Map(splitIntoSections(a.systemPrompt, a.userMessage).map(s => [s.label, s.text]))
  const secB = new Map(splitIntoSections(b.systemPrompt, b.userMessage).map(s => [s.label, s.text]))

  const labels: string[] = []
  for (const label of secA.keys()) labels.push(label)
  for (const label of secB.keys()) if (!secA.has(label)) labels.push(label)

  const result: SectionDiff[] = []
  for (const label of labels) {
    const textA = secA.get(label) ?? null
    const textB = secB.get(label) ?? null

    let status: SectionDiffStatus
    if (textA !== null && textB === null) status = 'added'
    else if (textA === null && textB !== null) status = 'removed'
    else if (textA === textB) status = 'same'
    else status = 'changed'

    // Дельта символов считается построчно, чтобы цифры совпадали с line-diff.
    let addedChars = 0
    let removedChars = 0
    if (status === 'added') addedChars = (textA ?? '').length
    else if (status === 'removed') removedChars = (textB ?? '').length
    else if (status === 'changed') {
      for (const line of diffLines(textB ?? '', textA ?? '')) {
        if (line.type === 'add') addedChars += line.text.length
        else if (line.type === 'remove') removedChars += line.text.length
      }
    }

    result.push({
      label,
      status,
      charsA: textA === null ? null : textA.length,
      charsB: textB === null ? null : textB.length,
      addedChars,
      removedChars
    })
  }

  return result
}

/**
 * Лёгкий построчный дифф через LCS. `from` — старая версия (запуск B),
 * `to` — новая (запуск A). Строки из `to`, которых нет в LCS — add;
 * строки из `from`, которых нет в LCS — remove.
 */
export function diffLines(from: string, to: string): DiffLine[] {
  const a = from.split('\n')
  const b = to.split('\n')
  const n = a.length
  const m = b.length

  // Таблица длин LCS.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'remove', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })

  return out
}
