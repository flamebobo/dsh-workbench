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
