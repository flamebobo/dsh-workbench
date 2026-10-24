#!/bin/zsh
# QA / debug host that cannot touch the real desktop setup: its own DSH home (account copied once, no company credentials),
# its own workbench data dir, and Zentao / GitLab / Jenkins pointed at scripts/qa/mock.mjs on 127.0.0.1:4100.
# Never run it together with the desktop app on the same data; this one uses ~/.workbench-qa and port 3090.
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
cd "$(dirname "$0")/.."
QA="${WORKBENCH_QA_DIR:-$HOME/.workbench-qa}"
mkdir -p "$QA/data"
[ -d "$QA/dsh-home/profiles" ] || { mkdir -p "$QA/dsh-home"; rsync -a --exclude sessions --exclude logs "$HOME/.dsh/" "$QA/dsh-home/"; }
# rsync keeps the profile's relative link: point it at this checkout again
ln -sfn "$PWD/dsh-plugin" "$QA/dsh-home/profiles/web/node_modules/@local/workbench"
export DSH_HOME="$QA/dsh-home" WORKBENCH_HOME="$QA/data"
export WORKBENCH_ZENTAO_URL="${QA_MOCK:-http://127.0.0.1:4100}" WORKBENCH_ZENTAO_ACCOUNT=qa WORKBENCH_ZENTAO_PASSWORD=qa-pass
export WORKBENCH_GITLAB_URL="${QA_MOCK:-http://127.0.0.1:4100}" WORKBENCH_GITLAB_TOKEN=glpat-mock
export WORKBENCH_JENKINS_URL="${QA_MOCK:-http://127.0.0.1:4100}" WORKBENCH_JENKINS_USER=qa WORKBENCH_JENKINS_TOKEN=jk-mock
[ -n "$QA_NO_MOCK_CREDS" ] && unset WORKBENCH_ZENTAO_URL WORKBENCH_ZENTAO_ACCOUNT WORKBENCH_ZENTAO_PASSWORD WORKBENCH_GITLAB_URL WORKBENCH_GITLAB_TOKEN WORKBENCH_JENKINS_URL WORKBENCH_JENKINS_USER WORKBENCH_JENKINS_TOKEN
lsof -ti tcp:3090 | xargs kill 2>/dev/null
exec "$DSH" --profile web --patch scripts/web-model.patch.yml --no-open --port 3090
