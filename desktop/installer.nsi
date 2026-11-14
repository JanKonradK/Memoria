; The Windows installer: Memoria-setup-x64.exe.
;
; It carries the same tree as Memoria-win-x64.zip and installs it with the same
; script (desktop/Install-Shortcut.ps1) the zip and the in-app updater use, so
; there is one install folder (%LOCALAPPDATA%\Programs\Memoria), one way to
; replace it safely while checking Memoria is closed, and one set of shortcuts.
; On top of that it adds what a zip cannot: an entry in Settings > Apps with an
; uninstaller. No administrator rights; data in %APPDATA%\memoria is never touched.
;
; Built by scripts/package-release.mjs:
;   makensis /DVERSION=1.2.3 /DSOURCE=<staged Memoria folder> /DOUTFILE=<exe> desktop/installer.nsi

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef VERSION | SOURCE | OUTFILE
  !error "Pass /DVERSION, /DSOURCE and /DOUTFILE."
!endif

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Memoria"
!define UNINSTALLER "Uninstall Memoria.exe"
!define APP_ID "app.memoria.tracker"

Name "Memoria"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Memoria"
BrandingText "Memoria ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Memoria"
VIAddVersionKey "FileDescription" "Memoria setup"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Memoria contributors"

!define MUI_ICON "${SOURCE}\desktop\memoria.ico"
!define MUI_UNICON "${SOURCE}\desktop\memoria.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Memoria.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Memoria"
!define MUI_FINISHPAGE_TEXT "Memoria is installed for this Windows user, with shortcuts on the Desktop and in the Start menu.$\r$\n$\r$\nIt updates itself from Settings > Updates. Your data stays in %APPDATA%\memoria."

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Memoria"
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Memoria"
  File /r "${SOURCE}\*"
  SetOutPath "$PLUGINSDIR"

  install:
  DetailPrint "Installing Memoria ${VERSION}..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\Memoria\desktop\Install-Shortcut.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "Memoria could not be installed. If it is open, quit it from its tray icon (right-click, Quit), then select Retry.$\r$\n$\r$\nYour current app and your data have not changed." \
      /SD IDCANCEL IDRETRY install
    Abort "Memoria was not installed."
  ${EndIf}

  ; The uninstaller lives beside the shortcut icons, not in the program folder:
  ; an in-app update replaces that folder with exactly the signed files.
  CreateDirectory "$LOCALAPPDATA\Memoria"
  WriteUninstaller "$LOCALAPPDATA\Memoria\${UNINSTALLER}"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Memoria"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Memoria"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Memoria.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/JanKonradK/Memoria"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$LOCALAPPDATA\Memoria\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$LOCALAPPDATA\Memoria\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $1 $2 $3
  IntFmt $1 "0x%08X" $1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == ""
    StrCpy $0 "$LOCALAPPDATA\Programs\Memoria"
  ${EndIf}

  ; A running program cannot be opened for writing.
  closed:
  ${If} ${FileExists} "$0\Memoria.exe"
    ClearErrors
    FileOpen $1 "$0\Memoria.exe" a
    ${If} ${Errors}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
        "Quit Memoria from its tray icon (right-click, Quit), then select Retry." \
        /SD IDCANCEL IDRETRY closed
      Abort "Memoria is still open."
    ${EndIf}
    FileClose $1
  ${EndIf}

  Delete "$DESKTOP\Memoria.lnk"
  Delete "$SMPROGRAMS\Memoria.lnk"
  ; Only a folder that holds a Memoria release is removed.
  ${If} ${FileExists} "$0\release.json"
    RMDir /r "$0"
  ${EndIf}
  RMDir /r "$LOCALAPPDATA\Memoria\icons"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Memoria"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${APP_ID}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$INSTDIR\${UNINSTALLER}"
  RMDir "$INSTDIR"
  DetailPrint "Your data in %APPDATA%\memoria was kept. Delete that folder to remove it too."
SectionEnd
