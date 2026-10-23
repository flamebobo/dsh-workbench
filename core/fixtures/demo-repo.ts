/** Files seeded into the demo payment-core working directory so BUG-4821 can really be worked on. */
export const paymentCoreFiles: Record<string, string> = {
  'README.md': `# payment-core（演示用）

支付核心服务的最小演示仓库。BUG-4821：渠道回调重试会让同一笔支付重复入账。
运行测试：\`node --test\`
`,
  'package.json': JSON.stringify({ name: 'payment-core-demo', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'src/ledger.js': `// 内存流水表，生产环境对应 t_pay_ledger。
export const ledger = []
export function resetLedger() { ledger.length = 0 }
export function writeLedger(entry) { ledger.push({ ...entry, at: Date.now() }) }
`,
  'src/pay-callback.js': `import { writeLedger } from './ledger.js'

/**
 * 处理渠道支付回调。渠道在超时未收到应答时会重试同一笔回调（相同 callbackNo）。
 * 返回 { status: 'ok' } 表示已处理。
 */
export function handlePayCallback({ callbackNo, orderNo, amount }) {
  // BUG-4821：这里没有任何幂等判断，重试的回调会再次写入流水。
  writeLedger({ callbackNo, orderNo, amount })
  return { status: 'ok' }
}
`,
  'test/pay-callback.test.js': `import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { ledger, resetLedger } from '../src/ledger.js'
import { handlePayCallback } from '../src/pay-callback.js'

beforeEach(resetLedger)

test('正常回调入账一次', () => {
  handlePayCallback({ callbackNo: 'cb-1', orderNo: 'o-1', amount: 100 })
  assert.equal(ledger.length, 1)
})

test('同一回调重试不重复入账（BUG-4821）', () => {
  handlePayCallback({ callbackNo: 'cb-2', orderNo: 'o-2', amount: 100 })
  handlePayCallback({ callbackNo: 'cb-2', orderNo: 'o-2', amount: 100 })
  assert.equal(ledger.length, 1)
})
`,
}
