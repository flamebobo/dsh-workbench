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
// links (MR, Jenkins build) open through the host: a sandboxed frame may not open windows itself. Capture phase, so a link whose
// React handler stops propagation is still caught.
document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || !/^https?:/.test(a.href)) return
  e.preventDefault()
  void app.openLink({ url: a.href })
}, true)

app.connect().then(() => {
  theme(app.getHostContext()?.theme)
  createRoot(document.getElementById('root')!).render(<App />)
  void watchChanges(app, () => false, () => window.dispatchEvent(new Event('wb:changed')))
}, (e) => {
  document.getElementById('root')!.textContent = `没能连上 Codex：${(e as Error)?.message ?? e}`
})
