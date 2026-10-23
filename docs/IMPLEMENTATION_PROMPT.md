# 实现任务：研发工作台 DSH 插件（明日演示版，10/24）

完整方案见文档《研发工作台插件技术方案（DSH / Codex 双宿主）》：https://claude.ai/artifact/6rQCeuvKshscDGuNQqnPsY
（能用 Artifact 工具 read 就读一遍；读不了也没关系，下面已包含实现所需的全部信息。）

## 一句话目标

明天给领导演示：在 DeepSeek Harness（DSH）桌面端左侧栏点「工作台」，看到我的待办 / 看板 / 智能体 / 项目四个页面；在待办上点「开工」，看板出现卡片，并**真实拉起一个 DSH Agent 会话**，会话结束后卡片自动进入「待审核」。

## 演示验收（逐条要能当场演示）

1. 插件安装后，DSH 左侧栏出现「工作台」图标，点开是整页（不是弹窗、不是 iframe）。
2. **我的待办**：禅道 Bug/任务、GitLab 待我评审的 MR、Jenkins 失败构建合并成一张表（优先级、标题、来源编号、项目、状态、截止）。右侧详情面板显示背景、验收标准、关联信息，底部「开工」按钮。配置了凭据就拉真实数据，否则用内置演示数据，页面顶部标注「演示数据」。
3. **开工**：在看板建卡片（进行中）→ 在该项目的工作目录里用代码创建 DSH 会话，第一条消息包含待办标题、详情、验收标准 → 会话出现在 DSH 侧栏会话列表里，可点进去看。会话 `turn/end` 正常结束 → 卡片「待审核」；出错 → 「已阻塞」。同一个来源编号只能开一张卡。
4. **看板**：六列 待规划 / 待办 / 进行中 / 待审核 / 已完成 / 已阻塞；拖拽改状态；卡片显示来源编号、标题、智能体、更新时间；点卡片打开详情（标题、描述、指派智能体、状态、关联会话跳转）。
5. **智能体**：预置 全栈工程师、代码审查员、测试工程师、构建修复员、周报助手；可编辑名称、描述、系统指令、模型；保存后注册为 DSH Agent Preset，开工时按卡片的智能体使用。
6. **项目**：手工维护「工作目录路径 ↔ GitLab 项目 ID ↔ 禅道产品 ID ↔ Jenkins Job 名」，开工时用工作目录作为会话 cwd。

UI 参考（项目内 `docs/design/`）：
- `01-workbench-option-a.webp` 左半「方案 A」= 我的待办的目标样子（浅色表格 + 右侧详情 + 开工按钮）
- `02-board.webp` 看板、`03-agents.webp` 智能体、`04-projects.webp` 项目、`05-task-detail.webp` 任务详情（这几张是 better-codex 的暗色截图，只参考布局，配色跟随 DSH 主题）

## 演示版明确不做

Codex 插件与 Codex 驱动、提交 MR / 触发 Jenkins / 回写禅道、Sparkin、独立评估器（用上面的规则代替）、workbench MCP 工具服务、git worktree 自动创建、npm 发布、远程访问。有余力也先别做，先把上面 6 条做扎实。

## 架构（演示版）

```text
dsh-plugin/            ← 本仓库根目录
  core/                纯 TypeScript 库：领域模型、存储、连接器、AgentDriver 接口。禁止 import 任何 @deepseek-ai/* 包
  ui/                  React 页面（待办/看板/智能体/项目），打包成 dsh-plugin/client.js
  dsh-plugin/          DSH 插件包：package.json、cordis.patch.yml、index.js（Host 面）、client.js（浏览器面）、locale、icon
  docs/
```

