import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import type { Issue, Run } from '../core/src/index.ts'
import { callServe, type ServeInfo } from '../core/src/serve.ts'
import { READ_ENDPOINTS, type RpcReply } from './endpoints.ts'
import { ensureServe } from './runtime.ts'

export const BOARD_URI = 'ui://workbench/board.html'

/** How the MCP process reaches the data: in production the local service, in tests a Workbench in the same process. */
export interface Backend {
  rpc(endpoint: string, payload: unknown): Promise<RpcReply>
  events(after: number, waitMs: number): Promise<{ seq: number }>
}

const STATUS: Record<string, string> = { backlog: '待规划', todo: '待办', in_progress: '进行中', in_review: '待审核', done: '已完成', blocked: '已阻塞' }

const reply = (r: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r as Record<string, unknown> })
const text = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 1) }] })
const failure = (e: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: String((e as Error)?.message ?? e) }] })

/**
 * The plugin's MCP server: it holds no business data, every call is forwarded to the backend.
 * - `board` opens the full page (global entry in Codex's sidebar);
 * - `runtime_read` / `runtime_command` / `runtime_events`: the page's transport, visible to the page only;
 * - `todos_list` / `issues_list` / `issue_get`: read-only views for the model.
 */
export function createMcpServer(o: { backend: Backend; boardHtml: () => string; version: string }): McpServer {
  const server = new McpServer({ name: 'workbench', title: '研发工作台', version: o.version })
  const { backend } = o
  const value = async <T>(endpoint: string, payload: unknown = {}): Promise<T> => {
    const r = await backend.rpc(endpoint, payload)
    if (!r.ok) throw new Error(r.error ?? `${endpoint} 失败`)
    return r.value as T
  }
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  const appOnly = { ui: { resourceUri: BOARD_URI, visibility: ['app' as const] } }

  const boardMeta = { ui: { resourceUri: BOARD_URI }, 'openai/ui': { entrypoints: [{ type: 'global' }] }, 'openai/outputTemplate': BOARD_URI }
  registerAppTool(server, 'board', {
    title: '研发工作台', description: '打开研发工作台（待办、看板、智能体、项目、统计）。只打开页面，不开工、不改任何数据。',
    annotations: readOnly, _meta: boardMeta,
  }, async () => {
    try {
      const st = await value<{ issues: Issue[]; working: number }>('state')
      const count = (s: string) => st.issues.filter((i) => i.status === s && !i.archivedAt).length
      return reply({ opened: true, working: st.working, inProgress: count('in_progress'), inReview: count('in_review'), blocked: count('blocked') })
    } catch (e) { return failure(e) }
  })

  const call = z.object({ endpoint: z.string().min(1).max(100), payload: z.record(z.string(), z.unknown()).optional() })
  registerAppTool(server, 'runtime_read', {
    description: '工作台页面读取数据（只读端点）。', inputSchema: call.shape, annotations: readOnly, _meta: appOnly,
  }, async ({ endpoint, payload }) => {
    if (!READ_ENDPOINTS.includes(endpoint)) return reply({ ok: false, error: `${endpoint} 不是只读端点，请用 runtime_command` })
    try { return reply(await backend.rpc(endpoint, payload ?? {})) } catch (e) { return failure(e) }
  })
  registerAppTool(server, 'runtime_command', {
    description: '工作台页面上用户点击触发的操作（开工、停止、保存、回写等），只由页面调用。', inputSchema: call.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, _meta: appOnly,
  }, async ({ endpoint, payload }) => {
    try { return reply(await backend.rpc(endpoint, payload ?? {})) } catch (e) { return failure(e) }
  })
  registerAppTool(server, 'runtime_events', {
    description: '等待工作台数据变化（长轮询），返回最新的变化序号。',
    inputSchema: { after: z.number().int(), waitMs: z.number().int().min(0).max(25_000).optional() }, annotations: readOnly, _meta: appOnly,
  }, async ({ after, waitMs }) => {
    try { return reply(await backend.events(after, waitMs ?? 20_000)) } catch (e) { return failure(e) }
  })

  server.registerTool('todos_list', {
    title: '我的待办', description: '列出研发工作台汇总的待办（禅道 Bug/任务、GitLab 待评审 MR、Jenkins 失败构建、Sparkin 任务等），含来源、编号、标题、优先级。',
    annotations: readOnly,
  }, async () => {
    try {
      const t = await value<{ items: { source: string; ref: string; title: string; priority?: string; url?: string; due?: string }[]; sources: Record<string, { mode: string; error?: string }> }>('todos.list')
      return text({ sources: t.sources, items: t.items.map(({ source, ref, title, priority, due, url }) => ({ source, ref, title, priority, due, url })) })
    } catch (e) { return failure(e) }
  })
  server.registerTool('issues_list', {
    title: '看板卡片', description: '列出研发工作台看板上的卡片（编号、标题、状态、项目、智能体）。可按状态筛选。',
    inputSchema: { status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked']).optional(), includeArchived: z.boolean().optional() },
    annotations: readOnly,
  }, async ({ status, includeArchived }) => {
    try {
      const st = await value<{ issues: Issue[]; projects: { id: string; name: string }[] }>('state')
      const project = (id?: string) => st.projects.find((p) => p.id === id)?.name
      return text(st.issues.filter((i) => (!status || i.status === status) && (includeArchived || !i.archivedAt))
        .map((i) => ({ id: i.id, key: i.key, title: i.title, status: STATUS[i.status], project: project(i.projectId), agentId: i.agentId, note: i.note, updatedAt: i.updatedAt })))
    } catch (e) { return failure(e) }
  })
  server.registerTool('issue_get', {
    title: '卡片详情', description: '读取一张看板卡片的详情：描述、验收标准、状态、分支、最近几次智能体运行的结果。参数是卡片编号（如 WB-3）或 id。',
    inputSchema: { idOrKey: z.string().min(1) }, annotations: readOnly,
  }, async ({ idOrKey }) => {
    try {
      const st = await value<{ issues: Issue[]; runs: Run[] }>('state')
      const i = st.issues.find((x) => x.id === idOrKey || x.key.toLowerCase() === idOrKey.toLowerCase())
      if (!i) return failure(new Error(`没有找到卡片 ${idOrKey}`))
      const runs = st.runs.filter((r) => r.issueId === i.id).slice(-3).map(({ status, startedAt, endedAt, finalText, error }) => ({ status, startedAt, endedAt, finalText, error }))
      return text({ ...i, status: STATUS[i.status], runs })
    } catch (e) { return failure(e) }
  })

  const ui = { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } }
  registerAppResource(server, '研发工作台', BOARD_URI, { title: '研发工作台', _meta: { ui } }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: o.boardHtml(), _meta: { ui } }],
  }))
  return server
}

