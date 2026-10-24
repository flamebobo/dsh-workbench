import { execFile } from 'node:child_process'

/** The command that opens a Codex thread in the desktop app (`codex://threads/<id>`), per platform. */
export function openThreadCommand(threadId: string, platform = process.platform): string[] {
  if (!/^[0-9a-f-]{8,64}$/i.test(threadId)) throw new Error(`不是有效的线程 ID：${threadId}`)
  const url = `codex://threads/${threadId}`
  return platform === 'darwin' ? ['open', url] : platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
}

export function openThread(threadId: string): Promise<void> {
  const [bin, ...args] = openThreadCommand(threadId)
  return new Promise((resolve, reject) => execFile(bin!, args, { windowsHide: true }, (e) => (e ? reject(new Error(`没能打开 Codex 线程：${e.message}`)) : resolve())))
}
