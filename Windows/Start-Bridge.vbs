' ImmerseFree bridge launcher (silent).
' powershell.exe -WindowStyle Hidden still flashes a console window at logon,
' because the console is created first and hidden afterwards. WScript.Shell.Run
' with intWindowStyle 0 never creates a visible window at all.
' Keep this file pure ASCII: cmd/wscript misparse non-ASCII comments.
Option Explicit

Dim shell, fso, here, launcher, powershell, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(here, "Start-Bridge.ps1")

If Not fso.FileExists(launcher) Then
    WScript.Quit 1
End If

powershell = fso.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(powershell) Then
    powershell = "powershell.exe"
End If

command = """" & powershell & """ -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & launcher & """"

' 0 = hidden window, False = do not wait for it to finish.
shell.Run command, 0, False
