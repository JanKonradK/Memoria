# Hold Windows file locks across replacement. Process inventories can omit
# executable paths, so they are an early diagnostic, not the safety boundary.
function Lock-MemoriaProgramTree([string]$directory) {
  $locks = New-Object 'System.Collections.Generic.List[System.IDisposable]'
  if (-not (Test-Path -LiteralPath $directory)) { return ,$locks }
  $prefix = [IO.Path]::GetFullPath($directory).TrimEnd('\') + '\'
  $message = 'Close Memoria before you install or replace this version. Your current app and saved data have not changed.'
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $executable = $null
    try { $executable = $process.Path } catch { }
    if ($executable -and $executable.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw $message
    }
  }
  # WMI sometimes sees a process that Get-Process cannot inspect. Failure to
  # inspect it is harmless because exclusive writable file access is required.
  $processes = @()
  try { $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop) } catch { }
  if (@($processes | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
  }).Count -gt 0) {
    throw $message
  }

  try {
    $files = Get-ChildItem -LiteralPath $directory -Recurse -File -Force | Where-Object {
      $_.Extension -in @('.exe', '.dll')
    }
    foreach ($file in $files) {
      # A loaded image cannot grant writable access. FileShare.Delete permits
      # our directory rename and deletion, but denies new reads and execution
      # until replacement finishes. Keep every handle open through the swap.
      $locks.Add([IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Delete))
    }
    return ,$locks
  } catch {
    foreach ($handle in $locks) { $handle.Dispose() }
    throw $message
  }
}

function Unlock-MemoriaProgramTree($locks) {
  foreach ($handle in $locks) { $handle.Dispose() }
}
