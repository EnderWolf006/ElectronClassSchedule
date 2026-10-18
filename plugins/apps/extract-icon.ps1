param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$target = $Path
if ([System.IO.Path]::GetExtension($Path).ToLower() -eq '.lnk') {
    $shell = New-Object -ComObject WScript.Shell
    $target = $shell.CreateShortcut($Path).TargetPath
}
if (-not $target -or -not (Test-Path -LiteralPath $target)) { exit 3 }

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($target)
if (-not $icon) { exit 4 }

$dir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$bitmap = $icon.ToBitmap()
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$icon.Dispose()
Write-Output 'ok'