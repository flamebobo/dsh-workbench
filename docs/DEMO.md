# 研发工作台 · 演示手册（10/24）

演示的是 DSH 桌面版（0.2.1-rc.2）里的「工作台」插件：待办 → 开工 → 真实 DSH 会话 → 卡片自动流转。

## 1. 安装

先**完全退出** DSH 桌面端，再执行（只改 `desktop` profile）：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /Users/laihuibo/Documents/dsh-plugin/dsh-plugin
```

重新打开 DSH，左侧栏出现「工作台」。安装是 `link:`（指向仓库里的 `dsh-plugin/` 目录）：

- 改页面（`ui/`）：`npm run build`，刷新页面即可。
- 改 Host / core（`host/`、`core/`）：`npm run build` 后重启 DSH 桌面端。
- 仓库里已提交构建产物 `dsh-plugin/index.js`、`dsh-plugin/client.js`，同事机器不需要构建。
- 卸载：退出 DSH 后 `dsh plugin --profile desktop remove @local/workbench`。

## 2. 配置真实数据源（可选；不配就是演示数据）

在 `~/.dsh/.env` 里加（`KEY=VALUE`，任一系统缺凭据就只有该系统用演示数据；改完重启 DSH）：

```bash
WORKBENCH_ZENTAO_URL=https://zentao.example.com
WORKBENCH_ZENTAO_ACCOUNT=me
WORKBENCH_ZENTAO_PASSWORD=...
WORKBENCH_ZENTAO_EXECUTION_IDS=12,15      # 可选：要读任务的迭代/执行 ID，逗号分隔
WORKBENCH_GITLAB_URL=https://gitlab.example.com
WORKBENCH_GITLAB_TOKEN=glpat-...
WORKBENCH_JENKINS_URL=https://jenkins.example.com
WORKBENCH_JENKINS_USER=me
WORKBENCH_JENKINS_TOKEN=...
```

- 禅道 Bug 按「项目」页里配置的**禅道产品 ID** 读取，并按指派给你的过滤。
- 某系统接口失败（例如禅道 v1 REST 不可用）会降级为演示数据，待办页顶部出现红色提示并写明原因。
- 凭据只在 Host 进程里读取，不进页面、不进提示词、不写日志。

## 3. 重置演示数据

数据都在 `~/.workbench/workbench.json`，演示用的工作目录在 `~/.workbench/demo-repos/`。要回到干净状态：退出 DSH → 删除这两处 → 重新打开（首次启动会重新种入 7 个演示项目、5 个智能体）。

```bash
rm -rf ~/.workbench/workbench.json ~/.workbench/demo-repos
```

## 4. 五分钟演示脚本

> 提前量：BUG-4821 的会话大约 1 分钟结束，所以第 2 步尽早点「开工」，边讲边等。

1. **（0:00）待办页**。点侧栏「工作台」。说明：禅道 Bug/任务、GitLab 待我评审的 MR、Jenkins 失败构建合成一张表，按优先级排序；顶部「演示数据」标签表示当前没配凭据（配了就是「实时」）。点第一行 BUG-4821：右侧是背景、验收标准、关联信息（分支、构建、MR），底部是「开工」。
2. **（1:00）开工**。保持选中 BUG-4821 + 「全栈工程师」，点「开工（创建会话）」。页面自动切到**看板**：卡片 `WB-1` 出现在「进行中」，带转圈。看侧栏：`payment-core` 工作区下出现会话「WB-1 支付回调幂等修复」，点开：首条消息里是待办标题、背景、验收标准、关联信息，智能体正在读 `src/pay-callback.js`、跑测试。
3. **（2:30）自动流转**。会话结束后看板卡片**自动进入「待审核」**（不用刷新）。点卡片：详情里有指派智能体、状态、执行记录（最终回复）、「打开关联会话 ↗」。把卡片**拖到「已完成」**——强调「已完成」只能人来设置，智能体只能把它送到待审核。回「我的待办」，BUG-4821 标着 `WB-1`、状态已完成，详情底部不再有「开工」按钮（同一个来源编号只能开一张卡）。
4. **（3:30）智能体**。「智能体」页有 5 个预置角色，改一下全栈工程师的系统指令点「保存」→ 提示「已注册为 DSH 智能体预设」。点侧栏「新会话」→ 模式下拉里出现「工作台 · 全栈工程师」等 5 项：同一份配置，工作台和 DSH 原生会话共用。
5. **（4:15）手工任务（可选）**。看板任意列点 `+`，填标题、描述、验收标准（每行一条）、优先级、项目、智能体后「创建」：卡片进看板，同时出现在「我的待办」里（来源「手工」，有「手工」筛选）。选了项目的任务可直接「创建并开工」，或之后在待办页 / 卡片里点开工；已阻塞的卡片可重新开工。「任务描述」框和 DSH 输入框一样用：输入 `/` 弹出指令菜单（`/plan` 先出方案、`/goal` 设为长任务目标，选中后文字以 `/plan ` 开头）；输入 `@` 在**所选项目的工作目录**里模糊搜索文件（如 `@pcb` 找到 `pay-callback.js`），上下键 + 回车插入；`＋` 按钮、拖入弹窗、或直接粘贴截图，可以加图片和文档；链接直接写在文字里。开工时 `@` 引用的文件列进首条消息（相对工作目录），图片/文档作为真正的 DSH 附件随消息（或随指令）发出；选了 `/plan` 的任务，会话进入计划模式，智能体提交方案后卡片自动转到「待审核」，在会话里点「同意执行」即可继续。
6. **（4:30）项目**。「项目」页是工作目录 ↔ GitLab 项目 ID ↔ 禅道产品 ID ↔ Jenkins Job 的手工映射；开工时用工作目录当会话 cwd。可选演示出错路径：把「前端 / teleone-web」的工作目录改成一个不存在的路径，对 `teleone-web #887` 点开工 → 卡片直接进入「已阻塞」，卡片上写明原因（演示后改回去）。
7. **（4:50）收尾**：配置 `~/.dsh/.env` 就能换成真实数据；下一步是回写禅道/GitLab、触发 Jenkins、接 Sparkin 工时，以及同一个 core 装进 Codex。

