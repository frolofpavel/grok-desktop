export interface DetectedLocalServer {
  id: 'ollama' | 'lmstudio' | 'llamacpp' | 'jan'
  name: string
  baseUrl: string
  running: boolean
  models: string[]
}

interface ProbeSpec {
  id: DetectedLocalServer['id']
  name: string
  probeUrl: string
  baseUrl: string
  parseModels: (body: unknown) => string[]
}

const PROBES: ProbeSpec[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    probeUrl: 'http://localhost:11434/api/tags',
    baseUrl: 'http://localhost:11434/v1',
    parseModels: body => {
      if (!isRecord(body) || !Array.isArray(body.models)) return []
      return body.models
        .map(item => isRecord(item) && typeof item.name === 'string' ? item.name : null)
        .filter((name): name is string => !!name)
    }
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    probeUrl: 'http://localhost:1234/v1/models',
    baseUrl: 'http://localhost:1234/v1',
    parseModels: parseOpenAiModels
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    probeUrl: 'http://localhost:8080/v1/models',
    baseUrl: 'http://localhost:8080/v1',
    parseModels: parseOpenAiModels
  },
  {
    id: 'jan',
    name: 'Jan',
    probeUrl: 'http://localhost:1337/v1/models',
    baseUrl: 'http://localhost:1337/v1',
    parseModels: parseOpenAiModels
  }
]

const PROBE_TIMEOUT_MS = 800

export async function scanLocalModelServers(): Promise<DetectedLocalServer[]> {
  const results = await Promise.all(PROBES.map(probeServer))
  return results.filter((server): server is DetectedLocalServer => server !== null)
}

async function probeServer(spec: ProbeSpec): Promise<DetectedLocalServer | null> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)

  try {
    const res = await fetch(spec.probeUrl, { method: 'GET', signal: ctrl.signal })
    if (!res.ok) return null

    const body = await res.json() as unknown
    return {
      id: spec.id,
      name: spec.name,
      baseUrl: spec.baseUrl,
      running: true,
      models: spec.parseModels(body)
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function parseOpenAiModels(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  return body.data
    .map(item => isRecord(item) && typeof item.id === 'string' ? item.id : null)
    .filter((id): id is string => !!id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
