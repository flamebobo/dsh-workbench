/**
 * The page endpoints (core/src/rpc.ts) that only read: they may refresh the workbench's own cached state (build status, to-dos synced
 * to the board) but never write to an outside system or a repository (issue.changes is not here: it runs `git add -N`). The Codex page sends these through `runtime_read` and everything else through
 * `runtime_command`, so the read tool's read-only annotation is true; the MCP server refuses anything else on `runtime_read`.
 */
export const READ_ENDPOINTS: readonly string[] = [
  'state', 'todos.list', 'notices.since', 'stats.get', 'stats.payload', 'stats.export', 'skills.packs', 'sparkin.info',
  'onboarding.roots', 'onboarding.scan', 'connections.list', 'jenkins.jobs', 'files.search', 'models.list', 'skills.list', 'dirs.list',
  'issue.writeback.draft', 'report.draft', 'settings.get',
]

/** What one endpoint call answers (same shape over the DSH route, the local service and the MCP tools). */
export interface RpcReply { ok: boolean; value?: unknown; error?: string; code?: string; issueId?: string }
