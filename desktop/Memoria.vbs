' Memoria launcher — runs the Node launcher with no visible console window.
' Self-locating: works no matter where the project folder lives.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repo = fso.GetParentFolderName(scriptDir)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repo

' A packaged download ships its own Node under node\node.exe, so the app runs on
' the runtime it was tested against and a machine with no Node installed still
' works. A source checkout has no such folder and falls back to Node on PATH.
bundledNode = repo & "\node\node.exe"
If fso.FileExists(bundledNode) Then
  nodeExe = """" & bundledNode & """"
Else
  nodeExe = "node"
End If

' Pass anything the shortcut carries straight through, so a shortcut can pin a
' browser: Memoria.vbs --browser zen
extra = ""
For Each arg In WScript.Arguments
  extra = extra & " """ & arg & """"
Next
' 0 = hidden window, False = don't wait.
sh.Run nodeExe & " """ & scriptDir & "\memoria.mjs""" & extra, 0, False
