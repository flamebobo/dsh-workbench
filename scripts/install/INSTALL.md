# 研发工作台 安装 / 更新

## 安装（第一次）
1. 先安装 DSH 桌面端并登录一次。
2. 解压本安装包。
3. 打开终端进入解压后的目录：
   - macOS / Linux：`./install.sh`
   - Windows（PowerShell）：`.\install.ps1`
4. DSH 正在运行时脚本会询问是否退出它，回答 y；装完会自动重新打开。
5. 打开 DSH，左侧栏点「工作台」，按首次使用引导连接禅道 / GitLab / Jenkins 并添加项目。

## 更新
工作台顶部出现「有新版本」时，下载新的安装包，解压后运行同一个脚本即可：只替换插件文件并重启 DSH，**你的数据和设置都保留**。
数据格式变化时，新版本首次启动会自动升级数据文件，并先把旧文件备份为 `~/.workbench/workbench.json.v<旧版本>.bak`。

## 提示更新（管理员）
在「设置 → 插件设置 → 关于与更新」填写一个更新地址，它返回：
```json
{ "version": "0.3.0", "url": "https://内网地址/workbench-plugin-0.3.0.zip", "notes": "这个版本改了什么" }
```
工作台每天检查一次，版本更高时在顶部提示并给出下载链接。`npm run pack` 会生成安装包和一份 `latest.json` 模板。

## 卸载
`dsh plugin --profile desktop remove @local/workbench`，然后删除 `~/.workbench/plugin`。数据在 `~/.workbench/workbench.json`，想保留就别删。

## Codex 版
安装包里同时带了 Codex 版（`codex-plugin/`、`.agents/plugins/marketplace.json`）。需要 Codex 桌面端和 Node.js 20+。
1. 把解压后的目录放到一个固定位置（它就是 Codex 的本地插件市场，之后不要删除或移动）。
2. 运行 `./install-codex.sh`（Windows：`.\install-codex.ps1`）。等价于：
   `codex plugin marketplace add <这个目录>`，再 `codex plugin add workbench@workbench-local`。
3. 重启 Codex 桌面端，左侧栏打开「研发工作台」。
数据在 `~/.workbench-codex`，与 DSH 版的 `~/.workbench` 分开；两边暂时不共用看板。更新 = 用新安装包再运行一次脚本。
卸载：`codex plugin remove workbench@workbench-local`、`codex plugin marketplace remove workbench-local`，再运行 `node codex-plugin/server.mjs stop` 停掉本地服务。
