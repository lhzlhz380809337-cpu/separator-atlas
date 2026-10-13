@echo off
setlocal
chcp 65001 >nul
if not exist "%~dp0隔膜研析.exe" (
    echo 未找到“隔膜研析.exe”，请继续使用“启动工作台.cmd”。
    pause
    exit /b 2
)
start "" "%~dp0隔膜研析.exe"
exit /b 0
