import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildCliPrompt, fitCliPayloadToArgvCap, wrapCurrentUserRequest } from '../../electron/ai/cli-prompt'
import type { ChatMessage } from '../../electron/ai/types'

describe('buildCliPrompt', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gg-cli-'))
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"vitest"}}')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('grok-cli: пробрасывает полный system_layer', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(out).toContain('verstak_system_layer')
  })

  it('включает context_pack с verify_scripts когда package.json есть', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{ role: 'user', content: 'q' }]
    })
    expect(out).toContain('context_pack')
    expect(out).toContain('verify_scripts')
  })

  it('сериализует историю предыдущих turns', async () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'первый вопрос' },
      { role: 'assistant', content: 'первый ответ' },
      { role: 'user', content: 'второй вопрос' }
    ]
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: msgs
    })
    expect(out).toContain('conversation_history')
    expect(out).toContain('[USER]: первый вопрос')
    expect(out).toContain('[ASSISTANT]: первый ответ')
    // Last user message is wrapped and goes at the end, NOT inside history
    expect(out).toContain('<current_user_request>')
    expect(out).toContain('второй вопрос')
    expect(out.endsWith('</current_user_request>')).toBe(true)
  })

  it('помечает attachments если они есть', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{
        role: 'user', content: 'посмотри',
        attachments: [{ name: 'img.png', mimeType: 'image/png', data: 'xxx', size: 100 }]
      }]
    })
    expect(out).toContain('img.png')
    expect(out).toMatch(/CLI не видит содержимое/)
  })

  it('пробрасывает recent_writes в context_pack', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{ role: 'user', content: 'q' }],
      recentWrites: [{ filePath: 'src/foo.ts', createdAt: Date.now() }]
    })
    expect(out).toContain('recent_writes')
    expect(out).toContain('src/foo.ts')
  })

  it('бросает понятную ошибку если нет user-сообщения', async () => {
    await expect(buildCliPrompt({
      providerId: 'grok-cli', projectPath: dir,
      messages: [{ role: 'assistant', content: 'hi' }]
    })).rejects.toThrow(/нет user/)
  })

  // Регрессия: skill-промпт раньше терялся для CLI-провайдеров (приходил как
  // role:system и фильтровался) — Grok Build не видел активный скилл.
  // Теперь он наслаивается секцией <skill_layer>.
  it('grok-cli: skillPrompt попадает в <skill_layer>', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{ role: 'user', content: 'q' }],
      skillPrompt: 'Ты эксперт по рекламе. Анализируй кабинеты.'
    })
    expect(out).toContain('<skill_layer>')
    expect(out).toContain('эксперт по рекламе')
  })

  it('без skillPrompt — нет секции <skill_layer>', async () => {
    const out = await buildCliPrompt({
      providerId: 'grok-cli',
      projectPath: dir,
      messages: [{ role: 'user', content: 'q' }]
    })
    expect(out).not.toContain('<skill_layer>')
  })
})

describe('fitCliPayloadToArgvCap', () => {
  it('сохраняет текущий user turn при обрезке head', () => {
    const head = 'A'.repeat(10_000)
    const user = 'второй вопрос пользователя'
    const payload = `${head}\n\n${wrapCurrentUserRequest(user)}`
    const fitted = fitCliPayloadToArgvCap(payload, 8000)
    expect(fitted).toContain('второй вопрос пользователя')
    expect(fitted).toContain('<current_user_request>')
    expect(fitted.length).toBeLessThanOrEqual(8000)
    expect(fitted).not.toMatch(/^A{8000}/)
  })

  it('не меняет payload если он уже влезает', () => {
    const payload = wrapCurrentUserRequest('короткий')
    expect(fitCliPayloadToArgvCap(payload, 8000)).toBe(payload)
  })
})
