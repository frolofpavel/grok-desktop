/**
 * 1С:Предприятие OData connector.
 *
 * 1C exposes an /odata/standard.odata/ REST endpoint on configurations
 * with the "OData interface" publishing option enabled. Auth is HTTP Basic.
 *
 * Settings keys this adapter reads:
 *   onec_base_url   — full URL to .../odata/standard.odata
 *   onec_username   — basic-auth username
 *   onec_password   — basic-auth password
 *
 * Supported query args (all optional except `entity` for non-metadata calls):
 *   entity     — string, e.g. 'Catalog_Контрагенты' or 'Document_РеализацияТоваровУслуг'
 *   filter     — OData $filter expression
 *   select     — comma-separated $select fields
 *   top        — integer, page size (clamped 1..100)
 *   metadata   — boolean, when true returns the $metadata document instead
 */

import type { Connector, ConnectorContext, ConnectorInfo } from './types'
import { readBodyWithLimit } from './types'

const KEY_BASE = 'onec_base_url'
const KEY_USER = 'onec_username'
const KEY_PASS = 'onec_password'

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export function createOneCConnector(): Connector {
  return {
    info(): ConnectorInfo {
      // info() is called from main with no secrets context — we just report
      // structural info. Actual readiness is checked inside query().
      return {
        id: 'onec',
        label: '1С:Предприятие (OData)',
        kind: 'onec-odata',
        status: 'ready',  // optimistic; query() will report needs-config if creds missing
        detail: 'HTTP Basic + standard.odata'
      }
    },

    async query(args: Record<string, unknown>, ctx: ConnectorContext): Promise<unknown> {
      const base = ctx.getSecret(KEY_BASE)
      const user = ctx.getSecret(KEY_USER)
      const pass = ctx.getSecret(KEY_PASS)
      if (!base || !user || !pass) {
        return {
          error: 'needs-config',
          message: `Заполни в настройках: ${[
            !base && 'onec_base_url',
            !user && 'onec_username',
            !pass && 'onec_password'
          ].filter(Boolean).join(', ')}`
        }
      }

      const baseUrl = trimSlash(base)
      const metadata = !!args.metadata
      const entity = typeof args.entity === 'string' ? args.entity.trim() : ''

      let url: string
      if (metadata) {
        url = `${baseUrl}/$metadata`
      } else {
        if (!entity) return { error: 'bad-args', message: 'Передай entity (например "Catalog_Контрагенты") или metadata: true' }
        const params = new URLSearchParams()
        params.set('$format', 'json')
        if (typeof args.filter === 'string' && args.filter) params.set('$filter', args.filter)
        if (typeof args.select === 'string' && args.select) params.set('$select', args.select)
        const top = typeof args.top === 'number' ? Math.max(1, Math.min(100, Math.floor(args.top))) : 20
        params.set('$top', String(top))
        url = `${baseUrl}/${entity}?${params.toString()}`
      }

      const auth = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': auth, 'Accept': metadata ? 'application/xml' : 'application/json' },
          signal: ctx.signal
        })
        const body = await readBodyWithLimit(res)
        return {
          status: res.status,
          ok: res.ok,
          url,
          contentType: res.headers.get('content-type') ?? '',
          body
        }
      } catch (err) {
        return {
          error: 'fetch-failed',
          message: err instanceof Error ? err.message : String(err),
          url
        }
      }
    }
  }
}
