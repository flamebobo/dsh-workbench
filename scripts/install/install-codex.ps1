# 研发工作台 Codex 版：安装 / 更新（Windows PowerShell）。在本仓库或解压后的安装包目录里运行。
# 把这个目录登记为本地插件市场（workbench-local），再从里面安装 workbench 插件。数据在 ~/.workbench-codex，重装不会动它。
#   $env:CODEX_BIN = 'C:\path\to\codex.exe'; .\install-codex.ps1
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = $Here
if (-not (Test-Path (Join-Path $Root '.agents/plugins/marketplace.json'))) { $Root = (Resolve-Path (Join-Path $Here '../..')).Path }
if (-not (Test-Path (Join-Path $Root 'codex-plugin/server.mjs'))) { throw "找不到 codex-plugin/server.mjs（在仓库里请先运行 npm run build:codex）。" }

$Codex = if ($env:CODEX_BIN) { $env:CODEX_BIN } else { (Get-Command codex -ErrorAction SilentlyContinue).Source }
if (-not $Codex) { throw '没有找到 codex 命令。请先安装 Codex（或 codex CLI），或设置 $env:CODEX_BIN。' }
$NodeMajor = 0
try { $NodeMajor = [int](node -p 'process.versions.node.split(".")[0]') } catch {}
if ($NodeMajor -lt 20) { throw '插件的 MCP 服务需要 Node.js 20 或更高版本。' }

$Existing = (& $Codex plugin marketplace list 2>$null | Where-Object { $_ -match '^workbench-local\s+(.+)$' } | ForEach-Object { $Matches[1].Trim() })
if ($Existing -and $Existing -ne $Root) { & $Codex plugin marketplace remove workbench-local; $Existing = $null }
if (-not $Existing) { & $Codex plugin marketplace add $Root }
& $Codex plugin add workbench@workbench-local
try { node (Join-Path $Root 'codex-plugin/server.mjs') stop | Out-Null } catch {}

Write-Host "已安装研发工作台 Codex 版。请重启 Codex 桌面端，在左侧栏打开「研发工作台」。"
Write-Host "这个目录（$Root）是插件市场的来源，请不要删除或移动它。"
