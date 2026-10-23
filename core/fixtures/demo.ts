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
