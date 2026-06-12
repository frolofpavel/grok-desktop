import { describe, it, expect } from 'vitest'
import { recommendTier, detectPrivate, type ModelTier } from '../../electron/ai/tier-router'
import { PROVIDERS, type ProviderId } from '../../electron/ai/registry'
import type { ChatMessage } from '../../electron/ai/types'

// tier-router — чистая функция выбора тира модели. Эти тесты фиксируют контракт:
// simple→cheap, complex→frontier, private→RU, корректную деградацию и две
// инварианты безопасности (никогда не вернуть ненастроенного провайдера и
// никогда не вернуть фантомную модель).

const user = (content: string): ChatMessage => ({ role: 'user', content })

// Полный набор провайдеров — удобный «всё настроено».
const ALL: ProviderId[] = [
  'gemini-api', 'claude', 'openai', 'grok',
  'deepseek', 'ollama', 'groq', 'openrouter', 'mistral',
  'yandex-gpt', 'gigachat',
]

describe('tier-router recommendTier()', () => {
  describe('базовая классификация', () => {
    it('простой короткий вопрос → тир cheap', () => {
      const rec = recommendTier([user('what time is it?')], ALL)
      expect(rec?.tier).toBe('cheap')
    })

    it('сложная задача (несколько сигналов) → тир frontier', () => {
      const rec = recommendTier(
        [user('refactor and migrate this module, then implement tests')],
        ALL,
      )
      expect(rec?.tier).toBe('frontier')
    })

    it('длинный промпт (>500) → frontier', () => {
      const rec = recommendTier([user('x'.repeat(600))], ALL)
      expect(rec?.tier).toBe('frontier')
    })

    it('приватная задача (RU-хинт «приват») → тир private, RU-провайдер', () => {
      const rec = recommendTier([user('обработай приватные данные клиента')], ALL)
      expect(rec?.tier).toBe('private')
      expect(['yandex-gpt', 'gigachat']).toContain(rec?.providerId)
    })

    it('хинт «152» (152-ФЗ) → private', () => {
      const rec = recommendTier([user('требование 152 ФЗ по данным')], ALL)
      expect(rec?.tier).toBe('private')
    })

    it('явный флаг forcePrivate перебивает простоту → private', () => {
      const rec = recommendTier([user('hi')], ALL, { forcePrivate: true })
      expect(rec?.tier).toBe('private')
    })

    it('приватность важнее сложности: сложная + приватная → private', () => {
      const rec = recommendTier(
        [user('refactor and rewrite приватный модуль персональных данных')],
        ALL,
      )
      expect(rec?.tier).toBe('private')
    })
  })

  describe('деградация при ненастроенном тире', () => {
    it('private-задача без RU-провайдеров → деградация на frontier', () => {
      const configured: ProviderId[] = ['claude', 'openai']
      const rec = recommendTier([user('приватные данные')], configured, { forcePrivate: true })
      expect(rec?.tier).toBe('frontier')
      expect(rec?.reason).toMatch(/деградация/)
      // приватность потеряна — это должно быть отражено
      expect(rec?.reason).toMatch(/приватность не гарантирована/)
    })

    it('cheap-задача без дешёвых провайдеров → деградация на frontier', () => {
      const configured: ProviderId[] = ['claude']
      const rec = recommendTier([user('hi')], configured)
      expect(rec?.tier).toBe('frontier')
      expect(rec?.providerId).toBe('claude')
    })

    it('frontier-задача без топ-провайдеров → деградация на cheap', () => {
      const configured: ProviderId[] = ['deepseek']
      const rec = recommendTier([user('refactor and migrate and rewrite everything')], configured)
      expect(rec?.tier).toBe('cheap')
      expect(rec?.providerId).toBe('deepseek')
    })

    it('пустой набор провайдеров → null', () => {
      expect(recommendTier([user('hi')], [])).toBeNull()
    })

    it('нет последнего user-сообщения → всё равно отдаёт рекомендацию (simple)', () => {
      const rec = recommendTier([], ALL)
      expect(rec?.tier).toBe('cheap')
    })
  })

  describe('инварианты безопасности', () => {
    it('НИКОГДА не возвращает провайдера вне настроенного набора', () => {
      // перебор разных подмножеств и типов задач
      const subsets: ProviderId[][] = [
        ['ollama'],
        ['gigachat'],
        ['openai', 'groq'],
        ['gemini-api'],
        ['mistral', 'yandex-gpt'],
      ]
      const prompts = [
        'hi',
        'refactor and migrate and implement and rewrite',
        'приватные персональные данные 152',
      ]
      for (const subset of subsets) {
        const set = new Set(subset)
        for (const p of prompts) {
          const rec = recommendTier([user(p)], subset, { forcePrivate: p.includes('приват') })
          expect(rec).not.toBeNull()
          expect(set.has(rec!.providerId)).toBe(true)
        }
      }
    })

    it('НИКОГДА не возвращает фантомную модель (модель всегда в PROVIDERS[id].models)', () => {
      const prompts = [
        'hi',
        'refactor migrate implement rewrite optimize',
        'приватные данные',
      ]
      for (const id of ALL) {
        for (const p of prompts) {
          const rec = recommendTier([user(p)], [id], { forcePrivate: p.includes('приват') })
          if (!rec) continue
          const descriptor = PROVIDERS[rec.providerId]
          expect(descriptor.models).toContain(rec.model)
        }
      }
    })

    it('рекомендованная модель валидна для каждого тира при полном наборе', () => {
      const cases: Array<{ prompt: string; tier: ModelTier }> = [
        { prompt: 'hi', tier: 'cheap' },
        { prompt: 'refactor migrate rewrite implement', tier: 'frontier' },
        { prompt: 'приватные данные', tier: 'private' },
      ]
      for (const c of cases) {
        const rec = recommendTier([user(c.prompt)], ALL, { forcePrivate: c.prompt.includes('приват') })
        expect(rec?.tier).toBe(c.tier)
        expect(PROVIDERS[rec!.providerId].models).toContain(rec!.model)
      }
    })
  })

  describe('detectPrivate()', () => {
    it('ловит EN/RU хинты', () => {
      expect(detectPrivate([user('this is private')])).toBe(true)
      expect(detectPrivate([user('конфиденциально')])).toBe(true)
      expect(detectPrivate([user('PII handling')])).toBe(true)
    })
    it('не срабатывает на обычном тексте', () => {
      expect(detectPrivate([user('build a chart')])).toBe(false)
      expect(detectPrivate([])).toBe(false)
    })
  })
})
