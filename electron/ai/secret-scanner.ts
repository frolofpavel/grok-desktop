/**
 * Secret scanner — two layers of defence against the AI accidentally
 * (or maliciously) exfiltrating credentials.
 *
 * 1. Path policy: certain paths are off-limits even if the user opened
 *    a project that contains them. We don't want the AI loading
 *    `.ssh/id_ed25519`, `.aws/credentials`, browser cookies, etc into
 *    model context where they could end up in completions or logs.
 *
 * 2. Content scanner: any text we hand to the AI (read_file, search
 *    results, command stdout) is run through a regex pass that
 *    replaces obvious credentials with `[REDACTED:type]`.
 *
 * The system layer is told the policy so it knows why files are blocked.
 */

const FORBIDDEN_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'authorized_keys',
  'known_hosts',
  'credentials',
  // 'config.json' removed — too broad, hits many legitimate project configs.
  // Specific cloud configs are covered by FORBIDDEN_DIRS (.aws, .config/gcloud).
  'cookies.json',
  'hh_cookies.json'
])

const FORBIDDEN_DIRS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.config/gcloud',
  '.azure',
  '.docker',
  '.kube'
])

const FORBIDDEN_EXTENSIONS = new Set([
  '.key',
  '.pem',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
  '.jks',
  '.keystore'
])

/** True when the relative path (POSIX-style, no leading slash) looks like a secret store. */
export function isForbiddenPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/').toLowerCase()
  const parts = norm.split('/').filter(Boolean)
  const basename = parts[parts.length - 1] ?? ''
  if (FORBIDDEN_BASENAMES.has(basename)) return true
  // Any dir in the path matching a forbidden dir
  for (const p of parts.slice(0, -1)) {
    if (FORBIDDEN_DIRS.has(p)) return true
  }
  // Composite (e.g. ".config/gcloud") — match against trailing path segments
  for (const forbidden of FORBIDDEN_DIRS) {
    if (forbidden.includes('/') && norm.includes('/' + forbidden + '/')) return true
    if (forbidden.includes('/') && norm.startsWith(forbidden + '/')) return true
  }
  const dotIdx = basename.lastIndexOf('.')
  if (dotIdx > 0) {
    const ext = basename.slice(dotIdx)
    if (FORBIDDEN_EXTENSIONS.has(ext)) return true
  }
  // Generic env files with extra suffix (.env.staging, .env.test, etc)
  if (basename.startsWith('.env.') || basename.startsWith('.env')) return true
  return false
}

interface SecretPattern {
  name: string
  re: RegExp
}

const PATTERNS: SecretPattern[] = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  // AWS secret access key: 40 base64-ish chars. Require a contextual hint
  // (key=, secret=, aws_, AWS_) to avoid false-positives on SHA-1 hashes,
  // base64 blobs, content-hashes, etc. that share the character set.
  { name: 'aws-secret', re: /(?:aws[_-]?secret|secret[_-]?access[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi },
  { name: 'github-token', re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/g },
  { name: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'stripe-key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // 1C-style basic auth in URLs (http://user:pass@host)
  { name: 'http-basic-auth', re: /\b(https?:\/\/)[^\s/:]+:[^\s/@]+@/g }
]

export interface ScanResult {
  /** Text with secrets replaced by `[REDACTED:<type>]`. */
  redacted: string
  /** Names of patterns that fired (deduplicated). */
  hits: string[]
}

/** Scan text and return a redacted copy + names of patterns that matched. */
export function scanText(input: string): ScanResult {
  if (!input) return { redacted: input, hits: [] }
  let out = input
  const hitSet = new Set<string>()
  for (const { name, re } of PATTERNS) {
    if (re.test(out)) {
      hitSet.add(name)
      // Reset lastIndex (global regex state) and replace
      re.lastIndex = 0
      out = out.replace(re, (m) => {
        if (name === 'http-basic-auth') return m.replace(/(https?:\/\/)[^@]+@/, '$1[REDACTED:basic-auth]@')
        return `[REDACTED:${name}]`
      })
    }
    re.lastIndex = 0
  }
  return { redacted: out, hits: [...hitSet] }
}
