# 包装器：用「带 Pillow 的那个 python」跑 tools/optimize.py
# 为什么需要它：本机 PATH 上的 python 是别的 venv（没有 Pillow），直接 `python tools/optimize.py` 会炸。
param(
  [switch]$Force,
  [string]$Only,
  [int]$MaxEdge = 1920
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = $env:DAYU_PYTHON
if (-not $py -or -not (Test-Path $py)) {
  $cand = 'D:\30651\DeepSeekHarness\data\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
  if (Test-Path $cand) { $py = $cand }
}
if (-not $py) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $py = $cmd.Source } else { throw '找不到 python（需要带 Pillow；可用 DAYU_PYTHON 指定）' }
}
$argv = @((Join-Path $root 'tools\optimize.py'), '--max-edge', $MaxEdge)
if ($Force) { $argv += '--force' }
if ($Only) { $argv += @('--only', $Only) }
& $py @argv
exit $LASTEXITCODE
