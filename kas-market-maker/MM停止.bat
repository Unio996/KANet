@echo off
chcp 65001 >nul
echo.
echo   Stopping KAS Market Maker...

cd /d "%~dp0"
if exist logs\mm.pid (
    set /p PID=<logs\mm.pid
    taskkill /PID %PID% /F /T >nul 2>&1
    del logs\mm.pid >nul 2>&1
    echo   Stopped.
) else (
    echo   Not running.
)
echo.
pause
