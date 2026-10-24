import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Dispatch } from './rpc.ts'

/** Where a running service says how to reach it. Holds the token, so only the owner can read it. */
export interface ServeInfo { pid: number; port: number; token: string; startedAt: string; version: string }
export const serveInfoPath = (dir: string) => join(dir, 'serve.json')

const MAX_BODY = 64 * 1024 * 1024 // uploads travel base64-encoded inside the JSON body
const MAX_WAIT = 25_000

const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('请求太大')); req.destroy() } else chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

/**
 * The resident local service behind the Codex plugin: the page's endpoints over HTTP on 127.0.0.1 only, guarded by a token made
 * fresh on every start (Bearer). `revision` is any value that changes whenever the data does; `/events` long-polls on it.
 *   POST /rpc { endpoint, payload } -> { ok, value } | { ok: false, error, code?, issueId? }
 *   GET  /events?after=<seq>&wait=<ms> -> { seq } as soon as seq > after (or when the wait runs out)
 *   GET  /health -> { ok, pid, version }
 */
export async function serve(o: { dir: string; dispatch: Dispatch; version: string; revision: () => unknown; port?: number; log?: (msg: string, e?: unknown) => void }) {
  const token = randomBytes(24).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const authorized = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers.authorization ?? ''))
    return got.length === expected.length && timingSafeEqual(got, expected)
  }

  let seq = 0
  let last = o.revision()
  const waiters = new Set<() => void>()
  const watch = setInterval(() => {
    const now = o.revision()
    if (now === last) return
    last = now; seq += 1
    for (const w of waiters) w()
  }, 200)
  watch.unref()

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
    if (!authorized(req)) return send(401, { ok: false, error: 'unauthorized' })
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, pid: process.pid, version: o.version })
      if (req.method === 'GET' && url.pathname === '/events') {
        const after = Number(url.searchParams.get('after') ?? -1)
        const wait = Math.min(MAX_WAIT, Math.max(0, Number(url.searchParams.get('wait')) || 0))
        if (seq <= after && wait > 0) {
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(t); waiters.delete(done); resolve() }
            const t = setTimeout(done, wait)
            waiters.add(done)
            req.once('close', done)
          })
        }
        return send(200, { seq })
      }
      if (req.method === 'POST' && url.pathname === '/rpc') {
        const { endpoint, payload } = JSON.parse(await readBody(req))
        try {
          return send(200, { ok: true, value: (await o.dispatch(String(endpoint), payload ?? {})) ?? null })
        } catch (e) {
          const err = e as Error & { code?: string; issueId?: string }
          if (!err?.code) o.log?.(`rpc ${endpoint} failed`, e)
          return send(200, { ok: false, error: String(err?.message ?? e), code: err?.code, issueId: err?.issueId })
        }
      }
      send(404, { ok: false, error: 'not found' })
    } catch (e) { send(400, { ok: false, error: String((e as Error)?.message ?? e) }) }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(o.port ?? 0, '127.0.0.1', resolve) })
  const info: ServeInfo = { pid: process.pid, port: (server.address() as AddressInfo).port, token, startedAt: new Date().toISOString(), version: o.version }
  writeFileSync(serveInfoPath(o.dir), JSON.stringify(info), { mode: 0o600 })
  const close = async () => {
    clearInterval(watch)
    for (const w of waiters) w()
    try { if (readServeInfo(o.dir)?.token === token) rmSync(serveInfoPath(o.dir)) } catch { /* already gone */ }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return { info, close }
}

export function readServeInfo(dir: string): ServeInfo | undefined {
  try { return JSON.parse(readFileSync(serveInfoPath(dir), 'utf8')) } catch { return undefined }
}

/** One request to a running service. Throws when it can't be reached; endpoint errors come back as `{ ok: false }`. */
export async function callServe<T = unknown>(info: Pick<ServeInfo, 'port' | 'token'>, path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${info.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('本地服务拒绝了令牌（服务可能已重启）')
  return await res.json() as T
}
