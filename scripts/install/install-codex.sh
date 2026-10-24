#!/usr/bin/env bash
# 研发工作台 Codex 版：安装 / 更新（macOS、Linux）。在本仓库或解压后的安装包目录里运行，两种布局都认。
# 做两件事：把这个目录登记为本地插件市场（workbench-local），再从里面安装 workbench 插件。
# 数据在 ~/.workbench-codex（与 DSH 版的 ~/.workbench 分开），重装不会动它。
#   CODEX_BIN=/path/to/codex ./install-codex.sh   指定 codex 命令
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

# 仓库里脚本在 scripts/install/，安装包里和 codex-plugin/ 同级
ROOT="$HERE"; [ -f "$ROOT/.agents/plugins/marketplace.json" ] || ROOT="$(cd "$HERE/../.." && pwd)"
[ -f "$ROOT/.agents/plugins/marketplace.json" ] && [ -f "$ROOT/codex-plugin/server.mjs" ] || die "找不到 .agents/plugins/marketplace.json 或 codex-plugin/server.mjs（在仓库里请先运行 npm run build:codex）。"

CODEX="${CODEX_BIN:-}"
[ -n "$CODEX" ] || CODEX="$(command -v codex || true)"
for c in /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex /Applications/Codex.app/Contents/Resources/codex; do [ -n "$CODEX" ] || { [ -x "$c" ] && CODEX="$c"; }; done
[ -n "$CODEX" ] || die "没有找到 codex 命令。请先安装 Codex 桌面端（或 codex CLI），或用 CODEX_BIN=/path/to/codex 指定。"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] || die "插件的 MCP 服务需要 Node.js 20 或更高版本（当前：$(node -v 2>/dev/null || echo 未安装)）。"

# 1. 本地插件市场：已登记但指向别的目录时先移除，再登记当前目录
EXISTING="$("$CODEX" plugin marketplace list 2>/dev/null | awk '$1=="workbench-local"{print $2}')"
if [ -n "$EXISTING" ] && [ "$EXISTING" != "$ROOT" ]; then "$CODEX" plugin marketplace remove workbench-local; EXISTING=""; fi
[ -n "$EXISTING" ] || "$CODEX" plugin marketplace add "$ROOT"

# 2. 安装（重复运行 = 用当前目录里的版本更新）
"$CODEX" plugin add workbench@workbench-local

# 3. 旧版本的本地服务在下次打开工作台时会自动换成新版本；这里顺手停掉，避免继续用旧代码
node "$ROOT/codex-plugin/server.mjs" stop >/dev/null 2>&1 || true

say "已安装研发工作台 Codex 版 $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/codex-plugin/plugin.json" | head -1)。"
say "请重启 Codex 桌面端，在左侧栏打开「研发工作台」。这个目录（$ROOT）是插件市场的来源，请不要删除或移动它。"
