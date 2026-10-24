# 研发工作台：安装 / 更新（Windows PowerShell）。第一次运行 = 安装，之后运行新版本包里的它 = 更新。
# 注意：这个脚本还没有在 Windows 上实测过；DSH 桌面端在 Windows 上的安装路径是按常见位置猜的，
# 找不到时请用 -DshPath 指定 dsh.cmd / dsh.exe 的完整路径。
#   .\install.ps1 -Profile web                 装到别的 profile（默认 desktop）
#   .\install.ps1 -Yes                         不询问（DSH 正在运行时会自动退出它）
param([string]$Profile = 'desktop', [string]$DshPath = '', [string]$Target = '', [switch]$Yes)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'dsh-plugin'
if (-not (Test-Path (Join-Path $src 'package.json'))) { throw "找不到 $src，请在解压后的安装包目录里运行本脚本。" }
if (-not $Target) { $Target = Join-Path $env:USERPROFILE '.workbench\plugin' }
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$appName = 'DeepSeek Harness'
$version = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version

# 1. dsh 命令
if (-not $DshPath) { $cmd = Get-Command dsh -ErrorAction SilentlyContinue; if ($cmd) { $DshPath = $cmd.Source } }
if (-not $DshPath) {
  foreach ($c in @("$env:LOCALAPPDATA\Programs\$appName\resources\runtime\cli\bin\dsh.cmd", "$env:ProgramFiles\$appName\resources\runtime\cli\bin\dsh.cmd")) { if (Test-Path $c) { $DshPath = $c; break } }
}
if (-not $DshPath -or -not (Test-Path $DshPath)) { throw '没有找到 dsh 命令。请先安装 DSH 桌面端并登录一次，或用 -DshPath 指定。' }

# 2. 桌面端正在运行时先退出（需要确认）
$restartExe = $null
if ($Profile -eq 'desktop') {
  $procs = Get-Process -Name $appName -ErrorAction SilentlyContinue
  if ($procs) {
    $ans = if ($Yes) { 'y' } else { Read-Host "$appName 正在运行，安装需要先退出它（未保存的会话输入会丢）。现在退出吗？[y/N]" }
    if ($ans -notmatch '^[yY]') { throw "已取消。请先退出 $appName 再运行本脚本（或加 -Yes）。" }
    $restartExe = $procs[0].Path
    $procs | Stop-Process
    Start-Sleep -Seconds 3
    if (Get-Process -Name $appName -ErrorAction SilentlyContinue) { throw "$appName 没有退出，请手动退出后重新运行。" }
  }
}

# 3. 替换插件文件（只会删除一个确认是本插件的目录）
$old = $null
if (Test-Path $Target) {
  $pj = Join-Path $Target 'package.json'
  if (-not ((Test-Path $pj) -and (Select-String -Path $pj -Pattern '"@local/workbench"' -Quiet))) { throw "$Target 已存在但不是研发工作台插件目录，为避免误删已停止。请用 -Target 换一个目录。" }
  $old = (Get-Content $pj -Raw | ConvertFrom-Json).version
  Remove-Item -Recurse -Force $Target
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
Copy-Item -Recurse $src $Target

# 4. 在 profile 里登记（已经指向这个目录就不用再登记）
$pkg = Join-Path $dshHome "profiles\$Profile\package.json"
$link = 'link:' + $Target.Replace('\', '/')
if ((Test-Path $pkg) -and ((Get-Content $pkg -Raw).Replace('\\', '/').Contains($link))) { Write-Host "profile「$Profile」已指向 $Target，只替换了文件。" }
else { & $DshPath plugin --profile $Profile add $Target; if ($LASTEXITCODE -ne 0) { throw "登记插件失败（退出码 $LASTEXITCODE）。" } }

if ($old) { Write-Host "已更新研发工作台：$old -> $version（数据文件保持不变，旧数据格式会在首次启动时自动升级并备份）。" } else { Write-Host "已安装研发工作台 $version。" }
if ($restartExe) { Start-Process $restartExe; Write-Host "已重新打开 $appName。" } else { Write-Host '请（重新）打开 DSH，在左侧栏点「工作台」。' }
