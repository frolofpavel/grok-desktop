import { describe, it, expect } from 'vitest'
import { createOneCConnector } from '../../electron/connectors/onec'

describe('1С OData connector', () => {
  it('reports needs-config when secrets are missing', async () => {
    const c = createOneCConnector()
    const ctrl = new AbortController()
    const result = await c.query({ entity: 'Catalog_X' }, {
      getSecret: () => null,
      signal: ctrl.signal
    }) as { error?: string }
    expect(result.error).toBe('needs-config')
  })

  it('reports bad-args when entity is missing and metadata is false', async () => {
    const c = createOneCConnector()
    const ctrl = new AbortController()
    const result = await c.query({}, {
      getSecret: (k) => {
        if (k === 'onec_base_url') return 'http://example/odata/standard.odata'
        if (k === 'onec_username') return 'u'
        if (k === 'onec_password') return 'p'
        return null
      },
      signal: ctrl.signal
    }) as { error?: string }
    expect(result.error).toBe('bad-args')
  })

  it('exposes structural info', () => {
    const c = createOneCConnector()
    const info = c.info()
    expect(info.id).toBe('onec')
    expect(info.kind).toBe('onec-odata')
  })
})
