# Installs the standalone Windows app for the current user. App data stays in
# %APPDATA%\memoria. Use -NoShortcuts with -InstallRoot for an isolated check.
param(
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Memoria'),
  [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'Install-Lock.ps1')
$repo = Split-Path -Parent $here
$source = $repo
if (-not (Test-Path -LiteralPath (Join-Path $source 'release.json'))) {
  $source = Join-Path $repo 'dist\release\Memoria'
}
$source = [IO.Path]::GetFullPath($source).TrimEnd('\')
$destination = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$dataDirectory = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'memoria'

function Assert-NativeBundle([string]$directory) {
  foreach ($relativePath in @('Memoria.exe', 'release.json', 'resources\app\package.json', 'desktop\electron-main.mjs', 'app\dist\index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $directory $relativePath) -PathType Leaf)) {
      throw "The Windows app is incomplete: $relativePath is missing. Run npm run build and npm run package, or extract a new Windows download."
    }
  }
  $record = Get-Content -LiteralPath (Join-Path $directory 'release.json') -Raw | ConvertFrom-Json
  if ($record.name -ne 'Memoria' -or $record.runtime -ne 'electron') {
    throw 'This folder does not contain a standalone Memoria release.'
  }
}

Assert-NativeBundle $source
if ([IO.Path]::GetFileName($destination) -ne 'Memoria' -or
    $destination.Equals($dataDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    $destination.StartsWith($dataDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The install folder must be named Memoria and must not contain your Memoria app data.'
}

if (-not $source.Equals($destination, [StringComparison]::OrdinalIgnoreCase)) {
  if ($destination.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $source.StartsWith($destination + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The source and install folders must not contain each other.'
  }
  if (Test-Path -LiteralPath $destination) {
    Assert-NativeBundle $destination
    if ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'The install folder must not be a symbolic link or junction.'
    }
  }
  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $id = [Guid]::NewGuid().ToString('N')
  $stage = Join-Path $parent ('.Memoria-stage-' + $id)
  $previous = Join-Path $parent ('.Memoria-previous-' + $id)
  # All recursive removal and directory moves below use these exact siblings.
  # Resolve and check them before any file operation.
  foreach ($managedPath in @($stage, $previous, $destination)) {
    if ((Split-Path -Parent ([IO.Path]::GetFullPath($managedPath))) -ne $parent) {
      throw 'The install path escaped its parent folder.'
    }
  }
  if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $previous)) {
    throw 'The temporary install folder already exists. Start the installer again.'
  }

  $programLocks = Lock-MemoriaProgramTree $destination
  try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $stage -Recurse -Force
    Assert-NativeBundle $stage
    if (Test-Path -LiteralPath $destination) {
      Move-Item -LiteralPath $destination -Destination $previous
    }
    try {
      Move-Item -LiteralPath $stage -Destination $destination
    } catch {
      if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $destination)) {
        Move-Item -LiteralPath $previous -Destination $destination
      }
      throw
    }
    if (Test-Path -LiteralPath $previous) {
      Remove-Item -LiteralPath $previous -Recurse -Force
    }
  } finally {
    Unlock-MemoriaProgramTree $programLocks
    if (Test-Path -LiteralPath $stage) {
      Remove-Item -LiteralPath $stage -Recurse -Force
    }
  }
}

if (-not $NoShortcuts) {
  $ico = Join-Path $destination 'desktop\memoria.ico'
  # A content-specific path refreshes the Windows shortcut icon cache.
  $iconHash = (Get-FileHash -LiteralPath $ico -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
  $iconDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Memoria\icons'
  New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
  $shortcutIcon = Join-Path $iconDirectory ('memoria-' + $iconHash + '.ico')
  Copy-Item -LiteralPath $ico -Destination $shortcutIcon -Force
  $shell = New-Object -ComObject WScript.Shell
  $shortcutFolders = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs')
  )
  foreach ($folder in $shortcutFolders) {
    $shortcut = $shell.CreateShortcut((Join-Path $folder 'Memoria.lnk'))
    $shortcut.TargetPath = Join-Path $destination 'Memoria.exe'
    $shortcut.Arguments = ''
    $shortcut.WorkingDirectory = $destination
    $shortcut.IconLocation = $shortcutIcon
    $shortcut.Description = 'Memoria - game energy, daily tasks, and events'
    $shortcut.Save()
  }
}

Write-Host "Memoria is installed at $destination" -ForegroundColor Green
if (-not $NoShortcuts) {
  Write-Host 'Open Memoria from the Desktop or Start Menu.'
}
