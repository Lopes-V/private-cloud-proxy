@echo off
setlocal
set "PCP_PROTECTED_BROWSER_EXE=%~dp0Private Cloud Chromium-win32-x64\Private Cloud Chromium.exe"
if not exist "%PCP_PROTECTED_BROWSER_EXE%" (
  echo [PROTECTED_BROWSER_MISSING] Extraia o ZIP completo do navegador protegido.
  pause
  exit /b 1
)
call "%~dp0Start-Private-Proxy.cmd"
exit /b %errorlevel%
