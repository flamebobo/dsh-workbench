// Headless-Chrome driver for the QA screenshots in docs/qa: node scripts/qa/shots.mjs <url-with-token> <steps.json>
// A step is { shot?: "name" (none = setup only), width?, height?, dark?, tab?, js?, wait? }; it opens the workbench, runs `js` in the page (rpc(endpoint, payload) is predefined),
// switches to `tab` (text of the tab), runs `after` and saves docs/qa/<name>.png. Nothing here writes to any system but the page it opens.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, stepsFile] = process.argv.slice(2)
const steps = JSON.parse((await import('node:fs')).readFileSync(stepsFile, 'utf8'))
const out = new URL('../../docs/qa/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const port = 9333 + Math.floor(Math.random() * 500)
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wb-shots-'))}`, '--no-first-run', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let n = 0; n < 50; n++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets[0]) break } catch { await sleep(200) } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.result?.value
}
const RPC = `window.rpc = async (endpoint, payload = {}) => (await (await fetch('api/workbench.rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })).json())`

let loaded = false
for (const s of steps) {
  const width = s.width ?? 1360, height = s.height ?? 860
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.dark ? 'dark' : 'light' }] })
  if (!loaded || s.reload) { await send('Page.navigate', { url }); await sleep(4500); loaded = true }
  await evalJs(RPC)
  await evalJs(`(async () => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '工作台'); if (b && !document.querySelector('[role=tab]')) b.click(); await new Promise((r) => setTimeout(r, 1800)) })()`)
  if (s.js) { const v = await evalJs(`(async () => { ${s.js} })()`); if (v !== undefined) console.log(v) } // a step may `return` something worth printing
  if (s.tab) await evalJs(`(async () => { [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith(${JSON.stringify(s.tab)}))?.click(); await new Promise((r) => setTimeout(r, 1500)) })()`)
  if (s.after) { const v = await evalJs(`(async () => { ${s.after} })()`); if (v !== undefined) console.log(v) }
  await sleep(s.wait ?? 800)
  if (!s.shot) continue // a setup-only step
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, `${s.shot}.png`), Buffer.from(shot.result.data, 'base64'))
  console.log('saved', s.shot)
}
ws.close(); chrome.kill()
