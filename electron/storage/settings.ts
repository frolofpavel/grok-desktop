import type { Database } from 'better-sqlite3'

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plaintext: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export interface Settings {
  getSecret: (key: string) => string | null
  setSecret: (key: string, value: string) => void
}

export function createSettings(db: Database, safe: SafeStorageLike): Settings {
  const stmtGet = db.prepare('SELECT value FROM settings WHERE key = ?')
  const stmtSet = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  // На Linux без libsecret (gnome-keyring / KDE wallet) safeStorage недоступен.
  // Fallback: base64 без шифрования. Не идеально, но лучше чем крэш при старте.
  const canEncrypt = safe.isEncryptionAvailable()

  return {
    getSecret(key) {
      const row = stmtGet.get(key) as { value: string } | undefined
      if (!row) return null
      try {
        if (canEncrypt) {
          const buf = Buffer.from(row.value, 'base64')
          return safe.decryptString(buf)
        }
        // Fallback: значение хранится как plain base64
        return Buffer.from(row.value, 'base64').toString('utf-8')
      } catch {
        // Если ключ записан одним способом а читаем другим — попробуем plain
        try { return Buffer.from(row.value, 'base64').toString('utf-8') } catch { return null }
      }
    },
    setSecret(key, value) {
      if (canEncrypt) {
        const encrypted = safe.encryptString(value).toString('base64')
        stmtSet.run(key, encrypted)
      } else {
        // Fallback: base64 без шифрования
        stmtSet.run(key, Buffer.from(value, 'utf-8').toString('base64'))
      }
    }
  }
}
