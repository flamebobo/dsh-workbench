#!/bin/zsh
# Debug host without touching the desktop app: DSH web profile on :3080 with the desktop's account model.
# One-time: dsh plugin --profile web add "$PWD/dsh-plugin"
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
cd "$(dirname "$0")/.."
lsof -ti tcp:3080 | xargs kill 2>/dev/null
exec "$DSH" --profile web --patch scripts/web-model.patch.yml --no-open --port 3080
