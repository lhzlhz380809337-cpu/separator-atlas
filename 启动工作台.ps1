$ErrorActionPreference = 'Stop'
$workbenchRoot = $PSScriptRoot
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
Set-Location -LiteralPath $workbenchRoot
try {
    $existingWorkbench = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 2
    if ($existingWorkbench.ok -eq $true -and $existingWorkbench.application -eq 'separator-workbench') {
        Start-Process 'http://127.0.0.1:8765'
        exit 0
    }
} catch { }
if (Test-Path -LiteralPath $bundledPython) {
    & $bundledPython -X utf8 (Join-Path $workbenchRoot 'app\server.py') --open
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -X utf8 (Join-Path $workbenchRoot 'app\server.py') --open
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -X utf8 (Join-Path $workbenchRoot 'app\server.py') --open
} else {
    Write-Host '请先安装 Python 3.10 或更新版本，再重新打开工作台。'
}
if ($LASTEXITCODE -ne 0) { Read-Host '程序已停止，请查看上方提示。按回车关闭' }
