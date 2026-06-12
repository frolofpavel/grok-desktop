import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import ExcelJS from 'exceljs'
import { readSpreadsheet, editSpreadsheet } from '../../electron/ai/office'

let projectPath: string

// Создаёт крошечный .xlsx с одним листом для round-trip теста.
async function writeFixture(rel: string, sheetName: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.addRow(['Клиент', 'Сумма'])
  ws.addRow(['Альфа', 1000])
  ws.addRow(['Бета', 2000])
  await wb.xlsx.writeFile(join(projectPath, rel))
}

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'gg-office-'))
})

afterEach(async () => {
  if (projectPath) await rm(projectPath, { recursive: true, force: true })
})

describe('readSpreadsheet', () => {
  it('возвращает имя листа и строки таблицей', async () => {
    await writeFixture('data.xlsx', 'Отчёт')
    const text = await readSpreadsheet(projectPath, 'data.xlsx')
    expect(text).toContain('Лист: Отчёт')
    expect(text).toContain('| Клиент | Сумма |')
    expect(text).toContain('Альфа')
    expect(text).toContain('1000')
  })

  it('блокирует выход за пределы проекта', async () => {
    await expect(readSpreadsheet(projectPath, '../secret.xlsx')).rejects.toThrow()
  })
})

describe('editSpreadsheet', () => {
  it('меняет ячейку и сохраняет — round trip', async () => {
    await writeFixture('data.xlsx', 'Sheet1')
    const res = await editSpreadsheet(projectPath, 'data.xlsx', 'Sheet1', [
      { cell: 'B2', value: '5555' },
      { cell: 'A2', value: 'Гамма' }
    ])
    expect(res.applied).toBe(2)
    expect(res.sheet).toBe('Sheet1')
    const text = await readSpreadsheet(projectPath, 'data.xlsx')
    expect(text).toContain('Гамма')
    expect(text).toContain('5555')
    expect(text).not.toContain('Альфа')
  })

  it('использует первый лист если sheet не задан', async () => {
    await writeFixture('data.xlsx', 'Первый')
    const res = await editSpreadsheet(projectPath, 'data.xlsx', undefined, [{ cell: 'A1', value: 'X' }])
    expect(res.sheet).toBe('Первый')
  })

  it('бросает на некорректной ссылке на ячейку', async () => {
    await writeFixture('data.xlsx', 'Sheet1')
    await expect(
      editSpreadsheet(projectPath, 'data.xlsx', 'Sheet1', [{ cell: 'not-a-cell', value: '1' }])
    ).rejects.toThrow()
  })

  it('бросает на несуществующем листе', async () => {
    await writeFixture('data.xlsx', 'Sheet1')
    await expect(
      editSpreadsheet(projectPath, 'data.xlsx', 'НетТакого', [{ cell: 'A1', value: '1' }])
    ).rejects.toThrow()
  })
})
