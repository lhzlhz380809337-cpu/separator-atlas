@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-workbench.ps1"
set "WORKBENCH_EXIT=%ERRORLEVEL%"
if not "%WORKBENCH_EXIT%"=="0" (
    echo.
    echo Workbench failed to start. See the message above.
    pause
)
exit /b %WORKBENCH_EXIT%
