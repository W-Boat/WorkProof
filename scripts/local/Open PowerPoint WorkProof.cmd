@echo off
setlocal
start "" /min "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "%~dp0open-native-powerpoint.ps1"
exit /b
