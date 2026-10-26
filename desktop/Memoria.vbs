' Memoria launcher: open the standalone app without a console window.
' Kept for shortcuts made by older builds, which pointed here.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repo = fso.GetParentFolderName(scriptDir)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo

extra = ""
For Each arg In WScript.Arguments
  extra = extra & " """ & arg & """"
Next

packagedExe = repo & "\Memoria.exe"
If Not fso.FileExists(packagedExe) Then
  MsgBox "Memoria.exe is missing. Install the Windows download again.", 16, "Memoria"
  WScript.Quit 1
End If

sh.Run """" & packagedExe & """" & extra, 0, False
