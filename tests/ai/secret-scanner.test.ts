import { describe, it, expect } from 'vitest'
import { isForbiddenPath, scanText } from '../../electron/ai/secret-scanner'

describe('isForbiddenPath', () => {
  it('blocks .env and variants', () => {
    expect(isForbiddenPath('.env')).toBe(true)
    expect(isForbiddenPath('.env.local')).toBe(true)
    expect(isForbiddenPath('src/.env')).toBe(true)
    expect(isForbiddenPath('apps/web/.env.production')).toBe(true)
  })
  it('blocks .ssh directory contents', () => {
    expect(isForbiddenPath('.ssh/id_ed25519')).toBe(true)
    expect(isForbiddenPath('home/.ssh/config')).toBe(true)
  })
  it('blocks key files by extension', () => {
    expect(isForbiddenPath('certs/server.key')).toBe(true)
    expect(isForbiddenPath('build/cert.pem')).toBe(true)
    expect(isForbiddenPath('keystore.p12')).toBe(true)
  })
  it('blocks AWS and cloud credentials', () => {
    expect(isForbiddenPath('.aws/credentials')).toBe(true)
    expect(isForbiddenPath('.config/gcloud/application_default_credentials.json')).toBe(true)
  })
  it('allows ordinary code', () => {
    expect(isForbiddenPath('src/index.ts')).toBe(false)
    expect(isForbiddenPath('package.json')).toBe(false)
    expect(isForbiddenPath('README.md')).toBe(false)
  })
})

describe('scanText', () => {
  it('redacts OpenAI keys', () => {
    const { redacted, hits } = scanText('api: sk-proj-abcdefghijklmnopqrstuvwx end')
    expect(redacted).not.toContain('sk-proj-abcdefghijklmnopqrstuvwx')
    expect(hits).toContain('openai-key')
  })
  it('redacts GitHub PATs', () => {
    const { redacted, hits } = scanText('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(redacted).toContain('[REDACTED:github-token]')
    expect(hits).toContain('github-token')
  })
  it('redacts AWS access keys', () => {
    const { redacted, hits } = scanText('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).toContain('[REDACTED:aws-access-key]')
    expect(hits).toContain('aws-access-key')
  })
  it('redacts private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA==\n-----END RSA PRIVATE KEY-----'
    const { redacted, hits } = scanText(pem)
    expect(redacted).toContain('[REDACTED:private-key-block]')
    expect(hits).toContain('private-key-block')
  })
  it('redacts basic-auth in URLs', () => {
    const { redacted, hits } = scanText('connect: https://admin:p4ss@1c.example.com/odata')
    expect(redacted).toContain('[REDACTED:basic-auth]')
    expect(hits).toContain('http-basic-auth')
  })
  it('passes ordinary code through', () => {
    const code = 'function add(a, b) { return a + b }'
    const { redacted, hits } = scanText(code)
    expect(redacted).toBe(code)
    expect(hits).toEqual([])
  })
})
