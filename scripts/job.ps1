<#
  无人值守流水线：拉新 → 压图 → 建索引 → 校验 → 出报告
  手动跑：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\job.ps1
    powershell ... -File scripts\job.ps1 -SkipFetch          # 不联网，只重压/重建
    powershell ... -File scripts\job.ps1 -Commit             # 跑完自动 git commit
  定时跑：scripts\schedule.ps1 -Action install
  退出码：0 通过 / 2 有非致命步骤失败 / 3 校验不通过
#>
param(
  [switch]$SkipFetch,
  [switch]$Commit,
  [int]$FetchLimit = 8
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $root 'reports/logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "run-$stamp.log"
$results = New-Object System.Collections.Generic.List[object]
$script:failed = $false
$script:verifyFailed = $false

function Resolve-Python {
  if ($env:DAYU_PYTHON -and (Test-Path $env:DAYU_PYTHON)) { return $env:DAYU_PYTHON }
  $cand = 'D:\30651\DeepSeekHarness\data\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
  if (Test-Path $cand) { return $cand }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw '找不到 python（需要带 Pillow 的解释器，或用 DAYU_PYTHON 指定）'
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw '找不到 node' }
$py = Resolve-Python

function Invoke-Step {
  param([string]$Name, [scriptblock]$Body, [switch]$Tolerate)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ok = $true
  $output = ''
  try {
    $output = & $Body 2>&1 | Out-String
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $ok = $false }
  } catch {
    $ok = $false
    $output = "$output`n$($_.Exception.Message)"
  }
  $sw.Stop()
  $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  Add-Content -Path $log -Encoding utf8 -Value "== $Name  [$secs s, $(if ($ok) { 'ok' } else { 'fail' })]`n$output"
  $state = if ($ok) { 'ok' } elseif ($Tolerate) { 'warn' } else { 'FAIL' }
  Write-Host ("{0,-9} {1,7:N1}s  {2}" -f $Name, $secs, $state)
  if (-not $ok -and -not $Tolerate) { $script:failed = $true }
  $results.Add([pscustomobject]@{ step = $Name; ok = $ok; tolerated = [bool]$Tolerate; seconds = $secs })
  return $ok
}

Write-Host "── dayu-fish-kb job  $stamp ──"
Add-Content -Path $log -Encoding utf8 -Value "dayu-fish-kb job $stamp ($root)"

if (-not $SkipFetch) {
  # 离线/代理挂了也不能让后面几步白跑，所以 fetch 容忍失败
  [void](Invoke-Step -Name 'fetch' -Tolerate -Body {
    & $node tools/fetch.mjs --all --limit $FetchLimit
  })
}

[void](Invoke-Step -Name 'optimize' -Body { & $py tools/optimize.py })
[void](Invoke-Step -Name 'build' -Body { & $node tools/build.mjs })

$okVerify = Invoke-Step -Name 'verify' -Body { & $node tools/verify.mjs }
if (-not $okVerify) { $script:verifyFailed = $true }

[void](Invoke-Step -Name 'report' -Body { & $node tools/report.mjs })

if ($Commit -and -not $script:failed) {
  [void](Invoke-Step -Name 'commit' -Tolerate -Body {
    & git add manifest/catalog.jsonl manifest/catalog.draft.jsonl manifest/optimized.jsonl reports/status.md 2>&1 | Out-Null
    $dirty = & git status --porcelain
    if (-not $dirty) { Write-Host '没有变更，跳过 commit'; return }
    & git -c user.name='dayu-fish-kb-bot' -c user.email='kb@localhost' commit -q -m "chore: 定时更新 $stamp"
    & git log --oneline -1
  })
}

$summary = [pscustomobject]@{
  at = (Get-Date).ToString('o')
  ok = (-not $script:failed)
  verifyOk = (-not $script:verifyFailed)
  steps = $results
  log = (Split-Path -Leaf $log)
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $root 'reports/last-run.json') -Encoding utf8

Write-Host "── 结果：$(if ($summary.ok) { '通过' } else { '有失败步骤' })；日志 reports/logs/$($summary.log) ──"
if ($script:verifyFailed) { exit 3 }
if ($script:failed) { exit 2 }
exit 0
