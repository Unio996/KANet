@echo off
chcp 65001 >nul
title KAS Market Maker

echo.
echo   KAS Market Maker
echo   ────────────────
echo.

cd /d "%~dp0"
if not exist logs mkdir logs

:: Stop old process
if exist logs\mm.pid (
    set /p OLD_PID=<logs\mm.pid
    taskkill /PID %OLD_PID% /F /T >nul 2>&1
    del logs\mm.pid >nul 2>&1
    timeout /t 1 /nobreak >nul
)

:: Start
echo   Starting...
start /b node src/index.mjs > logs\mm.log 2>&1

:: Wait for ready
set READY=0
for /L %%i in (1,1,20) do (
    curl -sf http://localhost:3200/ >nul 2>&1 && set READY=1 && goto :started
    timeout /t 1 /nobreak >nul
)

:started
if %READY%==1 (
    echo   Dashboard:  http://localhost:3200
    echo   Log:        logs\mm.log
    echo.
    echo   Press any key to open dashboard...
    pause >nul
    start http://localhost:3200
) else (
    echo   FAILED! Check logs\mm.log
    type logs\mm.log
    pause
)
