#!/usr/bin/env bash
# 研发工作台：安装 / 更新（macOS、Linux）。同一个脚本两种用途：第一次运行 = 安装，之后运行新版本包里的它 = 更新。
# 插件文件放在固定目录（默认 ~/.workbench/plugin），DSH 的 profile 只记录这个目录的链接，所以更新 = 替换文件 + 重启 DSH。
# 你的数据（~/.workbench/workbench.json）不会被改动。
#   WB_PROFILE=web ./install.sh        装到别的 profile（默认 desktop）
#   WORKBENCH_PLUGIN_DIR=/path ./install.sh   换安装目录
#   DSH_BIN=/path/to/dsh ./install.sh   指定 dsh 命令
#   ./install.sh --yes                 不询问（DSH 正在运行时会自动退出它）
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${WB_PROFILE:-desktop}"
TARGET="${WORKBENCH_PLUGIN_DIR:-$HOME/.workbench/plugin}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
APP_NAME="DeepSeek Harness"
YES=0; [ "${1:-}" = "--yes" ] && YES=1

say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

[ -f "$HERE/dsh-plugin/package.json" ] || die "找不到 $HERE/dsh-plugin，请在解压后的安装包目录里运行本脚本。"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HERE/dsh-plugin/package.json" | head -1)"

# 1. dsh 命令
DSH="${DSH_BIN:-}"
[ -n "$DSH" ] || DSH="$(command -v dsh || true)"
MAC_DSH="/Applications/$APP_NAME.app/Contents/Resources/runtime/cli/bin/dsh"
[ -n "$DSH" ] || { [ -x "$MAC_DSH" ] && DSH="$MAC_DSH"; }
[ -n "$DSH" ] && [ -x "$DSH" ] || die "没有找到 dsh 命令。请先安装 DSH 桌面端并登录一次，或用 DSH_BIN=/path/to/dsh 指定。"

# 2. 桌面端正在运行时，替换文件前要先退出它（不会悄悄杀进程）
RESTART=0
if [ "$PROFILE" = "desktop" ] && [ "$(uname)" = "Darwin" ] && pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null 2>&1; then
  if [ "$YES" = 1 ]; then ANS=y; elif [ -t 0 ]; then read -r -p "$APP_NAME 正在运行，安装需要先退出它（未保存的会话输入会丢）。现在退出吗？[y/N] " ANS; else ANS=n; fi
  case "$ANS" in y|Y) osascript -e "tell application \"$APP_NAME\" to quit" || true
    for _ in $(seq 1 20); do pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null 2>&1 || break; sleep 1; done
    pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null 2>&1 && die "$APP_NAME 没有退出，请手动退出后重新运行。"
    RESTART=1 ;;
  *) die "已取消。请先退出 $APP_NAME 再运行本脚本（或加 --yes）。" ;;
  esac
fi

# 3. 替换插件文件（只会删除一个确认是本插件的目录）
if [ -e "$TARGET" ]; then
  grep -q '"@local/workbench"' "$TARGET/package.json" 2>/dev/null || die "$TARGET 已存在但不是研发工作台插件目录，为避免误删已停止。请换一个 WORKBENCH_PLUGIN_DIR。"
  OLD="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TARGET/package.json" | head -1)"
  rm -rf "$TARGET"
else
  OLD=""
fi
mkdir -p "$(dirname "$TARGET")"
cp -R "$HERE/dsh-plugin" "$TARGET"

# 4. 在 profile 里登记（已经指向这个目录就不用再登记）
PKG="$DSH_HOME_DIR/profiles/$PROFILE/package.json"
if [ -f "$PKG" ] && grep -qF "\"@local/workbench\": \"link:$TARGET\"" "$PKG"; then
  say "profile「$PROFILE」已指向 $TARGET，只替换了文件。"
else
  "$DSH" plugin --profile "$PROFILE" add "$TARGET"
fi

if [ -n "$OLD" ]; then say "已更新研发工作台：$OLD -> $VERSION（数据文件保持不变，旧数据格式会在首次启动时自动升级并备份）。"; else say "已安装研发工作台 $VERSION。"; fi
if [ "$RESTART" = 1 ]; then open -a "$APP_NAME"; say "已重新打开 $APP_NAME。"; else say "请（重新）打开 DSH，在左侧栏点「工作台」。"; fi
