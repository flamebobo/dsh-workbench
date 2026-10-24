export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
/** Reads a credential by its WORKBENCH_* name (DSH: ctx.credentials.resolve). Values never leave the Host. */
export type Creds = (name: string) => Promise<string | undefined>

export interface ConnectorContext {
  creds: Creds
  fetch: FetchLike
  /** Ids from the Projects page, used to know which Zentao products to read. */
  zentaoProductIds: number[]
  /** A source that still returned data but could not read part of it says so here (shown next to the 实时 label). */
  warn?: (message: string) => void
}

export async function getJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

export const trimSlash = (u: string) => u.replace(/\/+$/, '')

export const stripHtml = (s: unknown) =>
  String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
