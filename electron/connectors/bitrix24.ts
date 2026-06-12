/**
 * Bitrix24 connector — через входящий webhook (incoming webhook).
 *
 * Источник: V3 Plan раздел 5.4. Пилот клиент — example.
 *
 * Credentials (settings keys):
 *   bitrix24_webhook_url    — полный URL вида
 *                              https://{portal}.bitrix24.ru/rest/{user_id}/{token}/
 *                             (создаётся в Битрикс24: «Разработчикам» →
 *                              «Другое» → «Входящий вебхук»).
 *
 * Безопасность:
 *   - URL содержит token, поэтому хранится в safeStorage.
 *   - Whitelist методов: V1 разрешает только read + add/update сделок
 *     и leads. Удаление (crm.deal.delete) запрещено через denylist.
 *
 * API style: Битрикс REST использует «методы» как путь после webhook,
 * формат crm.deal.list, crm.lead.add и т.п. Аргументы — JSON body или
 * URL-encoded query string.
 */

import type { Connector, ConnectorInfo, ConnectorContext } from './types'

const DENIED_METHODS = new Set([
  'crm.deal.delete',
  'crm.lead.delete',
  'crm.contact.delete',
  'crm.company.delete',
  'user.delete'
])

const ALLOWED_PREFIXES = ['crm.', 'tasks.', 'task.', 'user.', 'profile.']

export function createBitrix24Connector(): Connector {
  return {
    info(): ConnectorInfo {
      return {
        id: 'bitrix24',
        label: 'Битрикс24',
        kind: 'bitrix24',
        status: 'ready',
        detail: 'Incoming webhook URL в settings (bitrix24_webhook_url). Пилот: example.'
      }
    },

    async query(args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
      const op = String(args.op ?? '')
      const webhook = ctx.getSecret('bitrix24_webhook_url')
      if (!webhook) {
        return {
          error: 'no-webhook',
          message: 'Webhook URL не настроен. Settings → введи bitrix24_webhook_url.\n' +
                   'Где взять: в Битрикс24 → Разработчикам → Другое → Входящий вебхук → копируй полный URL.'
        }
      }
      try {
        switch (op) {
          case 'list_deals':         return await listDeals(webhook, args, ctx)
          case 'get_deal':           return await callMethod(webhook, 'crm.deal.get', { id: args.deal_id }, ctx)
          case 'add_deal':           return await addDeal(webhook, args, ctx)
          case 'update_deal':        return await updateDeal(webhook, args, ctx)
          case 'add_activity':       return await addActivity(webhook, args, ctx)
          case 'list_leads':         return await listLeads(webhook, args, ctx)
          case 'get_source_report':  return await getSourceReport(webhook, args, ctx)
          case 'call':               return await rawCall(webhook, args, ctx)
          default:
            return {
              error: 'unknown-op',
              message: `Неизвестная op «${op}». Доступно: list_deals, get_deal, add_deal, update_deal, add_activity, list_leads, get_source_report, call.`
            }
        }
      } catch (err) {
        return { error: 'request-failed', message: err instanceof Error ? err.message : String(err), op }
      }
    }
  }
}

// ----------------------------------------------------------------- ops

