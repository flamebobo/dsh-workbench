// `workbench serve | mcp | stop`: the Codex plugin's single entry (bundled to codex-plugin/server.mjs by scripts/build.mjs).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LockError } from '../core/src/index.ts'
import { codexDataDir, runServe, stopServe } from './runtime.ts'

/** Replaced with codex-plugin/plugin.json's version by scripts/build.mjs. */
declare const __WB_VERSION__: string | undefined
const version = typeof __WB_VERSION__ === 'string' ? __WB_VERSION__ : 'dev'
const dir = codexDataDir()
const cmd = process.argv[2]

try {
  if (cmd === 'serve') {
    await runServe({ dir, version, exampleSkillRoot: fileURLToPath(new URL('./examples/skills', import.meta.url)) })
  } else if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp.ts')
    // the page is built next to the bundle (codex-plugin/board.html); read per request so a rebuilt page shows up on reopen
    await runMcp({ dir, version, entry: [process.execPath, process.argv[1]!], boardHtml: () => readFileSync(new URL('./board.html', import.meta.url), 'utf8') })
  } else if (cmd === 'stop') {
    console.log((await stopServe(dir)) ? '工作台本地服务已停止' : '工作台本地服务没有在运行')
  } else {
    console.error('用法：workbench serve | mcp | stop')
    process.exit(2)
  }
} catch (e) {
  console.error(e instanceof LockError ? e.message : e)
  process.exit(1)
}
