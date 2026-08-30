# Creates "Memoria" shortcuts on the Desktop and Start Menu that launch the
# app in its own window via the hidden VBS wrapper, with the custom icon.
# Run once:  powershell -ExecutionPolicy Bypass -File desktop\Install-Shortcut.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$vbs = Join-Path $here 'Memoria.vbs'
$ico = Join-Path $here 'memoria.ico'

# A packaged download ships the icon and a built app/dist already, and has no
# source tree or npm to build from. Only a source checkout needs either step.
$packaged = Test-Path (Join-Path $repo 'release.json')

# Ensure the icon exists (generate it if missing).
if (-not (Test-Path $ico) -and -not $packaged) {
  Write-Host 'Generating icon...'
  & node (Join-Path $repo 'app\scripts\gen-ico.mjs')
}

# Ensure the app is built so the first click opens instantly.
if (-not (Test-Path (Join-Path $repo 'app\dist\index.html'))) {
  if ($packaged) {
    throw 'This copy of Memoria is missing app\dist. Download it again from https://github.com/JanKonradK/Memoria/releases/latest'
  }
  Write-Host 'Building the app (first-time setup, ~30s)...'
  Push-Location $repo
  & npm run build
  Pop-Location
}

function New-MemoriaShortcut([string]$linkPath) {
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($linkPath)
  # Launch the VBS via wscript so no console window ever appears.
  $sc.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $sc.Arguments = '"' + $vbs + '"'
  $sc.WorkingDirectory = $repo
  $sc.IconLocation = $ico
  $sc.Description = 'Memoria — gacha energy & daily tracker'
  $sc.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
New-MemoriaShortcut (Join-Path $desktop 'Memoria.lnk')

$startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
New-MemoriaShortcut (Join-Path $startMenu 'Memoria.lnk')

Write-Host ''
Write-Host 'Done. "Memoria" is now on your Desktop and Start Menu.' -ForegroundColor Green
Write-Host 'Double-click it to launch the app in its own window.'
