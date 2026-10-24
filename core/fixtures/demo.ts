import type { WorkItem } from '../src/types.ts'

/** Demo to-dos shown when a system has no credentials. Modelled on docs/design/01-workbench-option-a.webp. */
export const demoZentao: WorkItem[] = [
  {
    ref: 'BUG-4821', source: 'zentao', priority: 'P0', project: '云支付 / payment-core', zentaoProductId: 12,
    title: '支付回调幂等修复', statusText: '进行中', due: '2026-10-23',
    description: '灰度环境出现同一笔支付回调重复入账 3 次，回调重试请求会再次写入流水。需在不影响正常回调的前提下补齐幂等校验，重复请求直接返回已处理结果。',
    acceptance: ['重复回调不重复入账（以回调流水号 + 商户订单号为幂等键）', '补单场景幂等覆盖 ≥ 3 个场景并有单测', '灰度 24h 无重复入账告警，提供回滚开关'],
    related: [
      { label: '分支 fix/pay-callback-idempotent', detail: 'payment-core' },
      { label: 'Jenkins payment-core #471', detail: '依赖下载超时（已重试）' },
      { label: 'MR !11287', detail: 'teleone-order 订单拆分重构（相关改动）' },
    ],
    url: 'https://zentao.example.com/bug-view-4821.html',
  },
  {
    ref: 'REQ-316', source: 'zentao', priority: 'P2', project: '数据中心 / report',
    title: '需求澄清：报表导出字段口径', statusText: '待澄清', due: '2026-10-24',
    description: '运营提出报表导出需增加「实收金额」与「退款金额」两列，口径与财务对账表不一致。需要与产品确认口径并输出澄清结论，必要时补充到需求单。',
    acceptance: ['列出两列的口径定义与数据来源表', '标注与财务对账表的差异点', '给出研发改动范围评估'],
    related: [{ label: '需求单 REQ-316', detail: '产品：李薇' }], url: 'https://zentao.example.com/story-view-316.html',
  },
  {
    ref: 'BUG-4809', source: 'zentao', priority: 'P2', project: '认证中心 / auth', zentaoProductId: 8,
    title: '缺陷回归：登录超时提示文案', statusText: '待验证', due: '2026-10-26',
    description: '登录会话过期后提示「系统错误」，应提示「登录已过期，请重新登录」。测试已验证修复，需补充回归用例。',
    acceptance: ['过期提示文案与产品确认一致', '补充一条登录过期的 e2e 回归用例'],
    related: [{ label: '分支 fix/login-expired-tip', detail: 'auth-center' }], url: 'https://zentao.example.com/bug-view-4809.html',
  },
  {
    ref: 'TASK-902', source: 'zentao', priority: 'P1', project: '云支付 / api', zentaoProductId: 12,
    title: '接口联调：退款查询接口对接', statusText: '进行中', due: '2026-10-27',
    description: '与渠道方联调退款结果查询接口，处理 5 种退款状态映射，超时与未知状态需要重试并落库告警。',
    acceptance: ['5 种渠道状态全部映射到内部状态机', '超时重试 3 次后落告警表', '联调记录写入文档'],
    related: [{ label: '渠道文档 v2.3', detail: '退款查询' }], url: 'https://zentao.example.com/task-view-902.html',
  },
  {
    ref: 'BUG-4815', source: 'zentao', priority: 'P2', project: '订单服务 / teleone-order', zentaoProductId: 5,
    title: '缺陷：订单列表分页越界', statusText: '待验证', due: '2026-10-28',
    description: '订单列表在最后一页点击下一页时返回空数组且总数异常（total 被重置为 0）。',
    acceptance: ['最后一页点击下一页保持当前页并提示', 'total 不被重置', '补充分页边界单测'],
    related: [{ label: '分支 fix/order-pagination', detail: 'teleone-order' }], url: 'https://zentao.example.com/bug-view-4815.html',
  },
  {
    ref: 'BUG-4818', source: 'zentao', priority: 'P2', project: '数据中心 / export', zentaoProductId: 9,
    title: '缺陷：导出任务并发上限报错', statusText: '进行中', due: '2026-10-27',
    description: '同时发起超过 5 个导出任务时，第 6 个任务直接返回 500，应排队等待。',
    acceptance: ['超出并发上限的任务进入排队状态', '队列长度与等待时间在页面可见'],
    related: [], url: 'https://zentao.example.com/bug-view-4818.html',
  },
  {
    ref: 'DOC-77', source: 'zentao', priority: 'P3', project: '云支付 / docs', zentaoProductId: 12,
    title: '文档：支付回调时序图补充', statusText: '待处理', due: undefined,
    description: '补充回调重试、补单、幂等判断三个场景的时序图，放入 payment-core/docs。',
    acceptance: ['三张时序图（mermaid）', '与代码行为一致'],
    related: [], url: 'https://zentao.example.com/task-view-77.html',
  },
]

