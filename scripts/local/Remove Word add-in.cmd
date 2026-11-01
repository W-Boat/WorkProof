@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install-native-word.ps1" -RuntimeRoot "%~dp0." -Remove
set "result=%errorlevel%"
pause
exit /b %result%
