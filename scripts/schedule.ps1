<#
  把流水线挂到 Windows 计划任务。
    .\scripts\schedule.ps1 -Action install            # 每天 03:30 跑一次并 commit
    .\scripts\schedule.ps1 -Action install -Time 09:00
    .\scripts\schedule.ps1 -Action show               # 看现在挂了什么
    .\scripts\schedule.ps1 -Action run-now            # 立刻跑一次
    .\scripts\schedule.ps1 -Action remove             # 摘掉
  说明：任务以「当前用户、仅在登录时运行」注册（默认不需要管理员、不存密码）。
#>
param(
  [ValidateSet('install', 'remove', 'show', 'run-now')]
  [string]$Action = 'show',
  [string]$Time = '03:30',
  [string]$TaskName = 'DayuFishKB-Daily'
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$job = Join-Path $root 'scripts\job.ps1'
$ps = Join-Path $PSHOME 'powershell.exe'

switch ($Action) {
  'install' {
    if (-not (Test-Path $job)) { throw "找不到 $job" }
    $tr = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$job`" -Commit"
    schtasks /Create /F /SC DAILY /ST $Time /TN $TaskName /TR $tr 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "✗ 注册计划任务被拒绝（退出码 $LASTEXITCODE）。" -ForegroundColor Yellow
      Write-Host "  沙箱/受限账户里 schtasks 走不通（RPC 命名管道被拦），这不是仓库的问题。"
      Write-Host ""
      Write-Host "  办法 A：在普通 PowerShell 窗口里执行这一行："
      Write-Host "    schtasks /Create /F /SC DAILY /ST $Time /TN $TaskName /TR '$tr'"
      Write-Host ""
      Write-Host "  办法 B：用户态守护进程（不用管理员、不碰计划任务）："
      Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'daemon.ps1')`" -At $Time"
      return
    }
    Write-Host "✓ 已注册：$TaskName，每天 $Time"
    Write-Host "  动作：$tr"
    schtasks /Query /TN $TaskName /FO LIST | Select-String -Pattern '任务名|TaskName|下次运行时间|Next Run Time|状态|Status'
  }
  'remove' {
    schtasks /Delete /F /TN $TaskName | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "没有这个任务，或删除被拒绝（退出码 $LASTEXITCODE）" } else { Write-Host "✓ 已删除：$TaskName" }
  }
  'show' {
    $out = schtasks /Query /TN $TaskName /V /FO LIST 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host "查不到任务 $TaskName（或被沙箱拒绝）。装了的话：schtasks /Query /TN $TaskName"
      Write-Host "没装的话：npm run schedule -- -Action install，或用 scripts\daemon.ps1"
    } else { $out }
  }
  'run-now' {
    & $ps -NoProfile -ExecutionPolicy Bypass -File $job -Commit
  }
}
