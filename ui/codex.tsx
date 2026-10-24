// Entry of the Codex page (an MCP App inside Codex): same App as DSH, a different transport. Built into codex-plugin/board.html.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App as McpApp } from '@modelcontextprotocol/ext-apps'
import { App } from './App.tsx'
import { setTransport } from './api.ts'
import { mcpTransport, watchChanges } from './mcp-transport.ts'

declare const __WB_VERSION__: string | undefined

const theme = (t?: string) => { if (t) document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light' }
const app = new McpApp({ name: '研发工作台', version: typeof __WB_VERSION__ === 'string' ? __WB_VERSION__ : 'dev' })
app.onhostcontextchanged = (c) => theme(c.theme)
setTransport(mcpTransport(app))

app.connect().then(() => {
  theme(app.getHostContext()?.theme)
  createRoot(document.getElementById('root')!).render(<App />)
  void watchChanges(app, () => false, () => window.dispatchEvent(new Event('wb:changed')))
}, (e) => {
  document.getElementById('root')!.textContent = `没能连上 Codex：${(e as Error)?.message ?? e}`
})
