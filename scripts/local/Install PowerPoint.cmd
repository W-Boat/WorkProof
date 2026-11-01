@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0install-native-powerpoint.ps1" -RuntimeRoot "%~dp0."
set "result=%errorlevel%"
if not "%result%"=="0" echo Installation did not finish. Keep this window open to review the error.
pause
exit /b %result%
