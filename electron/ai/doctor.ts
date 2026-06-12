/**
 * Doctor — health-check провайдеров и коннекторов.
 *
 * Назначение: одной кнопкой показать пользователю, что из настроенного
 * реально готово к работе, а что требует конфигурации. Это «config presence»
 * проверка — мы НЕ делаем сетевых запросов в этой версии, только смотрим,
 * лежит ли нужный секрет в settings. Реальный ping (валидный ли ключ, отвечает
 * ли сервис) — отдельное улучшение на будущее: добавить per-provider/connector
 * async-проверку с таймаутом и AbortSignal, не блокируя UI.
 */

import { PROVIDERS } from './registry'

/** Статус одного пункта диагностики. */
export type DoctorStatus = 'ok' | 'no-key' | 'n-a'

export interface DoctorItem {
  id: string
  name: string
  status: DoctorStatus
  detail: string
}

export interface DoctorReport {
  providers: DoctorItem[]
  connectors: DoctorItem[]
  summary: { okCount: number; problemCount: number }
}

/**
 * Минимальный интерфейс доступа к секретам. Совпадает с storage/settings.ts
 * (getSecret), но описан локально, чтобы doctor не тянул весь модуль.
 */
export interface DoctorSettings {
  getSecret: (key: string) => string | null
}

/**
 * Карта коннектор → основной секретный ключ, по наличию которого считаем
 * коннектор настроенным. Источник: getSecret-вызовы внутри каждого адаптера
 * (electron/connectors/*.ts). Для http проверяем первый endpoint.
 */
const CONNECTOR_CHECKS: Array<{ id: string; name: string; key: string }> = [
  { id: 'onec',           name: '1С:Предприятие (OData)', key: 'onec_base_url' },
  { id: 'http',           name: 'HTTP API',                key: 'http_endpoint_1_base' },
  { id: 'gsheets',        name: 'Google Sheets',           key: 'gsheets_service_account_json' },
  { id: 'ssh',            name: 'SSH',                     key: 'ssh_default_host' },
  { id: 'telegram',       name: 'Telegram Bot',            key: 'telegram_bot_token' },
  { id: 'bitrix24',       name: 'Битрикс24',               key: 'bitrix24_webhook_url' },
  { id: 'yandex_direct',  name: 'Я.Директ',                key: 'yandex_direct_token' },
  { id: 'yandex_disk',    name: 'Я.Диск',                  key: 'yandex_disk_token' },
  { id: 'github',         name: 'GitHub',                  key: 'github_token' },
  { id: 'social-publish', name: 'Соц-публикация',          key: 'telegram_bot_token' }
]

/**
 * Прогоняет health-check по всем провайдерам и коннекторам.
 * Чистая синхронная функция — только чтение настроек, без сети.
 */
export function runDoctor(settings: DoctorSettings): DoctorReport {
  const providers: DoctorItem[] = []

  for (const p of Object.values(PROVIDERS)) {
    // CLI-провайдеры (secretKey === null) авторизуются через свой бинарь —
    // ключа в settings нет, это не проблема.
    if (p.secretKey === null) {
      providers.push({
        id: p.id,
        name: p.name,
        status: 'n-a',
        detail: 'CLI — авторизация через бинарь, ключ не нужен'
      })
      continue
    }
    // Ollama — локальный сервис (OpenAI-совместимый), ключ необязателен.
    if (p.id === 'ollama') {
      const hasKey = !!settings.getSecret(p.secretKey)
      providers.push({
        id: p.id,
        name: p.name,
        status: 'n-a',
        detail: hasKey ? 'локальный, ключ задан' : 'локальный, ключ не требуется'
      })
      continue
    }
    const hasKey = !!settings.getSecret(p.secretKey)
    providers.push({
      id: p.id,
      name: p.name,
      status: hasKey ? 'ok' : 'no-key',
      detail: hasKey ? `ключ задан (${p.secretKey})` : `нет ключа (${p.secretKey})`
    })
  }

  const connectors: DoctorItem[] = CONNECTOR_CHECKS.map(c => {
    const configured = !!settings.getSecret(c.key)
    return {
      id: c.id,
      name: c.name,
      status: configured ? 'ok' : ('no-key' as DoctorStatus),
      detail: configured ? 'настроен' : `не настроен (${c.key})`
    }
  })

  // problemCount — только реальные проблемы (no-key). n-a не считается проблемой.
  const all = [...providers, ...connectors]
  const okCount = all.filter(i => i.status === 'ok').length
  const problemCount = all.filter(i => i.status === 'no-key').length

  return { providers, connectors, summary: { okCount, problemCount } }
}
