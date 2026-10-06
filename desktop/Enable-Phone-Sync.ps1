# Allow the paired phone to reach this app on the local network only.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  # Windows shows its normal administrator consent prompt. Never bypass it.
  $scriptPath = $MyInvocation.MyCommand.Path
  $child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $scriptPath + '"')
  )
  exit $child.ExitCode
}

$install = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path -LiteralPath (Join-Path $install 'Memoria.exe'))) {
  $install = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Memoria'
}
$program = Join-Path $install 'Memoria.exe'
$release = Join-Path $install 'release.json'
if (-not (Test-Path -LiteralPath $program) -or -not (Test-Path -LiteralPath $release)) {
  throw 'Install Memoria before you enable phone sync.'
}
$record = Get-Content -LiteralPath $release -Raw | ConvertFrom-Json
if ($record.name -ne 'Memoria' -or $record.runtime -ne 'electron') {
  throw 'The selected folder is not a standalone Memoria install.'
}
$ruleName = 'Memoria-Native-Phone-Sync-17820'
$options = @{
  Direction = 'Inbound'
  Action = 'Allow'
  Enabled = 'True'
  Profile = @('Private', 'Public')
  Program = $program
  Protocol = 'TCP'
  LocalPort = 17820
  RemoteAddress = 'LocalSubnet'
  EdgeTraversalPolicy = 'Block'
}
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name $ruleName @options | Out-Null
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName 'Memoria phone sync (local network)' -Group 'Memoria' @options | Out-Null
}
Write-Output 'Memoria phone sync is allowed on this local network.'
