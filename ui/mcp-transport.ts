import type { App as McpApp } from '@modelcontextprotocol/ext-apps'
import { READ_ENDPOINTS } from '../codex/endpoints.ts'
import type { Transport } from './api.ts'

type Tools = Pick<McpApp, 'callServerTool'>
type Reply = Awaited<ReturnType<Transport['rpc']>>

/** One tool call; a tool-level failure (isError) becomes `{ ok: false }` like any endpoint error. */
async function call(app: Tools, name: string, args: Record<string, unknown>): Promise<Reply> {
  const r = await app.callServerTool({ name, arguments: args })
  if (r.isError) return { ok: false, error: r.content?.map((c) => ('text' in c ? c.text : '')).join('; ') || `${name} 失败` }
  return r.structuredContent as Reply
}

const base64 = async (file: Blob) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** The Codex page's transport: reads through `runtime_read`, everything else through `runtime_command`; credentials stay in the MCP process. */
export function mcpTransport(app: Tools): Transport {
  return {
    rpc: (endpoint, payload) => call(app, READ_ENDPOINTS.includes(endpoint) ? 'runtime_read' : 'runtime_command', { endpoint, payload }),
    upload: async (file) => call(app, 'runtime_command', { endpoint: 'upload', payload: { name: file.name, mediaType: file.type || 'application/octet-stream', base64: await base64(file) } }),
  }
}

/** Long-poll `runtime_events` and fire `wb:changed` whenever the data changed, until `stopped()` says so. */
export async function watchChanges(app: Tools, stopped: () => boolean, onChange: () => void) {
  let seq: number | undefined
  while (!stopped()) {
    try {
      const r = await call(app, 'runtime_events', { after: seq ?? -1, waitMs: seq === undefined ? 0 : 20_000 })
      const next = (r as unknown as { seq?: number }).seq
      if (typeof next !== 'number') throw new Error('no seq')
      if (seq !== undefined && next !== seq) onChange()
      seq = next
    } catch { await new Promise((r) => setTimeout(r, 3000)) }
  }
}
