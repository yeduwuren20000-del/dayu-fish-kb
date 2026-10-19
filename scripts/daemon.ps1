<#
  用户态守护进程：不依赖 Windows 计划任务（沙箱/受限账户里 schtasks 会被拒），
  由你自己启动或放进「启动」文件夹，就能每天定时跑流水线。
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1
    ... -At 09:00            # 改成每天 09:00
    ... -EverySeconds 5 -MaxRuns 1   # 自测：5 秒后跑一次就退出
    ... -Once                # 立刻跑一次就退出
  停止：Ctrl+C，或结束 reports/daemon.pid 里的进程。
#>
param(
  [string]$At = '03:30',
  [int]$EverySeconds = 0,
  [int]$MaxRuns = 0,
  [bool]$Commit = $true,
  [switch]$Once
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$job = Join-Path $root 'scripts\job.ps1'
$reportDir = Join-Path $root 'reports'
$pidFile = Join-Path $reportDir 'daemon.pid'
$logFile = Join-Path $reportDir 'daemon.log'
$ps = Join-Path $PSHOME 'powershell.exe'

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
Set-Content -Path $pidFile -Value $PID

function Write-Log([string]$m) {
  Add-Content -Path $logFile -Encoding utf8 -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
}

function Get-NextRun([string]$hhmm) {
  $p = $hhmm.Split(':')
  $t = (Get-Date).Date.AddHours([int]$p[0]).AddMinutes([int]$p[1])
  if ($t -le (Get-Date)) { $t = $t.AddDays(1) }
  return $t
}

$runs = 0
Write-Log ("daemon 启动 pid=$PID，模式：$(if ($Once) { 'once' } elseif ($EverySeconds -gt 0) { "every ${EverySeconds}s" } else { "daily $At" })")

try {
  do {
    if ($EverySeconds -gt 0) {
      $wait = $EverySeconds
    } elseif ($Once) {
      $wait = 0
    } else {
      $next = Get-NextRun $At
      $wait = [int]($next - (Get-Date)).TotalSeconds
      Write-Log ("下次运行：{0}" -f (Get-Date $next -Format 'yyyy-MM-dd HH:mm:ss'))
    }

    # 分段睡：Ctrl+C 能及时退出，也避免一次超大 sleep 的漂移
    $deadline = (Get-Date).AddSeconds($wait)
    while ((Get-Date) -lt $deadline) {
      $left = [int]($deadline - (Get-Date)).TotalSeconds
      Start-Sleep -Seconds ([math]::Max(1, [math]::Min(30, $left)))
    }

    Write-Log '开始跑流水线'
    $jobArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $job)
    if ($Commit) { $jobArgs += '-Commit' }
    & $ps @jobArgs 2>&1 | Out-File -Append -Encoding utf8 $logFile
    Write-Log ("流水线退出码 {0}" -f $LASTEXITCODE)
    $runs++
    if ($Once) { break }
  } while ($MaxRuns -le 0 -or $runs -lt $MaxRuns)
} finally {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Log 'daemon 退出'
}
