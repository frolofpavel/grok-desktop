import { describe, it, expect } from 'vitest'
import { diffSections, diffLines, sectionMap } from '../../src/lib/context-diff'

const sys = (parts: { user?: string; ctx?: string; skill?: string }) =>
  [
    '<verstak_system_layer>\nПротокол агента\n</verstak_system_layer>',
    parts.user !== undefined ? `<user_layer>\n${parts.user}\n</user_layer>` : '',
    parts.ctx !== undefined ? `<context_pack>\n${parts.ctx}\n</context_pack>` : '',
    parts.skill !== undefined ? `<skill_layer>\n${parts.skill}\n</skill_layer>` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

describe('sectionMap', () => {
  it('maps each named layer to its text', () => {
    const m = sectionMap({ systemPrompt: sys({ user: 'правила', ctx: 'контекст' }), userMessage: 'привет' })
    expect(m.get('Системный слой')).toContain('Протокол агента')
    expect(m.get('Правила проекта')).toBe('правила')
    expect(m.get('Контекст-пак')).toBe('контекст')
    expect(m.get('Сообщение пользователя')).toBe('привет')
  })
})

describe('diffSections', () => {
  it('marks identical inputs as same across all sections', () => {
    const a = { systemPrompt: sys({ user: 'правила', ctx: 'данные' }), userMessage: 'вопрос' }
    const diffs = diffSections(a, a)
    expect(diffs.every(d => d.status === 'same')).toBe(true)
  })

  it('marks a changed section and reports char delta', () => {
    const a = { systemPrompt: sys({ user: 'правила V2 новые' }), userMessage: 'вопрос' }
    const b = { systemPrompt: sys({ user: 'правила' }), userMessage: 'вопрос' }
    const diffs = diffSections(a, b)
    const rules = diffs.find(d => d.label === 'Правила проекта')!
    expect(rules.status).toBe('changed')
    expect(rules.addedChars).toBeGreaterThan(0)
  })

  it('detects added (present in A, absent in B) sections', () => {
    const a = { systemPrompt: sys({ ctx: 'свежий контекст' }), userMessage: 'вопрос' }
    const b = { systemPrompt: sys({}), userMessage: 'вопрос' }
    const diffs = diffSections(a, b)
    const ctx = diffs.find(d => d.label === 'Контекст-пак')!
    expect(ctx.status).toBe('added')
    expect(ctx.charsB).toBeNull()
    expect(ctx.addedChars).toBe('свежий контекст'.length)
  })

  it('detects removed (absent in A, present in B) sections', () => {
    const a = { systemPrompt: sys({}), userMessage: 'вопрос' }
    const b = { systemPrompt: sys({ skill: 'скилл код-ревью' }), userMessage: 'вопрос' }
    const diffs = diffSections(a, b)
    const skill = diffs.find(d => d.label === 'Скилл')!
    expect(skill.status).toBe('removed')
    expect(skill.charsA).toBeNull()
    expect(skill.removedChars).toBe('скилл код-ревью'.length)
  })

  it('reflects user message changes', () => {
    const a = { systemPrompt: sys({}), userMessage: 'первый вопрос' }
    const b = { systemPrompt: sys({}), userMessage: 'другой вопрос' }
    const diffs = diffSections(a, b)
    const msg = diffs.find(d => d.label === 'Сообщение пользователя')!
    expect(msg.status).toBe('changed')
  })
})

describe('diffLines', () => {
  it('returns same lines for identical text', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(lines.every(l => l.type === 'same')).toBe(true)
    expect(lines.map(l => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('reports added and removed lines via LCS', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc')
    const removed = lines.filter(l => l.type === 'remove').map(l => l.text)
    const added = lines.filter(l => l.type === 'add').map(l => l.text)
    expect(removed).toContain('b')
    expect(added).toContain('x')
    // shared lines preserved
    expect(lines.filter(l => l.type === 'same').map(l => l.text)).toEqual(['a', 'c'])
  })
})