## 5. 验收对照（截图在 `docs/demo/`）

| # | 验收项 | 截图 / 证据 |
| --- | --- | --- |
| 1 | 侧栏「工作台」图标 + 整页 | `01-todos.jpg` |
| 2 | 我的待办：合表、详情、开工、演示数据标注 | `01-todos.jpg` |
| 3 | 开工：建卡、真实会话、自动流转、去重、出错阻塞 | `02-board-in-progress.jpg`、`03-session-running.jpg`、`05-board-in-review.jpg`、`07-todos-started-dedup.jpg`、`11-board-blocked.jpg` |
| 4 | 看板：六列、拖拽、卡片详情、会话跳转 | `05`、`06-board-done-drag.jpg`、`04-card-detail.jpg` |
| 3+ | 手工任务：描述框里 `/` 指令、`@` 文件、附件，`/plan` 会话 | `12-task-form.jpg`、`14-task-at-files.jpg`、`13-task-plan-session.jpg` |
| 5 | 智能体：编辑并注册为 DSH Preset | `08-agents-saved.jpg`、`09-presets-in-dsh.jpg` |
| 6 | 项目：映射 + cwd | `10-projects.jpg`、`03-session-running.jpg`（会话在项目目录下） |

自动化测试：`npm test`（node:test，22 条：状态流转、去重、done 仅人可设、重启对账、手工任务进待办并开工、三个连接器的响应解析与请求形状、演示数据与项目的对应）；`npm run typecheck`。

## 6. 已知限制

- 真实的禅道/GitLab/Jenkins 连接器只对照接口文档与样例 JSON 做了单测，并用本地 mock 验证过「凭据 → 实时」这条路径；**没有对着公司真实实例跑过**，禅道开源版 v1 REST 的字段在不同版本可能有出入（失败会降级为演示数据并提示）。
- 附件单个上限 25 MB；`@` 搜索只扫工作目录（跳过隐藏目录、node_modules、dist 等，最多 2 万个文件）；指令只提供 `/plan` 和 `/goal`（需要自由文本输入且能起一轮对话的指令），不是 DSH 全部命令；附件在卡片创建时就存到 `~/.workbench/uploads/`，删除卡片时一并删除。
- `/plan` 任务在智能体提交方案时就转到「待审核」（这一轮要等你批准才结束）；你批准后智能体继续执行，卡片不会自动回到「进行中」。
- 只跟踪会话的**第一轮** `turn/end`：卡片进入待审核/已阻塞后，你在会话里继续追问不会把卡片拉回「进行中」。
- DSH 重启时仍在运行的 run 会被对账为「已阻塞（宿主重启）」。
- 「待办」不回写、不触发任何外部系统（演示版范围）。
- 看板没有「归档」列；只用主题变量上色，暗色主题未逐页核对。
- 提供的智能体模型下拉只有 `deepseek-flash` / `deepseek-pro`，留空跟随 DSH 默认模型。
- 工作区下拉里会多出 `payment-core`、`teleone-order` 等演示工作区（DSH 在开工时登记的），可在 DSH 里自行移除。

## 7. 开发调试（不动桌面端）

```bash
dsh plugin --profile web add "$PWD/dsh-plugin"   # 只需一次
scripts/dev-web.sh                               # http://127.0.0.1:3080，终端会打印带 token 的地址
```

web profile 与桌面端共用 `~/.workbench/workbench.json`，**不要同时运行两个**。