- `core` 演示版直接被 DSH 插件 Host 进程 import（同进程），不起独立服务。之后接 Codex 时再给 core 加独立服务入口，所以 core 必须与 DSH 解耦。
- 存储：core 用一个 JSON 文件 `~/.workbench/workbench.json`（写临时文件再 rename 的原子写），按 `projects / issues / agents / runs` 组织。加 `// ponytail:` 注释说明之后换 SQLite。不要引入数据库依赖。
- 状态枚举沿用 better-codex：`backlog | todo | in_progress | in_review | done | blocked`。`done` 只能由人设置。
- AgentDriver 接口（core 里定义，DSH 实现放 dsh-plugin）：

```ts
interface AgentDriver {
  id: 'dsh' | 'codex'
  listModels(): Promise<{ id: string; name: string }[]>
  start(req: { runId: string; cwd: string; title: string; prompt: string
    profile: { presetId: string; model?: string; instructions: string } }): Promise<{ sessionId: string }>
  send(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<void>
  interrupt(sessionId: string): Promise<void>
  onEvent(cb: (e: DriverEvent) => void): () => void
}
type DriverEvent =
  | { type: 'turn.started'; runId: string; sessionId: string }
  | { type: 'message'; runId: string; text: string }
  | { type: 'turn.completed'; runId: string; status: 'completed' | 'interrupted' | 'failed'; finalText?: string; error?: string }
```

