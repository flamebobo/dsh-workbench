# 实现笔记（与源码/提示不一致之处、踩坑、结论）

## 第 1 步结论（2026-10-23，DSH 0.2.1-rc.2，桌面版 + CLI web profile 均验证）

| 检查 | 结果 |
| --- | --- |
| 侧栏出现「工作台」+ 整页（`sidebar.panellist` + `main`，同一个 key=`workbench`） | 通过。桌面版与 web 均显示 |
| 页面 ↔ Host | `ctx.connection.rpc.handle('/workbench')` **页面够不着**：`rpc.call('/workbench', …)` POST `/workbench/ping` 返回 HTTP 405（物理路由只挂在 webServer 前缀上，浏览器/桌面 carrier 只代理 `/api`）。改用 **`ctx.connection.fetch.register({ path: '/api/workbench.rpc', methods: ['POST'] })`** + 页面 `fetch('api/workbench.rpc')`（文档相对路径）→ 通过 |
| Host `ctx.agents.create` 会话 + `turn/end` | 通过。`ctx.on('session/event', (session, event))` 里 `event.type === 'turn/end'`，`event.data.reason.kind` ∈ `completed|aborted|blocked|error|max-tokens|interrupted`；错误细节在 `reason.error.message` |

## 与提示/文档的差异、坑

- `rpc.handle` 内部读 `owner.webServer`，函数式插件的 `export const inject = [...]` 里即使写了 `webServer` 也不够（报 `cannot get property "webServer" without inject`），要用 `ctx.inject(['connection','webServer'], c => …)`。因为上面改用 `fetch.register`，最终没用 rpc.handle。
- `export default` 会让 Loader 丢掉 `inject`（见 `_ref/deepseek-harness/docs/postmortem/0001`），Host 入口只用具名导出。
- Node 22 不支持 `await using`（webhook 示例里用了），改成 `try/finally` + `scope[Symbol.asyncDispose]()`。
- 桌面版安装方式是 `dsh plugin --profile desktop add <目录>`（桌面端必须先退出）。安装是 `link:`，所以改 `client.js` 之后刷新页面即可，改 `index.js`（Host）需要重启宿主。
- 调试环境：用桌面版自带的 CLI 起 web profile，免重启桌面端：
  `dsh plugin --profile web add <dsh-plugin 目录>`，然后 `dsh --profile web --patch <overlay.yml> --no-open --port 3080`。
  web profile 默认模型走 `deepseek-official`（需 `DEEPSEEK_API_KEY`），用 overlay 把 `agent-default-model` 设成桌面端同款 `provider: deepseek-account / model: deepseek-flash`，凭据共用 `~/.dsh/.credentials.yaml` 的账号登录，不需要额外填 Key。`--patch` 必须写在 `--profile web` 之后、不能写在 `dsh web` 之后。
- 不要用宽泛的 `pkill -f dsh…`：会把桌面端的 `dsh-desktop-host` 进程一起杀掉。

## 第 2–4 步补充

- `core/` 在 Node 22 下直接以 TypeScript strip-only 模式跑测试（`node --test core/test/*.test.ts`），因此不用 enum / 参数属性；Host 与页面由 esbuild 打包（`scripts/build.mjs`），Host 产物是单文件 ESM、不依赖任何 `@deepseek-ai/*` 包（Cordis 上下文在边界处是 `any`）。
- Agent Preset：`ctx.agentPresets.register({ id, name, description, order, plugins: [...] })`，`plugins` 是与 `*.patch.yml` 里 `@deepseek-ai/dsh-agent-preset` 的 `config.plugins` 同形的数组（`!!js` 表达式要在代码里直接求值，如 `disabled: process.platform === 'win32'`）。重复保存时先调旧注册的 disposer 再注册。注册失败时开工回退到 `standard` 预设，并把智能体指令拼到首条消息前。
- 会话创建照 `webhook/src/session.ts`：`workspaceRegistry.create(cwd)` → `agents.create({ sessionId, meta: { cwd, agentPreset }, agentOptions, setup: mount })` → `workspace.attachSession` → `permissionPresets.set(session, 'workspace-write')` → `sessionTitle.rename` → `agent.followup(userMessage)`。用户消息就是 `{ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }`，不需要 import `createUserMessage`。
- 跳到会话：页面 `ctx.uiWorkspace.openSession(sessionId)`（客户端 inject `uiWorkspace`），会话立即在侧栏对应工作区下可见。
- 页面插槽：`sidebar.panellist` 的 `id` 必须等于 `main` 的 `key` 才会联动；图标 props 是 `{ size, active }`。
- 样式只用 `--dsw-alias-*`（label-primary/secondary/tertiary、bg-base、bg-layer-1/2、border-l1/l2、interactive-bg-hover、state-business/error/success/warn-primary），外加 `color-mix` 做淡色底。
- 计算机操作截图有一帧延迟：点击后需 ≥3 秒再截图才是结果态。

## 设置页与构建验证

- 凭据读写：`ctx.credentials.resolve/set/unset(name)`（名字沿用 `WORKBENCH_*`，写进 `~/.dsh/.credentials.yaml`，已存值优先于 env）。页面经 `connections.*` 接口只拿到 `set: boolean`，密码类字段永远不回显。测试中往真实凭据库写过 mock 值，已用「清除」还原（`grep WORKBENCH ~/.dsh/.credentials.yaml` 为空）。
- Jenkins：`POST /job/<a>/job/<b>/build|buildWithParameters?K=V`，先取 `/crumb-issuer/api/json`（失败就忽略），成功返回 201 + `Location: /queue/item/N/`；状态：`/queue/item/N/api/json`（`executable` 出现即有构建号）→ `<buildUrl>api/json?tree=building,result,number`。
- `WORKBENCH_HOME` 环境变量可改数据目录（默认 `~/.workbench`），用于并行起第二个 DSH profile 调试而不碰桌面端的数据。
