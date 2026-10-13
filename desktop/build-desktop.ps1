$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $PSScriptRoot 'SeparatorAtlasLauncher.cs'
$iconFile = Join-Path $PSScriptRoot 'SeparatorAtlas.ico'
$launcherName = ([char]0x9694) + ([char]0x819C) + ([char]0x7814) + ([char]0x6790) + '.exe'
$outputFile = Join-Path $projectRoot $launcherName

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
    throw 'Windows C# compiler was not found.'
}
if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Desktop launcher source was not found: $sourceFile"
}
if (-not (Test-Path -LiteralPath $iconFile -PathType Leaf)) {
    throw "Desktop icon was not found: $iconFile"
}

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /win32icon:"$iconFile" /out:"$outputFile" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "$sourceFile"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
    throw 'Desktop launcher compilation failed.'
}
Write-Host "Desktop launcher created: $outputFile"