## 参考源码（先拉到项目内 `_ref/`，加进 .gitignore）

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness _ref/deepseek-harness
git clone --depth 1 https://github.com/Ericwong5021/better-codex _ref/better-codex
```

DSH（0.2.1-rc.2，developer preview，接口以源码为准）必读：

| 要做的事 | 看哪里 |
| --- | --- |
| 第三方插件开发规范（**必读**） | `packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md` |
| 最小插件模板（照抄起步） | `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/` |
| `package.json` 的 `dsh` 字段 | `packages/util/package-manifest/src/types.ts` |
| 整页 + 侧栏入口的写法 | `packages/client/ui-schedule/src/client/index.ts`（`main` 插槽 + `sidebar.panellist` 插槽） |
| 插槽说明 / 插槽清单 | `docs/subsystems/slots.md`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| 浏览器面模块格式、可 `require` 的模块 | `docs/subsystems/client-modules.md`、`packages/client/web/src/platform.ts` |
| 页面 ↔ Host 通信 | `packages/client/connection/src/rpc.ts`（`ctx.connection.rpc.handle` / `rpc.call`）、`ctx.connection.fetch.register`、`docs/api-gateway.md`、`packages/experimental/client-ui-voice-input/src/client/mount.ts` |
| 用代码创建会话（**照这个写 DSH 驱动**） | `packages/experimental/webhook/src/session.ts` 约 117–180 行 |
| Agent API 与事件（`followup`、`turn/end`、`agent/status`） | `docs/subsystems/core.md` |
| Agent Preset 注册 | `ctx.agentPresets.register(...)`；示例 `packages/bundle/web-app/presets/*.patch.yml` |
| 凭据 | `packages/credentials/credentials`（`ctx.credentials.resolve(ref)`，本地叠加 env 与 `$DSH_HOME/.env`） |
| 安装到桌面版 | `apps/desktop/README.md` 约 133 行：先退出桌面端，`dsh plugin --profile desktop add <目录>` |
| 版本约束 | `package.json` 写 `"engines": { "dsh": ">=0.2.0 <0.3.0" }` |

better-codex（只参考产品形态和状态逻辑，不要 fork）：`src/db.ts`（状态与领取条件）、`src/ui/features/{board,agents,projects}/`。

DSH 开发规范里的硬约束：
- 运行时不要 `require` DSH 的客户端 UI 包（`dsh-client-ui-primitives` 等），样式只用 `--dsw-alias-*` 主题变量，组件自己写。
- 不要从 Host 输出 iframe 页面。
- 不要往会话里追加自定义 `type` 的事件。
- React 用 DSH 提供的 `require('react')`；`client.js` 用 esbuild 自己打包成 `window.__ModuleLoader__.load({ id, factory(require) {...} })` 格式，react / react-dom 设为 external。仓库内的 tsdown 预设依赖内部脚本，用不了。

## 连接器（真实实现 + 演示数据）

凭据通过 `ctx.credentials` 读取，以下名字写进 `$DSH_HOME/.env` 即可生效；任一系统缺凭据就用该系统的演示数据：

| 系统 | 凭据 | 演示版只读接口 |
| --- | --- | --- |
| 禅道（开源版，版本未知） | `WORKBENCH_ZENTAO_URL` / `_ACCOUNT` / `_PASSWORD` | 先 `POST {url}/api.php/v1/tokens {account,password}` 取 token，请求头 `Token`；`GET /api.php/v1/products/{id}/bugs`、`GET /api.php/v1/executions/{id}/tasks`，客户端按指派人过滤。v1 不可用就降级为演示数据并在页面提示 |
| GitLab | `WORKBENCH_GITLAB_URL` / `_TOKEN` | 请求头 `PRIVATE-TOKEN`；`GET /api/v4/user` 取用户名，`GET /api/v4/merge_requests?scope=all&state=opened&reviewer_username=<me>` |
| Jenkins | `WORKBENCH_JENKINS_URL` / `_USER` / `_TOKEN` | Basic 认证；`GET /api/json?tree=jobs[name,url,color,lastBuild[number,result,timestamp,url]]`，`color` 含 `red` 视为失败 |

Token 不进提示词、不进前端、不进日志。演示数据放 `core/fixtures/`，内容仿照 `01-workbench-option-a.webp` 里的条目（BUG-4821 支付回调幂等等），要像真的。

## 执行顺序（每步有检查点，过不了不要往下走）

0. **环境**：本机目前**没有安装 DSH**（没有 `dsh` 命令，也没有桌面版）。Node 是 v22.22.2（满足 `^22.19.0`）。
   - 请用户从 DSH 官网安装桌面版并登录 DeepSeek 账号/API Key（下载和登录必须由用户做，先问）。
   - 开发调试可用 CLI：`npm i -g @deepseek-ai/dsh` 后 `dsh web --port 3080`（profile `web`），插件同样适用于桌面版 profile `desktop`。
   - 确认版本是 0.2.x；不是就停下汇报。`git init`，加 `.gitignore`（`node_modules`、`_ref`、`dist`）。
1. **最小插件跑通（1 小时内）**：照 decoration 模板建 `dsh-plugin/`，注册 `sidebar.panellist` 图标 + `main` 整页显示「工作台 Hello」；页面调一个 Host 接口返回 `pong`（先试 `ctx.connection.rpc.handle`/`rpc.call`，不行再试 `ctx.connection.fetch.register`，把结论写进 `docs/NOTES.md`）；Host 面用 `ctx.agents.create` 建一个会话发 "你好" 并收到 `turn/end`。三件事都截图确认。**任何一件不通，停下来汇报卡在哪、试过什么。**
2. **core**：模型 + JSON 存储 + 三个连接器 + 演示数据 + 开工逻辑（去重、建卡、组装第一条消息、事件 → 状态）。用 `node:test` 给状态流转、去重、连接器响应解析写测试，跑通。
3. **ui**：四个页面，先待办和看板，再智能体和项目。
4. **DSH 驱动 + 串起来**：开工 → 会话出现在 DSH 侧栏 → 结束后卡片进待审核；智能体保存后注册 Preset。
5. **演示走查**：按「演示验收」6 条逐条操作并截图存到 `docs/demo/`；写 `docs/DEMO.md`（安装命令、配置凭据、演示脚本 5 分钟版）。

## 工作方式

- 安装插件到桌面版需要先退出 DSH 桌面端：**先问用户**再操作。不要改 DSH profile 以外的任何配置。
- 每完成一步 `git commit`（说明为什么改），不要 push。
- 源码和本文描述不一致时以源码为准，差异记进 `docs/NOTES.md`。
- 最后汇报：哪些真实可用、哪些是演示数据、已知问题、截图路径。
