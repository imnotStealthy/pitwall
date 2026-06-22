' FH6-Overlay.vbs — launches the desktop overlay + system tray with NO console
' window and no taskbar flash. Double-click this to start the overlay.
' First time only: run setup.bat once to install dependencies (incl. Electron).
Option Explicit

Dim fso, root, electronExe, appPath, sh
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = root & "\node_modules\electron\dist\electron.exe"
appPath = root & "\electron\main.cjs"

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron not found." & vbCrLf & vbCrLf & _
         "Run setup.bat once first to install the dependencies.", _
         vbExclamation, "FH6 Overlay"
  WScript.Quit 1
End If

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
' intWindowStyle 0 = hidden, bWaitOnReturn = False = fire and forget.
sh.Run """" & electronExe & """ """ & appPath & """", 0, False
