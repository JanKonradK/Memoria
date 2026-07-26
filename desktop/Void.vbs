' Void launcher — runs the Node launcher with no visible console window.
' Self-locating: works no matter where the project folder lives.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repo = fso.GetParentFolderName(scriptDir)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo
' Pass anything the shortcut carries straight through, so a shortcut can pin a
' browser: Void.vbs --browser zen
extra = ""
For Each arg In WScript.Arguments
  extra = extra & " """ & arg & """"
Next
' 0 = hidden window, False = don't wait.
sh.Run "node """ & scriptDir & "\void.mjs""" & extra, 0, False
