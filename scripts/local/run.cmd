@echo off
setlocal
set "ROOT=%~2"
if not defined ROOT set "ROOT=%~dp0..\.."
for %%I in ("%ROOT%\.") do set "ROOT=%%~fI"
set "SCRIPT="
set "EXTRA="
if /I "%~1"=="start" set "SCRIPT=start-windows.ps1"
if /I "%~1"=="stop" set "SCRIPT=stop-windows.ps1"
if /I "%~1"=="status" set "SCRIPT=status-windows.ps1"
if /I "%~1"=="account" set "SCRIPT=show-account.ps1"
if /I "%~1"=="trust" set "SCRIPT=local-certificate-trust.ps1"
if /I "%~1"=="untrust" (
  set "SCRIPT=local-certificate-trust.ps1"
  set "EXTRA=-Remove"
)
if not defined SCRIPT (
  echo Usage: run.cmd start^|stop^|status^|account^|trust^|untrust [runtime-directory]
  exit /b 2
)
set "PS=%ROOT%\powershell\pwsh.exe"
if not exist "%PS%" set "PS=pwsh.exe"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0%SCRIPT%" -RuntimeRoot "%ROOT%" %EXTRA%
if errorlevel 1 (
  echo.
  echo WorkProof could not complete this operation. Check the message above.
  echo Runtime logs: "%ROOT%\logs"
  pause
  exit /b 1
)
if /I "%~1"=="status" pause