export const demoGitlab: WorkItem[] = [
  {
    ref: '!11287', source: 'gitlab', priority: 'P1', project: '订单服务 / teleone-order', gitlabProjectId: 101,
    title: 'MR !11287 代码评审：订单拆分重构', statusText: '待评审', due: '2026-10-24',
    description: '张伟 提交了 refactor/order-split → master：拆分订单聚合为主单与子单，涉及 38 个文件。需评审事务边界与历史数据兼容。',
    acceptance: ['指出事务边界与幂等问题，给出可执行的修改建议', '确认历史订单数据迁移脚本可回滚', '不直接修改代码，评审意见写成清单'],
    related: [{ label: 'refactor/order-split → master', detail: '张伟' }, { label: '关联缺陷 BUG-4821' }],
    url: 'https://gitlab.example.com/teleone/teleone-order/-/merge_requests/11287',
  },
  {
    ref: '!11290', source: 'gitlab', priority: 'P2', project: '订单服务 / teleone-order', gitlabProjectId: 101,
    title: 'MR !11290 评审：缓存键规范调整', statusText: '待评审', due: '2026-10-25',
    description: '王磊 提交了 feat/cache-key → master：统一缓存键前缀并增加版本号。',
    acceptance: ['确认旧键的兼容与回收策略', '评审命名规范与文档'],
    related: [{ label: 'feat/cache-key → master', detail: '王磊' }],
    url: 'https://gitlab.example.com/teleone/teleone-order/-/merge_requests/11290',
  },
  {
    ref: '!11292', source: 'gitlab', priority: 'P2', project: '基础设施 / infrastructure', gitlabProjectId: 77,
    title: 'MR !11292 评审：网关限流配置', statusText: '待评审', due: '2026-10-28',
    description: '赵敏 提交了 feat/gateway-ratelimit → master：新增按租户限流配置。',
    acceptance: ['确认限流阈值默认值与降级行为', '检查配置热更新是否安全'],
    related: [{ label: 'feat/gateway-ratelimit → master', detail: '赵敏' }],
    url: 'https://gitlab.example.com/teleone/infrastructure/-/merge_requests/11292',
  },
]

export const demoJenkins: WorkItem[] = [
  {
    ref: 'order-service #2145', source: 'jenkins', priority: 'P1', project: '订单服务 / order-service', jenkinsJob: 'order-service',
    title: '构建失败：order-service #2145（单测 3 个失败）', statusText: '失败', due: '2026-10-23',
    description: 'order-service 最近一次构建 #2145 失败：OrderSplitServiceTest 中 3 个用例断言失败，疑似与拆单重构分支有关。',
    acceptance: ['定位 3 个失败用例的根因', '修复后本地 mvn test 通过', '说明是否需要重新触发构建'],
    related: [{ label: 'order-service #2145', detail: 'FAILURE' }, { label: 'MR !11287', detail: '最近合入的改动' }],
    url: 'https://jenkins.example.com/job/order-service/2145/',
  },
  {
    ref: 'teleone-web #887', source: 'jenkins', priority: 'P2', project: '前端 / teleone-web', jenkinsJob: 'teleone-web',
    title: '构建失败：teleone-web #887（lint 报错）', statusText: '失败', due: '2026-10-24',
    description: 'teleone-web #887 在 lint 阶段失败：src/pages/order 下 4 处 no-unused-vars 与 1 处 import 排序错误。',
    acceptance: ['修复全部 lint 报错', 'pnpm lint 本地通过'],
    related: [{ label: 'teleone-web #887', detail: 'FAILURE' }],
    url: 'https://jenkins.example.com/job/teleone-web/887/',
  },
]

