/**
 * Grounding helpers — defensive analysis of LLM / user inputs to keep the
 * agent inside the active project and avoid common hallucination patterns.
 *
 * Per Grok audit: this logic was previously buried in context-pack.ts as one
 * function. It's not "context assembly" — it's a separate concern that may
 * grow (detect fake file paths the AI invents, detect off-topic external
 * URLs, etc.). Lifted out so it can be reused without dragging context-pack.
 */

/**
 * Find absolute paths in user text that AREN'T inside the active project root.
 * Returns deduplicated list of such "outside" paths. Supports:
 *  - Windows: C:\Users\..., D:/foo, \\server\share
 *  - POSIX: /Users/..., /home/..., /opt/...
 * Skips backtick-fenced code blocks because those are usually examples.
 */
export function detectCrossProjectPaths(userText: string, projectPath: string): string[] {
  if (!userText || !projectPath) return []
  // Strip code fences so example paths inside ``` ``` don't trip us up.
  const stripped = userText.replace(/```[\s\S]*?```/g, '')
  // Match Windows drive paths (C:\... or C:/...), UNC, and POSIX absolute paths.
  const re = /(?:[A-Za-z]:[\\/][^\s"'`]+|\\\\[^\s"'`\\]+\\[^\s"'`]+|\/(?:Users|home|opt|var|etc|tmp)\/[^\s"'`]+)/g
  const matches = stripped.match(re) ?? []
  const projNorm = normalizePathForCompare(projectPath)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of matches) {
    const trimmed = raw.replace(/[)\].,;:]+$/, '')  // strip trailing punctuation
    const norm = normalizePathForCompare(trimmed)
    if (norm.startsWith(projNorm)) continue  // inside active project — fine
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(trimmed)
    if (out.length >= 5) break
  }
  return out
}

/** Normalize for prefix comparison: lowercase + forward slashes + trim trailing slash. */
function normalizePathForCompare(p: string): string {
  let n = p.replace(/\\/g, '/').toLowerCase()
  if (n.endsWith('/')) n = n.slice(0, -1)
  return n
}
