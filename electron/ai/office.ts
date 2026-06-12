/**
 * Office-файлы — чтение и точечная правка Excel (.xlsx) и чтение Word (.docx).
 * Это «beyond code» слой: агент работает не только с исходниками, но и с
 * клиентскими таблицами/документами (агентский wedge).
 *
 * Все пути проходят через safeRealJoin — выхода за пределы проекта нет.
 * Правка таблиц проходит через isForbiddenPath + mode-policy (как write_file).
 *
 * exceljs — для xlsx (read/modify/write). mammoth — для docx→текст (уже в deps).
 */

import { isForbiddenPath } from './secret-scanner'
import { safeRealJoin } from './path-policy'

// Лимиты вывода, чтобы большие листы не разносили контекст модели.
const MAX_ROWS = 200
const MAX_COLS = 40
const MAX_CELL_CHARS = 200
const MAX_DOC_CHARS = 40_000

/** Привести значение ячейки exceljs к читаемой строке. */
function cellToText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    // exceljs богатые типы: формула, hyperlink, rich text, дата, ошибка
    if ('result' in v && v.result != null) return String(v.result)
    if ('formula' in v) return `=${String(v.formula)}`
    if ('text' in v && v.text != null) return String(v.text)
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink)
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((r: { text?: string }) => r.text ?? '').join('')
    }
    if ('error' in v) return String(v.error)
    if (value instanceof Date) return value.toISOString().slice(0, 10)
  }
  return String(value)
}

function clampCell(s: string): string {
  const oneLine = s.replace(/\r?\n/g, ' ').trim()
  return oneLine.length > MAX_CELL_CHARS ? oneLine.slice(0, MAX_CELL_CHARS) + '…' : oneLine
}

/**
 * Прочитать .xlsx и вернуть содержимое всех листов как текст:
 * имя листа + строки в markdown-подобной таблице. Большие листы обрезаются
 * с пометкой.
 */
export async function readSpreadsheet(projectPath: string, relPath: string): Promise<string> {
  if (isForbiddenPath(relPath)) {
    throw new Error(`Доступ запрещён политикой безопасности: ${relPath} (secrets/credentials)`)
  }
  const abs = await safeRealJoin(projectPath, relPath)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs') as typeof import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(abs)

  const out: string[] = []
  wb.eachSheet((sheet) => {
    out.push(`### Лист: ${sheet.name}`)
    const totalRows = sheet.rowCount
    const totalCols = sheet.columnCount
    if (totalRows === 0 || totalCols === 0) {
      out.push('(пустой лист)')
      out.push('')
      return
    }
    const cols = Math.min(totalCols, MAX_COLS)
    const rows = Math.min(totalRows, MAX_ROWS)
    for (let r = 1; r <= rows; r++) {
      const row = sheet.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= cols; c++) {
        cells.push(clampCell(cellToText(row.getCell(c).value)))
      }
      out.push('| ' + cells.join(' | ') + ' |')
    }
    const notes: string[] = []
    if (totalRows > MAX_ROWS) notes.push(`строки обрезаны: показано ${rows} из ${totalRows}`)
    if (totalCols > MAX_COLS) notes.push(`столбцы обрезаны: показано ${cols} из ${totalCols}`)
    if (notes.length > 0) out.push(`_(${notes.join('; ')})_`)
    out.push('')
  })

  if (out.length === 0) return '(в книге нет листов)'
  return out.join('\n')
}

/**
 * Прочитать .docx и вернуть простой текст (mammoth extractRawText).
 * Обрезается по MAX_DOC_CHARS.
 */
export async function readDocument(projectPath: string, relPath: string): Promise<string> {
  if (isForbiddenPath(relPath)) {
    throw new Error(`Доступ запрещён политикой безопасности: ${relPath} (secrets/credentials)`)
  }
  const abs = await safeRealJoin(projectPath, relPath)
  // mammoth уже в зависимостях (ArtifactPreview / convert_file)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as { extractRawText: (opts: { path: string }) => Promise<{ value: string }> }
  const res = await mammoth.extractRawText({ path: abs })
  const text = res.value ?? ''
  return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + '\n…(документ обрезан)' : text
}

export interface CellEdit { cell: string; value: string }

/**
 * Записать значения в ячейки .xlsx (read → modify → write).
 * sheet — имя листа; если не задан — первый лист.
 * edits — массив { cell: "B2", value: "..." }.
 * Возвращает количество применённых правок.
 *
 * Внимание: это WRITE-операция. Вызывающий слой (tool-handler) обязан провести
 * её через mode-policy подтверждение, как write_file.
 */
export async function editSpreadsheet(
  projectPath: string,
  relPath: string,
  sheetName: string | undefined,
  edits: CellEdit[]
): Promise<{ applied: number; sheet: string }> {
  if (isForbiddenPath(relPath)) {
    throw new Error(`Запись запрещена политикой безопасности: ${relPath}`)
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('edit_spreadsheet: edits обязателен и не должен быть пустым')
  }
  const abs = await safeRealJoin(projectPath, relPath)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs') as typeof import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(abs)

  const sheet = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0]
  if (!sheet) {
    const names = wb.worksheets.map(s => s.name).join(', ')
    throw new Error(`edit_spreadsheet: лист "${sheetName}" не найден. Доступные: ${names}`)
  }

  let applied = 0
  for (const edit of edits) {
    const ref = String(edit.cell ?? '').trim()
    if (!/^[A-Za-z]{1,3}[1-9][0-9]*$/.test(ref)) {
      throw new Error(`edit_spreadsheet: некорректная ссылка на ячейку "${ref}" (ожидалось напр. "B2")`)
    }
    // Числа сохраняем числами, остальное — строкой
    const raw = edit.value
    const num = typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw)) ? Number(raw) : null
    sheet.getCell(ref).value = num !== null ? num : String(raw ?? '')
    applied++
  }

  await wb.xlsx.writeFile(abs)
  return { applied, sheet: sheet.name }
}