/** Sparkin tasks assigned to me (demo). Task ids follow DemoSparkin: `<project>-T<n>`, n = position in its six task types. */
export const demoSparkin: WorkItem[] = [
  {
    ref: 'SPK-2031', source: 'sparkin', priority: 'P1', project: '云支付平台 · 需求开发', sparkinProjectId: 'SP-PAY', sparkinTaskId: 'SP-PAY-T2',
    title: '渠道对账报表开发', statusText: '进行中', due: '2026-10-30',
    description: '按渠道、按日维度生成对账差异报表，差异明细可导出。数据来源为支付流水表与渠道账单表。',
    acceptance: ['按渠道 + 日期筛选并展示差异笔数与金额', '差异明细可导出 CSV', '补充报表口径的单元测试'],
    related: [{ label: 'Sparkin 任务 SPK-2031', detail: '预估 16h，已填报 6h' }], url: 'https://sparkin.example.com/task/SPK-2031',
  },
  {
    ref: 'SPK-2034', source: 'sparkin', priority: 'P2', project: '订单中心 · 联调与测试', sparkinProjectId: 'SP-ORDER', sparkinTaskId: 'SP-ORDER-T5',
    title: '订单取消流程联调与测试', statusText: '未开始', due: '2026-10-28',
    description: '与库存、支付两个上下游联调订单取消流程，覆盖已支付取消、超时自动取消、部分发货取消三种场景。',
    acceptance: ['三种取消场景联调通过并留有用例记录', '库存回补与退款状态一致'],
    related: [{ label: 'Sparkin 任务 SPK-2034', detail: '预估 8h' }], url: 'https://sparkin.example.com/task/SPK-2034',
  },
  {
    ref: 'SPK-2040', source: 'sparkin', priority: 'P2', project: '基础设施 · 文档与周报', sparkinProjectId: 'SP-INFRA', sparkinTaskId: 'SP-INFRA-T6',
    title: '10 月第 4 周研发周报', statusText: '未开始', due: '2026-10-25',
    description: '汇总本周已完成的任务、合并的 MR、构建情况与下周计划。',
    acceptance: ['按项目列出本周完成项', '标注风险与下周计划'],
    related: [{ label: 'Sparkin 任务 SPK-2040', detail: '预估 1h' }], url: 'https://sparkin.example.com/task/SPK-2040',
  },
  {
    ref: 'SPK-2045', source: 'sparkin', priority: 'P1', project: '认证中心 · 需求开发', sparkinProjectId: 'SP-AUTH', sparkinTaskId: 'SP-AUTH-T2',
    title: '登录风控规则接入', statusText: '未开始', due: '2026-10-29',
    description: '登录流程接入风控规则服务：异常 IP / 设备命中时要求二次验证，规则服务不可用时降级放行并告警。',
    acceptance: ['命中规则时要求二次验证', '风控服务超时 / 报错时降级放行并记录告警', '补充降级路径的单测'],
    related: [{ label: 'Sparkin 任务 SPK-2045', detail: '预估 12h' }], url: 'https://sparkin.example.com/task/SPK-2045',
  },
]

export const DEMO_ITEMS: WorkItem[] = [...demoZentao, ...demoGitlab, ...demoJenkins, ...demoSparkin]

/** Is this (a to-do, or a card's source + text) one of the built-in demo to-dos? Same source and number, and the same title or background. */
export const isDemoItem = (x: { source: string; ref: string; title: string; description: string }) =>
  DEMO_ITEMS.some((d) => d.source === x.source && d.ref === x.ref && (d.title === x.title || d.description === x.description))