/** Is this a failure to reach the service at all (so the request was never handled and is safe to send again)? */
const unreachable = (e: unknown) => {
  const code = ((e as { cause?: { code?: string } })?.cause?.code) ?? ''
  return code === 'ECONNREFUSED' || /拒绝了令牌/.test(String((e as Error)?.message))
}

/** `workbench mcp`: stdio MCP server forwarding to the local service, starting the service if it is not running. */
export async function runMcp(o: { dir: string; version: string; entry: string[]; boardHtml: () => string }) {
  let info: ServeInfo | undefined
  const request = async <T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      info ??= await ensureServe({ dir: o.dir, version: o.version, entry: o.entry })
      try { return await callServe<T>(info, path, body, timeoutMs) } catch (e) {
        info = undefined
        if (attempt > 0 || !unreachable(e)) throw e // a request that may have been handled is never sent twice
      }
    }
  }
  const backend: Backend = {
    rpc: (endpoint, payload) => request<RpcReply>('/rpc', { endpoint, payload }),
    events: (after, waitMs) => request<{ seq: number }>(`/events?after=${after}&wait=${waitMs}`, undefined, waitMs + 10_000),
  }
  const server = createMcpServer({ backend, boardHtml: o.boardHtml, version: o.version })
  await server.connect(new StdioServerTransport())
}
