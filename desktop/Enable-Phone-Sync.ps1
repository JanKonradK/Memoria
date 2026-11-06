# Allow the paired phone to reach Memoria on a private network, or through
# Tailscale (100.64.0.0/10), only.
#
# This file is compiled into Memoria.exe and run elevated from memory. It is
# never read from the install folder, so editing a copy on disk changes nothing.
# Memoria puts `$program` (the path to Memoria.exe) and `$makePrivate` in front of it.
$ErrorActionPreference = 'Stop'
if (-not $program -or -not (Test-Path -LiteralPath $program)) {
  throw 'Install Memoria before you enable phone sync.'
}
$common = @{
  Direction = 'Inbound'
  Action = 'Allow'
  Enabled = 'True'
  Program = $program
  Protocol = 'TCP'
  LocalPort = 17820
  EdgeTraversalPolicy = 'Block'
  Group = 'Memoria'
}
# The Tailscale rule comes first and every rule is changed in place, so a
# failure part-way leaves the phone with the access it already had.
$rules = @(
  # Tailscale's address range only, on any profile, so sync away from home keeps working.
  @{ Name = 'Memoria-Native-Phone-Sync-Tailscale-17820'; DisplayName = 'Memoria phone sync (Tailscale)';
     Profile = 'Any'; RemoteAddress = '100.64.0.0/10' },
  # Home Wi-Fi: devices on the same subnet, on networks Windows marks Private.
  @{ Name = 'Memoria-Native-Phone-Sync-17820'; DisplayName = 'Memoria phone sync (private network)';
     Profile = 'Private'; RemoteAddress = 'LocalSubnet' }
)
foreach ($rule in $rules) {
  $options = $common + @{ Profile = $rule.Profile; RemoteAddress = $rule.RemoteAddress }
  if (Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue) {
    $options.Remove('Group')
    Set-NetFirewallRule -Name $rule.Name -NewDisplayName $rule.DisplayName @options | Out-Null
  } else {
    New-NetFirewallRule -Name $rule.Name -DisplayName $rule.DisplayName @options | Out-Null
  }
}
# Asked for in Settings: Windows treats this home Wi-Fi as a public network,
# which keeps phones out. Mark the connected public networks private instead.
if ($makePrivate) {
  Get-NetConnectionProfile |
    Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' -and $_.InterfaceAlias -notlike 'vEthernet*' } |
    Set-NetConnectionProfile -NetworkCategory Private
}
