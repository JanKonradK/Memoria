' Memoria launcher: open the standalone app without a console window.
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
sourceExe = repo & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(packagedExe) Then
  command = """" & packagedExe & """" & extra
ElseIf fso.FileExists(sourceExe) Then
  command = """" & sourceExe & """ """ & scriptDir & "\electron-main.mjs""" & extra
Else
  MsgBox "The Memoria runtime is missing. Install the Windows download or run npm install in the source folder.", 16, "Memoria"
  WScript.Quit 1
End If

sh.Run command, 0, False
