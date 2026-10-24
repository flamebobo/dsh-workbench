import { rpc } from './api.ts'

interface Feed { boot: string; last: number; enabled: boolean; items: { id: number; kind: string; issueId: string; title: string; text: string }[] }
const KIND = { review: '等你审核', blocked: '任务阻塞', writeback: '已回写禅道' } as Record<string, string>

declare global { interface Window { __wbOpen?: boolean; __wbPending?: string } }

/** Show the workbench and, if it knows how, jump to the card. The page may not be mounted yet, so the card id waits on `window`. */
export function openWorkbench(issueId?: string) {
  window.focus()
  window.__wbPending = issueId
  window.dispatchEvent(new CustomEvent('wb:open', { detail: { issueId } }))
  if (window.__wbOpen) return
  // the sidebar entry is the only way into the page; click it like the user would
  const entry = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '工作台' || b.textContent?.trim() === '工作台')
  entry?.click()
}

export const notificationState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

/** Ask for permission (needs a click) and show a test notification. */
export async function testNotification(): Promise<string> {
  if (typeof Notification === 'undefined') return '这个环境不支持桌面通知'
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (perm !== 'granted') return '通知权限被拒绝，请在系统设置里允许 DeepSeek Harness 的通知'
  const n = new Notification('研发工作台', { body: '这是一条测试通知：任务进入待审核或被阻塞时会这样提醒你。' })
  n.onclick = () => openWorkbench()
  return '已发送测试通知'
}

/**
 * Runs for as long as the app is open (started from the plugin's client entry, not from the page): polls the Host for what is new
 * and shows a desktop notification when the user is not looking at the workbench. Never throws; the next tick tries again.
 */
export function startNotifier(): () => void {
  let boot: string | undefined
  let after: number | undefined
  const tick = async () => {
    try {
      const feed = await rpc<Feed>('notices.since', { after: after === undefined ? undefined : after })
      if (feed.boot !== boot) { boot = feed.boot; after = feed.last; return } // first look, or the Host restarted: start from now
      after = Math.max(after ?? 0, ...feed.items.map((i) => i.id), feed.last)
      if (!feed.enabled || notificationState() !== 'granted') return
      const looking = window.__wbOpen && document.hasFocus() && !document.hidden
      if (looking) return
      for (const i of feed.items.slice(-3)) { // a burst shows the latest few, not a wall
        const n = new Notification(`${KIND[i.kind] ?? '研发工作台'} · ${i.title}`, { body: i.text, tag: `wb-${i.id}` })
        n.onclick = () => { n.close(); openWorkbench(i.issueId) }
      }
    } catch { /* Host not ready or restarting */ }
  }
  void tick()
  const id = setInterval(() => { void tick() }, 4000)
  return () => clearInterval(id)
}
