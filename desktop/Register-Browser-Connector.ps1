# Register the installed connector for this Windows user. No administrator access is needed.
# Chromium supports .cmd hosts through its hidden COMSPEC launch path:
# https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/messaging/launch_context_win.cc
$ErrorActionPreference = 'Stop'
$install = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$required = @('Memoria.exe', 'release.json', 'node\node.exe', 'desktop\browser-host.cmd', 'desktop\browser-host.mjs', 'desktop\browser-bridge.mjs', 'browser-extension\identity.json')
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $install $relative) -PathType Leaf)) { throw 'Install the latest Memoria Windows package before you set up the browser connector.' }
}
$release = Get-Content -LiteralPath (Join-Path $install 'release.json') -Raw | ConvertFrom-Json
if ($release.name -ne 'Memoria' -or $release.runtime -ne 'electron') { throw 'This folder is not a standalone Memoria installation.' }
$identity = Get-Content -LiteralPath (Join-Path $install 'browser-extension\identity.json') -Raw | ConvertFrom-Json
if ($identity.id -ne 'fonifgaeglmfmakjocdjembgclppgcfe') { throw 'The Memoria browser connector identity is invalid.' }
$manifest = Join-Path $PSScriptRoot 'app.memoria.browser.json'
$record = [ordered]@{
  name = 'app.memoria.browser'
  description = 'Memoria browser account readings'
  path = (Join-Path $PSScriptRoot 'browser-host.cmd')
  type = 'stdio'
  allowed_origins = @('chrome-extension://fonifgaeglmfmakjocdjembgclppgcfe/')
}
[IO.File]::WriteAllText($manifest, ($record | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
  $registry = 'HKCU:\Software\' + $browser + '\NativeMessagingHosts\app.memoria.browser'
  New-Item -Path $registry -Force | Out-Null
  Set-Item -LiteralPath $registry -Value $manifest
}
