@echo off
chcp 65001 >nul 2>&1

echo.
echo  NWT Super Agent - Qwen3.6 Brain via Bridge
echo  ============================================
echo.

set KANET_ROOT=%~dp0

curl -sf http://localhost:8000/health >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] llama-server not running on port 8000
    pause
    exit /b 1
)
echo [OK] llama-server ready

curl -sf http://localhost:9100/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Bridge already running
    goto worker
)

echo [..] Starting Bridge on port 9100...
start "cc-bridge" /B node "%KANET_ROOT%scripts\cc-bridge.mjs" 9100 >"%KANET_ROOT%logs\cc-bridge.log" 2>&1
timeout /t 3 /nobreak >nul

curl -sf http://localhost:9100/health >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Bridge startup failed
    pause
    exit /b 1
)
echo [OK] Bridge ready

:worker
echo [..] Starting Qwen3.6 Bridge Worker...
echo.
echo  NWT is thinking with Qwen3.6 brain...
echo  Press Ctrl+C to stop
echo.

node "%KANET_ROOT%scripts\qwen-bridge-worker.js"
