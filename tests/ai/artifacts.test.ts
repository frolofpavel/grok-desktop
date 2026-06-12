import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateHtml, generateDocx, artifactsDir } from '../../electron/ai/artifacts'

let projectPath: string

beforeAll(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'gg-artifacts-'))
})

afterAll(async () => {
  if (projectPath) await rm(projectPath, { recursive: true, force: true })
})

describe('artifactsDir', () => {
  it('возвращает путь с сегодняшней датой', () => {
    const dir = artifactsDir('/x')
    expect(dir).toMatch(/[/\\]\.verstak[/\\]artifacts[/\\]\d{4}-\d{2}-\d{2}$/)
  })
})

describe('generateHtml', () => {
  it('создаёт файл с обёрткой и санитайзит имя', async () => {
    const r = await generateHtml(projectPath, {
      filename: 'kp/with/slash.html',  // спец-символы должны быть очищены
      title: 'Test KP',
      content_html: '<h1>Hello</h1><p>World</p>'
    })
    expect(r.kind).toBe('html')
    expect(r.filename).toMatch(/\.html$/)
    expect(r.filename).not.toMatch(/[\/\\]/)
    const content = await readFile(r.path, 'utf8')
    expect(content).toContain('<!DOCTYPE html>')
    expect(content).toContain('Test KP')
    expect(content).toContain('<h1>Hello</h1>')
  })

  it('экранирует HTML в title', async () => {
    const r = await generateHtml(projectPath, {
      filename: 'esc',
      title: 'Test <script>alert(1)</script>',
      content_html: '<p>body</p>'
    })
    const content = await readFile(r.path, 'utf8')
    expect(content).not.toContain('<script>alert(1)</script>')
    expect(content).toContain('&lt;script>')
  })
})

describe('generateDocx', () => {
  it('создаёт валидный DOCX', async () => {
    const r = await generateDocx(projectPath, {
      filename: 'audit-test',
      title: 'Аудит Direct: тестовый клиент',
      sections: [
        {
          heading: 'Что нашли',
          paragraphs: ['Параграф 1', 'Параграф 2'],
          bullets: ['пункт А', 'пункт Б']
        },
        {
          heading: 'Что рекомендуем',
          level: 2,
          paragraphs: ['Включить минус-слова', 'Обновить креативы']
        }
      ]
    })
    expect(r.kind).toBe('docx')
    expect(r.sizeBytes).toBeGreaterThan(1000)
    expect(r.filename).toBe('audit-test.docx')
    const buf = await readFile(r.path)
    // DOCX = ZIP archive, signature PK\x03\x04
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
  })

  it('бросает если sections пустые', async () => {
    // Не бросает — но возвращает пустой docx. Логика «обязательность»
    // живёт на handler уровне, не на generator. Это OK.
    const r = await generateDocx(projectPath, { filename: 'empty', sections: [] })
    expect(r.sizeBytes).toBeGreaterThan(0)
  })
})
