$ErrorActionPreference = 'Stop'
$workbenchRoot = $PSScriptRoot
$serverScript = Join-Path $workbenchRoot 'app\server.py'
$workbenchUrl = 'http://127.0.0.1:8765/#home'
$healthUrl = 'http://127.0.0.1:8765/api/health'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

Set-Location -LiteralPath $workbenchRoot

try {
    $existingWorkbench = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($existingWorkbench.ok -eq $true -and $existingWorkbench.application -eq 'separator-workbench') {
        Start-Process $workbenchUrl
        Write-Host 'Separator Atlas is already running. The browser has been opened.'
        exit 0
    }
} catch { }

if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    Write-Error "Workbench server was not found: $serverScript"
    exit 2
}

if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
    $pythonCommand = $bundledPython
    $pythonArguments = @('-X', 'utf8', $serverScript, '--open')
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonCommand = 'py'
    $pythonArguments = @('-3', '-X', 'utf8', $serverScript, '--open')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCommand = 'python'
    $pythonArguments = @('-X', 'utf8', $serverScript, '--open')
} else {
    Write-Error 'Python 3.10 or later is required. Install Python, then run this launcher again.'
    exit 3
}

Write-Host 'Starting Separator Atlas...'
Write-Host "Open $workbenchUrl if the browser does not open automatically."
Write-Host 'Keep this window open while using the workbench. Press Ctrl+C to stop.'
& $pythonCommand @pythonArguments
$serverExit = $LASTEXITCODE

if ($null -eq $serverExit) { $serverExit = 1 }
if ($serverExit -ne 0) {
    Write-Error "Workbench server stopped with exit code $serverExit."
}
exit $serverExit