async function listDeals(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  const filter: Record<string, unknown> = {}
  if (args.stage) filter.STAGE_ID = args.stage
  if (args.source) filter.SOURCE_ID = args.source
  if (args.period) {
    // period = 'this_month' | 'last_30d' | ISO
    const since = parsePeriod(String(args.period))
    if (since) filter['>=DATE_CREATE'] = since
  }
  const select = (args.select as string[] | undefined) ?? ['ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'SOURCE_ID', 'DATE_CREATE', 'COMPANY_TITLE', 'ASSIGNED_BY_ID']
  return await callMethod(webhook, 'crm.deal.list', { filter, select, order: { DATE_CREATE: 'DESC' } }, ctx)
}

async function addDeal(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  const fields = (args.fields as Record<string, unknown> | undefined) ?? {}
  if (args.title) fields.TITLE = args.title
  if (args.source) fields.SOURCE_ID = args.source
  if (args.opportunity) fields.OPPORTUNITY = args.opportunity
  return await callMethod(webhook, 'crm.deal.add', { fields }, ctx)
}

async function updateDeal(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  if (!args.deal_id) return { error: 'bad-args', message: 'update_deal требует deal_id' }
  const fields = (args.patch as Record<string, unknown> | undefined) ?? {}
  return await callMethod(webhook, 'crm.deal.update', { id: args.deal_id, fields }, ctx)
}

async function addActivity(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  if (!args.deal_id || !args.description) {
    return { error: 'bad-args', message: 'add_activity требует deal_id и description' }
  }
  return await callMethod(webhook, 'crm.activity.add', {
    fields: {
      OWNER_TYPE_ID: 2, // 2 = deal
      OWNER_ID: args.deal_id,
      TYPE_ID: 4,       // 4 = call/meeting
      SUBJECT: String(args.subject ?? 'Касание'),
      DESCRIPTION: String(args.description),
      COMPLETED: 'Y'
    }
  }, ctx)
}

async function listLeads(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  const filter = (args.filter as Record<string, unknown>) ?? {}
  return await callMethod(webhook, 'crm.lead.list', { filter, order: { DATE_CREATE: 'DESC' } }, ctx)
}

async function getSourceReport(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  // Простейшая агрегация: list deals за период + groupBy SOURCE_ID на клиенте.
  const since = args.period ? parsePeriod(String(args.period)) : undefined
  const filter: Record<string, unknown> = since ? { '>=DATE_CREATE': since } : {}
  const deals = await callMethod(webhook, 'crm.deal.list', {
    filter, select: ['ID', 'SOURCE_ID', 'OPPORTUNITY', 'STAGE_ID']
  }, ctx) as { result?: Array<{ SOURCE_ID?: string; OPPORTUNITY?: string; STAGE_ID?: string }> }
  const bySource: Record<string, { count: number; total: number; won: number }> = {}
  for (const d of deals.result ?? []) {
    const src = d.SOURCE_ID ?? 'UNKNOWN'
    const opp = parseFloat(d.OPPORTUNITY ?? '0') || 0
    if (!bySource[src]) bySource[src] = { count: 0, total: 0, won: 0 }
    bySource[src].count++
    bySource[src].total += opp
    if (d.STAGE_ID && /WON|SUCCESS/i.test(d.STAGE_ID)) bySource[src].won++
  }
  return { period: args.period, sources: bySource, total_deals: deals.result?.length ?? 0 }
}

async function rawCall(webhook: string, args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  const method = String(args.method ?? '')
  if (!method) return { error: 'bad-args', message: 'call требует method (например crm.deal.list)' }
  const isAllowed = ALLOWED_PREFIXES.some(p => method.startsWith(p))
  if (!isAllowed) return { error: 'blocked', message: `Метод «${method}» не в allowed prefixes (${ALLOWED_PREFIXES.join(', ')}).` }
  if (DENIED_METHODS.has(method)) return { error: 'blocked', message: `Метод «${method}» в denylist.` }
  const params = (args.params as Record<string, unknown>) ?? {}
  return await callMethod(webhook, method, params, ctx)
}

// ----------------------------------------------------------------- helpers

async function callMethod(webhook: string, method: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
  if (DENIED_METHODS.has(method)) {
    throw new Error(`Method ${method} blocked by denylist`)
  }
  const url = `${webhook.replace(/\/+$/, '')}/${method}.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: ctx.signal
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Bitrix24 ${method} ${res.status}: ${text.slice(0, 400)}`)
  try { return JSON.parse(text) } catch { return { _raw: text } }
}

function parsePeriod(period: string): string | null {
  // Возвращает ISO date string для filter['>=DATE_CREATE']
  const now = new Date()
  if (period === 'this_month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  if (period === 'last_30d') {
    return new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
  }
  if (period === 'last_7d') {
    return new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()
  }
  // ISO
  const d = new Date(period)
  if (!isNaN(d.getTime())) return d.toISOString()
  return null
}
